import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { policySchema, id, domain } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { compileForProfile, compileLab, labsUsingPolicy, requestDeployment } from '../services/policyEngine.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { badRequest, forbidden, notFound, conflict } from '../utils.js';
import { evaluateDomain } from '../../shared/policyCompiler.js';
import { evaluateUrl } from '../../shared/urlFilter.js';
import { linuxInstaller, linuxPolicyJson, windowsPowerShellInstaller, windowsRegFile, browserPolicyMap } from '../../shared/browserPolicy.js';
import { PROTECTED_GOOGLE_APP_PREFIXES } from '../../shared/defaults.js';
import { can } from '../../shared/roles.js';
import { config } from '../config.js';
import type { PolicyProfile } from '../../shared/types.js';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/policyCompiler.js';

const r = Router();

/** Cerminkan aturan profil ke koleksi policyRules (satu dokumen per aturan) agar dapat di-query/diaudit. */
async function syncRules(policyId: string, p: any, uid: string) {
  await db().deleteWhere('policyRules', [['policyId', '==', policyId]], 5000);
  const kinds: [string, string[]][] = [['ALLOW_DOMAIN', p.allowedDomains ?? []], ['BLOCK_DOMAIN', p.blockedDomains ?? []], ['ALLOW_URL', p.allowedUrls ?? []], ['BLOCK_URL', p.blockedUrls ?? []]];
  for (const [kind, vals] of kinds) for (const value of vals) await db().create('policyRules', { policyId, kind, value, createdBy: uid });
}

r.get('/', requirePermission('policies.view'), ah(async (_req, res) => {
  const items = (await db().list('policies', { orderBy: { field: 'name' } })).items;
  const labs = (await db().list('laboratories')).items;
  res.json({ items: items.map((p) => ({ ...p, usedByLabs: labs.filter((l) => l.defaultPolicyId === p.id || l.activePolicyId === p.id).map((l) => ({ id: l.id, name: l.name })) })), nextCursor: null });
}));

r.get('/:id', requirePermission('policies.view'), ah(async (req, res) => {
  const p = await db().get('policies', req.params.id);
  if (!p) throw notFound('Profil kebijakan');
  const rules = (await db().list('policyRules', { where: [['policyId', '==', p.id]], limit: 2000 })).items;
  res.json({ ...p, rules });
}));

async function assertCoreRules(data: any, req: any, prev?: any) {
  // Kategori inti (proxy/VPN, DoH) TIDAK boleh dikeluarkan dari profil kecuali oleh Super Admin.
  const cats = (await db().list('websiteCategories')).items.filter((c) => c.core);
  const removing = cats.filter((c) => prev?.blockedCategoryIds?.includes(c.id) && !data.blockedCategoryIds?.includes(c.id));
  const missingOnCreate = !prev ? cats.filter((c) => !(data.blockedCategoryIds ?? []).includes(c.id)) : [];
  if ((removing.length || missingOnCreate.length) && !can(req.user.role, 'policies.core')) {
    if (!prev) data.blockedCategoryIds = [...new Set([...(data.blockedCategoryIds ?? []), ...cats.map((c) => c.id)])];
    else throw forbidden(`Kategori keamanan inti (${removing.map((c) => c.name).join(', ')}) hanya dapat diubah Super Admin`);
  }
  if (data.ipEnforcement === false && prev?.type === 'FULL_LOCK') throw badRequest('Profil FULL INTERNET LOCK selalu memakai penegakan IP');
}

r.post('/', requirePermission('policies.manage'), ah(async (req, res) => {
  const data = policySchema.parse(req.body);
  await assertCoreRules(data, req);
  const doc = await db().create('policies', { ...data, type: 'CUSTOM', builtin: false, revision: 1, createdBy: req.user!.uid });
  await syncRules(doc.id, doc, req.user!.uid);
  await audit(req, 'POLICY_CREATE', { targetId: doc.id, details: { name: doc.name } });
  res.status(201).json(doc);
}));

r.put('/:id', requirePermission('policies.manage'), ah(async (req, res) => {
  const prev = await db().get('policies', req.params.id);
  if (!prev) throw notFound('Profil kebijakan');
  const data: any = policySchema.partial().parse(req.body);
  if (prev.builtin) { delete data.name; } // nama profil bawaan tetap
  if (prev.type === 'FULL_LOCK') { data.googleSearch = false; data.allowedDomains = []; }
  await assertCoreRules({ ...prev, ...data }, req, prev);
  const doc = await db().update('policies', req.params.id, { ...data, revision: (prev.revision ?? 0) + 1 });
  await syncRules(req.params.id, doc, req.user!.uid);
  await audit(req, 'POLICY_UPDATE', { targetId: req.params.id, details: { name: prev.name, fields: Object.keys(data) } });
  const labs = await labsUsingPolicy(req.params.id);
  const deployments = labs.length ? await requestDeployment({ labIds: labs, reason: `POLICY_UPDATE:${prev.name}`, actor: req.user!.uid }) : [];
  res.json({ ...doc, deployments });
}));

r.delete('/:id', requirePermission('policies.manage'), ah(async (req, res) => {
  const p = await db().get('policies', req.params.id);
  if (!p) throw notFound('Profil kebijakan');
  if (p.builtin) throw forbidden('Profil bawaan tidak dapat dihapus');
  const used = (await db().list('laboratories')).items.filter((l) => l.defaultPolicyId === p.id || l.activePolicyId === p.id);
  if (used.length) throw conflict(`Profil masih dipakai: ${used.map((l) => l.name).join(', ')}`);
  if (await db().count('sessions', [['policyId', '==', p.id], ['status', 'in', ['SCHEDULED', 'ACTIVE']]])) throw conflict('Profil masih dipakai sesi terjadwal/aktif');
  await db().delete('policies', p.id);
  await db().deleteWhere('policyRules', [['policyId', '==', p.id]]);
  await audit(req, 'POLICY_DELETE', { targetId: p.id, details: { name: p.name } });
  res.json({ ok: true });
}));

r.post('/:id/duplicate', requirePermission('policies.manage'), ah(async (req, res) => {
  const p = await db().get('policies', req.params.id);
  if (!p) throw notFound('Profil kebijakan');
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = p;
  const doc = await db().create('policies', { ...rest, name: `${p.name} (Salinan)`, type: p.type === 'FULL_LOCK' ? 'FULL_LOCK' : 'CUSTOM', builtin: false, revision: 1, createdBy: req.user!.uid });
  await audit(req, 'POLICY_CREATE', { targetId: doc.id, details: { name: doc.name, duplicatedFrom: p.id } });
  res.status(201).json(doc);
}));

/** Pratinjau hasil kompilasi (DNS, firewall, browser) — untuk editor aturan. */
r.get('/:id/compiled', requirePermission('policies.view'), ah(async (req, res) => {
  const p = (await db().get('policies', req.params.id)) as PolicyProfile | null;
  if (!p) throw notFound('Profil kebijakan');
  const labId = typeof req.query.labId === 'string' ? req.query.labId : null;
  res.json(await compileForProfile(p, labId));
}));

/** Uji keputusan kebijakan: lapisan DNS (domain) dan lapisan browser (URL) diuji TERPISAH. */
r.post('/:id/evaluate', requirePermission('policies.view'), ah(async (req, res) => {
  const { inputs } = z.object({ inputs: z.array(z.string().min(1).max(500)).min(1).max(50) }).parse(req.body);
  const p = (await db().get('policies', req.params.id)) as PolicyProfile | null;
  if (!p) throw notFound('Profil kebijakan');
  const c = await compileForProfile(p, null);
  const results = inputs.map((input) => {
    const url = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    return { input, url, dns: host ? evaluateDomain(c, host) : null, browser: evaluateUrl(url, c.browser.URLBlocklist, c.browser.URLAllowlist) };
  });
  res.json({ profile: p.name, results, note: 'Lapisan DNS hanya melihat nama domain; lapisan browser (Chrome policy) melihat URL lengkap termasuk path. Hasil ini simulasi semantik — verifikasi akhir di browser terkelola.' });
}));

/** Unduh kebijakan browser. format: linux-json | windows-reg | windows-ps1 | linux-sh */
r.get('/:id/browser-policy', requirePermission('policies.view'), ah(async (req, res) => {
  const { format, labId } = z.object({ format: z.enum(['linux-json', 'windows-reg', 'windows-ps1', 'linux-sh', 'json']), labId: id.optional() }).parse(req.query);
  const p = (await db().get('policies', req.params.id)) as PolicyProfile | null;
  if (!p) throw notFound('Profil kebijakan');
  const c = labId ? (await compileLab(labId)).compiled : await compileForProfile(p, null);
  const version = createHash('sha256').update(stableStringify(browserPolicyMap(c))).digest('hex').slice(0, 12);
  const safe = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out: Record<string, [string, string, string]> = {
    'linux-json': [linuxPolicyJson(c), 'application/json', `labguard-${safe}.json`],
    json: [JSON.stringify(browserPolicyMap(c), null, 2), 'application/json', `labguard-${safe}.json`],
    'windows-reg': [windowsRegFile(c, version), 'text/plain', `labguard-${safe}.reg`],
    'windows-ps1': [windowsPowerShellInstaller(c, version, { baseUrl: config.PUBLIC_BASE_URL }), 'text/plain', `labguard-${safe}.ps1`],
    'linux-sh': [linuxInstaller(c, version, { baseUrl: config.PUBLIC_BASE_URL }), 'text/x-shellscript', `labguard-${safe}.sh`],
  };
  const [body, type, name] = out[format];
  await audit(req, 'BROWSER_POLICY_DOWNLOAD', { targetId: p.id, details: { format, version } });
  res.setHeader('Content-Type', `${type}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
}));

/**
 * Diagnostik resource Google Search: admin menempelkan host yang gagal dimuat (dari DevTools/chrome://net-export,
 * pesan ERR_BLOCKED_BY_ADMINISTRATOR / NXDOMAIN). Server memvalidasi bahwa host adalah resource (bukan aplikasi Google)
 * lalu dapat menambahkannya ke daftar resource secara terkontrol + audit.
 */
r.post('/google-diagnostics/analyze', requirePermission('policies.view'), ah(async (req, res) => {
  const { text } = z.object({ text: z.string().max(20000) }).parse(req.body);
  const settings = await getSettings();
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\/:\s"'),]|$)/gi)) found.add(m[1].toLowerCase());
  const results = [...found].slice(0, 100).map((host) => {
    const protectedApp = PROTECTED_GOOGLE_APP_PREFIXES.some((p) => host.startsWith(p) || host.includes(`.${p}`));
    const googleOwned = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|ggpht\.com)$/.test(host);
    const already = settings.google.resourceHosts.includes(host) || settings.google.searchHosts.includes(host);
    return { host, googleOwned, protectedApp, already, recommendation: already ? 'SUDAH_DIIZINKAN' : protectedApp ? 'JANGAN_TAMBAHKAN' : googleOwned ? 'BOLEH_DITAMBAHKAN' : 'BUKAN_RESOURCE_GOOGLE' };
  });
  res.json({ results });
}));

r.post('/google-diagnostics/add', requirePermission('policies.manage'), ah(async (req, res) => {
  const { hosts } = z.object({ hosts: z.array(domain).min(1).max(20) }).parse(req.body);
  const bad = hosts.filter((h) => PROTECTED_GOOGLE_APP_PREFIXES.some((p) => h.startsWith(p)) || !/(^|\.)(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|ggpht\.com)$/.test(h));
  if (bad.length) throw badRequest(`Host berikut tidak boleh ditambahkan sebagai resource Google Search: ${bad.join(', ')}`);
  const s = await getSettings(true);
  const resourceHosts = [...new Set([...s.google.resourceHosts, ...hosts])];
  await updateSettings({ google: { ...s.google, resourceHosts } });
  await audit(req, 'GOOGLE_RESOURCE_EXCEPTION_ADD', { details: { hosts } });
  const { redeployAll } = await import('../services/policyEngine.js');
  const deployments = await redeployAll('GOOGLE_RESOURCE_UPDATE', req.user!.uid);
  res.json({ resourceHosts, deployments: deployments.length });
}));

/** Pulihkan kebijakan: terapkan ulang (force) bundle saat ini atau perintahkan rollback di gateway. */
r.post('/redeploy', requirePermission('policies.rollback'), ah(async (req, res) => {
  const { labIds } = z.object({ labIds: z.array(id).min(1).max(100) }).parse(req.body);
  const deps = await requestDeployment({ labIds, reason: 'MANUAL_REDEPLOY', actor: req.user!.uid, force: true });
  await audit(req, 'POLICY_REDEPLOY', { details: { labIds, deployments: deps.map((d) => d.id) } });
  res.json({ deployments: deps });
}));

export default r;
