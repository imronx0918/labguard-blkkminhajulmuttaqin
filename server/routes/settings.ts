import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { settingsSchema } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { SETUP_STEPS, getSettings, markSetup, updateSettings } from '../services/settings.js';
import { isGatewayOnline, redeployAll } from '../services/policyEngine.js';
import { badRequest } from '../utils.js';
import { config } from '../config.js';
import { loadDemoData, clearDemoData } from '../services/seed.js';
import type { Collection } from '../store/types.js';

const r = Router();

r.get('/', requirePermission('settings.view'), ah(async (_req, res) => res.json(await getSettings(true))));

r.put('/', requirePermission('settings.manage'), ah(async (req, res) => {
  const patch = settingsSchema.parse(req.body);
  const cur = await getSettings(true);
  const merged: any = {};
  for (const [k, v] of Object.entries(patch)) merged[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(cur as any)[k], ...v } : v;
  const s = await updateSettings(merged);
  if (patch.institution?.name) await markSetup('institution', true, req.user!.uid);
  await audit(req, 'SETTINGS_UPDATE', { details: { sections: Object.keys(patch) } });
  if (patch.google || patch.security) await redeployAll('SETTINGS_UPDATE', req.user!.uid);
  res.json(s);
}));

/** Status checklist instalasi terpandu: langkah otomatis dihitung dari data aktual, bukan dicentang manual. */
async function computeSetup() {
  const s = await getSettings(true);
  const [supers, labs, gws, devices, devicesUpToDate] = await Promise.all([
    db().count('users', [['role', '==', 'super_admin'], ['active', '==', true]]),
    db().count('laboratories'), db().list('gateways'), db().count('devices', [['credentialStatus', '==', 'issued']]),
    db().count('devices', [['policyApplyStatus', '==', 'UP_TO_DATE']]),
  ]);
  const paired = gws.items.filter((g) => g.status === 'PAIRED');
  const online = paired.filter((g) => isGatewayOnline(g, s));
  const auto: Record<string, { done: boolean; detail: string }> = {
    firebase: { done: config.AUTH_MODE === 'firebase' && config.DATA_STORE === 'firestore', detail: config.AUTH_MODE === 'firebase' && config.DATA_STORE === 'firestore' ? `Firebase project: ${config.FIREBASE_PROJECT_ID ?? '(ADC)'}` : `AUTH_MODE=${config.AUTH_MODE}, DATA_STORE=${config.DATA_STORE} (DEMO)` },
    superAdmin: { done: supers > 0, detail: `${supers} Super Admin aktif` },
    institution: { done: !!s.institution.name, detail: s.institution.name || 'Nama lembaga belum diisi' },
    laboratory: { done: labs > 0, detail: `${labs} laboratorium` },
    gatewayRegistered: { done: gws.items.length > 0, detail: `${gws.items.length} gateway terdaftar` },
    gatewayInstalled: { done: online.length > 0, detail: online.length ? `${online.length} gateway online (heartbeat valid)` : 'Belum ada heartbeat valid' },
    networkCheck: { done: !!s.setup.networkCheck?.done, detail: s.setup.networkCheck?.note ?? 'Menunggu laporan validasi dari gateway agent' },
    deviceRegistered: { done: devices > 0, detail: `${devices} perangkat memiliki kredensial` },
    chromePolicy: { done: devicesUpToDate > 0, detail: `${devicesUpToDate} perangkat melaporkan kebijakan browser terbaru` },
  };
  const steps = SETUP_STEPS.map((st) => {
    const stored = s.setup[st.key];
    const a = auto[st.key];
    const done = st.key === 'liveMode' ? s.mode === 'LIVE' : a ? a.done : !!stored?.done;
    return { key: st.key, label: st.label, auto: st.auto, done, detail: a?.detail ?? stored?.note ?? '', at: stored?.at ?? null, by: stored?.by ?? null };
  });
  const required = steps.filter((x) => x.key !== 'liveMode' && x.key !== 'firebase' || (x.key === 'firebase' && config.NODE_ENV === 'production'));
  const canGoLive = required.every((x) => x.done);
  return { mode: s.mode, steps, canGoLive, missing: required.filter((x) => !x.done).map((x) => x.label) };
}

r.get('/setup', requirePermission('settings.view'), ah(async (_req, res) => res.json(await computeSetup())));

/** Catat hasil uji manual (Google Search / TikTok / YouTube) pada perangkat terkelola. */
r.post('/setup/:key', requirePermission('settings.manage'), ah(async (req, res) => {
  const key = req.params.key;
  if (!['testGoogleSearch', 'testTiktok', 'testYoutube'].includes(key)) throw badRequest('Langkah ini dihitung otomatis dari data sistem');
  const { passed, note, deviceName } = z.object({ passed: z.boolean(), note: z.string().max(300).default(''), deviceName: z.string().max(80).default('') }).parse(req.body);
  await markSetup(key, passed, req.user!.uid, `${passed ? 'LULUS' : 'GAGAL'}${deviceName ? ` di ${deviceName}` : ''}${note ? ` — ${note}` : ''}`);
  await audit(req, 'SETUP_TEST_RECORDED', { details: { key, passed, deviceName, note }, result: passed ? 'SUCCESS' : 'FAILURE' });
  res.json(await computeSetup());
}));

r.post('/mode', requirePermission('system.mode'), ah(async (req, res) => {
  const { mode, confirm } = z.object({ mode: z.enum(['DEMO', 'LIVE']), confirm: z.literal(true) }).parse(req.body);
  if (mode === 'LIVE') {
    const st = await computeSetup();
    if (!st.canGoLive) throw badRequest(`LIVE MODE belum dapat diaktifkan. Lengkapi: ${st.missing.join('; ')}`);
    const demoDocs = await db().count('devices', [['demo', '==', true]]);
    if (demoDocs) throw badRequest('Hapus data DEMO terlebih dahulu sebelum mengaktifkan LIVE MODE.');
  }
  await updateSettings({ mode, liveActivatedAt: mode === 'LIVE' ? new Date().toISOString() : null, liveActivatedBy: mode === 'LIVE' ? req.user!.uid : null });
  await audit(req, mode === 'LIVE' ? 'LIVE_MODE_ACTIVATE' : 'DEMO_MODE_ACTIVATE');
  const deps = await redeployAll(`MODE_${mode}`, req.user!.uid);
  res.json({ mode, deployments: deps.length });
}));

// ---------------- Backup & pemulihan konfigurasi
const BACKUP_COLS: Collection[] = ['policies', 'policyRules', 'websiteCategories', 'blockedDomains', 'allowedDomains', 'laboratories', 'classes'];
r.get('/backup', requirePermission('backup.manage'), ah(async (req, res) => {
  const out: Record<string, unknown> = { schema: 'labguard.backup/v1', exportedAt: new Date().toISOString(), settings: await getSettings(true) };
  for (const c of BACKUP_COLS) out[c] = (await db().list(c, { limit: 20000 })).items.filter((d) => !(c === 'allowedDomains' && d.temporary));
  await audit(req, 'CONFIG_BACKUP_EXPORT');
  res.setHeader('Content-Disposition', `attachment; filename="labguard-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
}));
r.post('/restore', requirePermission('backup.manage'), ah(async (req, res) => {
  const body = z.object({ schema: z.literal('labguard.backup/v1'), policies: z.array(z.record(z.any())), websiteCategories: z.array(z.record(z.any())), blockedDomains: z.array(z.record(z.any())), allowedDomains: z.array(z.record(z.any())).default([]), policyRules: z.array(z.record(z.any())).default([]) }).passthrough().parse(req.body);
  const counts: Record<string, number> = {};
  for (const c of ['policies', 'websiteCategories', 'blockedDomains', 'allowedDomains', 'policyRules'] as const) {
    const docs = (body as any)[c] as any[];
    counts[c] = 0;
    for (const d of docs.slice(0, 20000)) {
      if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(d.id)) continue;
      const { id, createdAt: _c, updatedAt: _u, ...rest } = d;
      await db().set(c, id, rest); counts[c]++;
    }
  }
  await audit(req, 'CONFIG_ROLLBACK', { details: { source: 'backup-file', counts, exportedAt: (body as any).exportedAt } });
  const deps = await redeployAll('CONFIG_RESTORE', req.user!.uid);
  res.json({ restored: counts, deployments: deps.length });
}));

// ---------------- Data DEMO (hanya pada MODE DEMO, selalu ditandai demo:true)
r.post('/demo-data', requirePermission('settings.manage'), ah(async (req, res) => {
  const s = await getSettings(true);
  if (s.mode !== 'DEMO') throw badRequest('Data contoh hanya dapat dimuat pada MODE DEMO');
  const result = await loadDemoData(req.user!.uid);
  await audit(req, 'DEMO_DATA_LOAD', { details: result });
  res.json(result);
}));
r.delete('/demo-data', requirePermission('settings.manage'), ah(async (req, res) => {
  const result = await clearDemoData();
  await audit(req, 'DEMO_DATA_CLEAR', { details: result });
  res.json(result);
}));

export default r;
