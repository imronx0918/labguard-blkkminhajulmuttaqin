import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { allowedDomainSchema, blockedBulkSchema, blockedDomainSchema, categorySchema, pageQuery } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { redeployAll } from '../services/policyEngine.js';
import { can } from '../../shared/roles.js';
import { forbidden, notFound, conflict, badRequest } from '../utils.js';
import { isValidDomain, normalizeDomain } from '../../shared/domain.js';
import type { Request } from 'express';

const r = Router();

async function assertCanTouchCategory(req: Request, categoryId: string) {
  const cat = await db().get('websiteCategories', categoryId);
  if (!cat) throw notFound('Kategori');
  if (cat.core && !can(req.user!.role, 'sites.core')) throw forbidden('Kategori keamanan inti hanya dapat diubah Super Admin');
  return cat;
}

// ---------------- Kategori
r.get('/categories', requirePermission('sites.view'), ah(async (_req, res) => {
  const cats = (await db().list('websiteCategories', { orderBy: { field: 'name' } })).items;
  const counts = await Promise.all(cats.map((c) => db().count('blockedDomains', [['categoryId', '==', c.id]])));
  res.json({ items: cats.map((c, i) => ({ ...c, domainCount: counts[i] })), nextCursor: null });
}));
r.post('/categories', requirePermission('sites.manage'), ah(async (req, res) => {
  const data = categorySchema.parse(req.body);
  if (data.core && !can(req.user!.role, 'sites.core')) throw forbidden('Hanya Super Admin yang dapat membuat kategori inti');
  if (await db().count('websiteCategories', [['slug', '==', data.slug]])) throw conflict('Slug kategori sudah dipakai');
  const doc = await db().create('websiteCategories', { ...data, createdBy: req.user!.uid });
  await audit(req, 'CATEGORY_CREATE', { targetId: doc.id, details: { name: doc.name } });
  res.status(201).json(doc);
}));
r.put('/categories/:id', requirePermission('sites.manage'), ah(async (req, res) => {
  const cat = await assertCanTouchCategory(req, req.params.id);
  const data = categorySchema.partial().parse(req.body);
  if (data.core !== undefined && data.core !== cat.core && !can(req.user!.role, 'sites.core')) throw forbidden('Status kategori inti hanya dapat diubah Super Admin');
  const doc = await db().update('websiteCategories', cat.id, data);
  await audit(req, 'CATEGORY_UPDATE', { targetId: cat.id, details: { name: cat.name, fields: Object.keys(data) } });
  const deployments = await redeployAll(`CATEGORY_UPDATE:${cat.name}`, req.user!.uid);
  res.json({ ...doc, deployments: deployments.length });
}));
r.delete('/categories/:id', requirePermission('sites.manage'), ah(async (req, res) => {
  const cat = await assertCanTouchCategory(req, req.params.id);
  if (await db().count('blockedDomains', [['categoryId', '==', cat.id]])) throw conflict('Kategori masih berisi domain');
  await db().delete('websiteCategories', cat.id);
  await audit(req, 'CATEGORY_DELETE', { targetId: cat.id, details: { name: cat.name } });
  res.json({ ok: true });
}));

// ---------------- Domain diblokir
r.get('/blocked', requirePermission('sites.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: any[] = [];
  if (typeof req.query.categoryId === 'string' && req.query.categoryId) where.push(['categoryId', '==', req.query.categoryId]);
  const q = typeof req.query.q === 'string' ? normalizeDomain(req.query.q) : '';
  if (q) {
    const all = await db().list('blockedDomains', { where, limit: 5000 });
    return res.json({ items: all.items.filter((d) => d.domain.includes(q)).slice(0, limit), nextCursor: null });
  }
  res.json(await db().list('blockedDomains', { where, orderBy: { field: 'domain' }, limit, cursor }));
}));
r.post('/blocked', requirePermission('sites.manage'), ah(async (req, res) => {
  const data = blockedDomainSchema.parse(req.body);
  const cat = await assertCanTouchCategory(req, data.categoryId);
  if (await db().count('blockedDomains', [['domain', '==', data.domain]])) throw conflict(`${data.domain} sudah ada dalam daftar blokir`);
  const doc = await db().create('blockedDomains', { ...data, core: !!cat.core, createdBy: req.user!.uid });
  await audit(req, 'BLOCKED_DOMAIN_ADD', { targetId: doc.id, details: { domain: data.domain, category: cat.name } });
  const deployments = await redeployAll('BLOCKLIST_UPDATE', req.user!.uid);
  res.status(201).json({ ...doc, deployments: deployments.length });
}));
r.post('/blocked/bulk', requirePermission('sites.manage'), ah(async (req, res) => {
  const { categoryId, domains } = blockedBulkSchema.parse(req.body);
  const cat = await assertCanTouchCategory(req, categoryId);
  const added: string[] = [], skipped: string[] = [], invalid: string[] = [];
  for (const raw of domains) {
    const d = normalizeDomain(raw);
    if (!isValidDomain(d)) { invalid.push(raw); continue; }
    if (await db().count('blockedDomains', [['domain', '==', d]])) { skipped.push(d); continue; }
    await db().create('blockedDomains', { domain: d, categoryId, includeSubdomains: true, core: !!cat.core, createdBy: req.user!.uid });
    added.push(d);
  }
  await audit(req, 'BLOCKED_DOMAIN_BULK_ADD', { details: { category: cat.name, added: added.length, skipped: skipped.length, invalid: invalid.length } });
  if (added.length) await redeployAll('BLOCKLIST_UPDATE', req.user!.uid);
  res.json({ added, skipped, invalid });
}));
r.delete('/blocked/:id', requirePermission('sites.manage'), ah(async (req, res) => {
  const d = await db().get('blockedDomains', req.params.id);
  if (!d) throw notFound('Domain');
  await assertCanTouchCategory(req, d.categoryId);
  await db().delete('blockedDomains', d.id);
  await audit(req, 'BLOCKED_DOMAIN_REMOVE', { targetId: d.id, details: { domain: d.domain } });
  await redeployAll('BLOCKLIST_UPDATE', req.user!.uid);
  res.json({ ok: true });
}));

// ---------------- Domain diizinkan (daftar izin global/lab; pengecualian sementara dibuat via permission requests)
r.get('/allowed', requirePermission('sites.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: any[] = [];
  if (req.query.temporary === 'true') where.push(['temporary', '==', true]);
  if (req.query.temporary === 'false') where.push(['temporary', '==', false]);
  res.json(await db().list('allowedDomains', { where, orderBy: { field: 'domain' }, limit, cursor }));
}));
r.post('/allowed', requirePermission('sites.manage'), ah(async (req, res) => {
  const data = allowedDomainSchema.parse(req.body);
  if (data.scope === 'lab' && !data.labIds.length) throw badRequest('Pilih minimal satu laboratorium untuk izin per-lab');
  if (await db().count('allowedDomains', [['domain', '==', data.domain], ['temporary', '==', false]])) throw conflict(`${data.domain} sudah ada di daftar izin`);
  const doc = await db().create('allowedDomains', { ...data, temporary: false, validFrom: null, expiresAt: null, createdBy: req.user!.uid });
  await audit(req, 'ALLOWED_DOMAIN_ADD', { targetId: doc.id, details: { domain: data.domain, scope: data.scope } });
  await redeployAll('ALLOWLIST_UPDATE', req.user!.uid);
  res.status(201).json(doc);
}));
r.delete('/allowed/:id', requirePermission('sites.manage'), ah(async (req, res) => {
  const d = await db().get('allowedDomains', req.params.id);
  if (!d) throw notFound('Domain');
  await db().delete('allowedDomains', d.id);
  if (d.permissionRequestId) await db().update('permissionRequests', d.permissionRequestId, { status: 'REVOKED', reviewNote: 'Dicabut dari daftar izin' });
  await audit(req, 'ALLOWED_DOMAIN_REMOVE', { targetId: d.id, details: { domain: d.domain } });
  await redeployAll('ALLOWLIST_UPDATE', req.user!.uid);
  res.json({ ok: true });
}));

r.post('/check', requirePermission('sites.view'), ah(async (req, res) => {
  const { domain } = z.object({ domain: z.string().max(253) }).parse(req.body);
  const d = normalizeDomain(domain);
  const blocked = (await db().list('blockedDomains', { limit: 10000 })).items.filter((b) => d === b.domain || d.endsWith('.' + b.domain));
  const cats = new Map((await db().list('websiteCategories')).items.map((c) => [c.id, c]));
  res.json({ domain: d, matches: blocked.map((b) => ({ domain: b.domain, category: cats.get(b.categoryId)?.name, core: !!cats.get(b.categoryId)?.core })) });
}));

export default r;
