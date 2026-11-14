import { Router } from 'express';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { approveSchema, pageQuery, permissionRequestSchema, rejectSchema } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { requestDeployment } from '../services/policyEngine.js';
import { can } from '../../shared/roles.js';
import { badRequest, forbidden, jakartaToDate, notFound } from '../utils.js';
import { extractHostFromUrl, isValidDomain, domainMatches } from '../../shared/domain.js';
import type { Where } from '../store/types.js';

const r = Router();

async function blockingLayer(domain: string) {
  const blocked = (await db().list('blockedDomains', { limit: 10000 })).items.filter((b) => domainMatches(domain, b.domain) || domainMatches(b.domain, domain));
  if (!blocked.length) return null;
  const cats = new Map((await db().list('websiteCategories')).items.map((c) => [c.id, c]));
  const core = blocked.find((b) => b.core || cats.get(b.categoryId)?.core);
  if (core) return { layer: 'CORE', category: cats.get(core.categoryId)?.name ?? '' };
  return { layer: 'ADMIN', category: cats.get(blocked[0].categoryId)?.name ?? '' };
}

r.get('/', requirePermission('permissionRequests.create'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  if (!can(req.user!.role, 'permissionRequests.review')) where.push(['requestedBy', '==', req.user!.uid]); // guru: hanya miliknya
  if (typeof req.query.status === 'string' && req.query.status) where.push(['status', '==', req.query.status]);
  res.json(await db().list('permissionRequests', { where, orderBy: { field: 'createdAt', dir: 'desc' }, limit, cursor }));
}));

r.post('/', requirePermission('permissionRequests.create'), ah(async (req, res) => {
  const d = permissionRequestSchema.parse(req.body);
  const host = extractHostFromUrl(d.url);
  if (!host || !isValidDomain(host)) throw badRequest('URL tidak valid');
  const domain = host.replace(/^www\./, '');
  const validFrom = jakartaToDate(d.date, d.startTime), validUntil = jakartaToDate(d.date, d.endTime);
  if (validUntil.getTime() <= Date.now()) throw badRequest('Periode izin sudah lewat');
  const lab = await db().get('laboratories', d.labId);
  if (!lab) throw badRequest('Laboratorium tidak ditemukan');
  const blk = await blockingLayer(domain);
  const doc = await db().create('permissionRequests', { ...d, domain, validFrom, validUntil, status: 'PENDING', requestedBy: req.user!.uid, requestedByName: req.user!.name, blockedBy: blk ? `${blk.layer}:${blk.category}` : null, createdBy: req.user!.uid });
  await audit(req, 'PERMISSION_REQUEST_CREATE', { targetId: doc.id, details: { domain, date: d.date, startTime: d.startTime, endTime: d.endTime } });
  await notify({ kind: 'PERMISSION_REQUEST', severity: 'info', title: 'Permintaan izin website baru', message: `${req.user!.name} meminta akses ${domain} (${d.subject}) ${d.date} ${d.startTime}–${d.endTime}`, link: '/sites?tab=requests' });
  res.status(201).json(doc);
}));

r.post('/:id/approve', requirePermission('permissionRequests.review'), ah(async (req, res) => {
  const pr = await db().get('permissionRequests', req.params.id);
  if (!pr) throw notFound('Permintaan');
  if (pr.status !== 'PENDING') throw badRequest(`Permintaan berstatus ${pr.status}`);
  const a = approveSchema.parse(req.body);
  const date = a.date ?? pr.date, startTime = a.startTime ?? pr.startTime, endTime = a.endTime ?? pr.endTime;
  if (startTime >= endTime) throw badRequest('Jam selesai harus setelah jam mulai');
  const validFrom = jakartaToDate(date, startTime), validUntil = jakartaToDate(date, endTime);
  if (validUntil.getTime() <= Date.now()) throw badRequest('Periode izin sudah lewat');
  const blk = await blockingLayer(pr.domain);
  if (blk?.layer === 'CORE' && !a.coreOverride) throw badRequest(`Domain termasuk kebijakan keamanan inti (${blk.category}). Hanya Super Admin dengan opsi override inti yang dapat menyetujui.`);
  if (a.coreOverride && !can(req.user!.role, 'permissionRequests.coreOverride')) throw forbidden('Override kebijakan keamanan inti memerlukan otorisasi Super Admin');
  if (blk?.layer === 'ADMIN' && !a.overrideAdminBlock && !a.coreOverride) throw badRequest(`Domain diblokir kebijakan administrator (${blk.category}). Centang "Override blokir administrator" untuk mengizinkan sementara.`);
  // Sesi aktif/terjadwal di lab tsb pada tanggal itu → izin terikat sesi (dihapus otomatis saat sesi berakhir)
  const sess = (await db().list('sessions', { where: [['labId', '==', pr.labId], ['date', '==', date]], limit: 50 })).items.find((s) => ['SCHEDULED', 'ACTIVE'].includes(s.status) && Date.parse(s.startAt) < validUntil.getTime() && Date.parse(s.endAt) > validFrom.getTime());
  const allowed = await db().create('allowedDomains', {
    domain: pr.domain, note: `Izin sementara: ${pr.subject} — ${pr.reason.slice(0, 100)}`, scope: 'lab', labIds: [pr.labId], temporary: true,
    validFrom, expiresAt: validUntil, permissionRequestId: pr.id, sessionId: sess?.id ?? null, coreOverride: a.coreOverride, overrideAdminBlock: a.overrideAdminBlock || a.coreOverride, createdBy: req.user!.uid,
  });
  const doc = await db().update('permissionRequests', pr.id, { status: 'APPROVED', date, startTime, endTime, validFrom, validUntil, reviewedBy: req.user!.uid, reviewedByName: req.user!.name, reviewNote: a.note ?? '', reviewedAt: new Date(), allowedDomainId: allowed.id, coreOverride: a.coreOverride, overrideAdminBlock: a.overrideAdminBlock });
  await audit(req, 'PERMISSION_REQUEST_APPROVE', { targetId: pr.id, details: { domain: pr.domain, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString(), coreOverride: a.coreOverride, overrideAdminBlock: a.overrideAdminBlock, durationChanged: date !== pr.date || startTime !== pr.startTime || endTime !== pr.endTime } });
  const deployments = validFrom.getTime() <= Date.now() ? await requestDeployment({ labIds: [pr.labId], reason: `EXCEPTION_APPROVED:${pr.domain}`, actor: req.user!.uid }) : [];
  res.json({ ...doc, deployments: deployments.length, note: validFrom.getTime() > Date.now() ? 'Izin akan diaktifkan otomatis oleh penjadwal saat periode dimulai.' : undefined });
}));

r.post('/:id/reject', requirePermission('permissionRequests.review'), ah(async (req, res) => {
  const pr = await db().get('permissionRequests', req.params.id);
  if (!pr) throw notFound('Permintaan');
  if (pr.status !== 'PENDING') throw badRequest(`Permintaan berstatus ${pr.status}`);
  const { note } = rejectSchema.parse(req.body);
  const doc = await db().update('permissionRequests', pr.id, { status: 'REJECTED', reviewedBy: req.user!.uid, reviewedByName: req.user!.name, reviewNote: note, reviewedAt: new Date() });
  await audit(req, 'PERMISSION_REQUEST_REJECT', { targetId: pr.id, details: { domain: pr.domain, note } });
  res.json(doc);
}));

r.post('/:id/revoke', requirePermission('permissionRequests.review'), ah(async (req, res) => {
  const pr = await db().get('permissionRequests', req.params.id);
  if (!pr) throw notFound('Permintaan');
  if (pr.status !== 'APPROVED') throw badRequest('Hanya izin yang disetujui yang dapat dicabut');
  if (pr.allowedDomainId) await db().delete('allowedDomains', pr.allowedDomainId);
  const doc = await db().update('permissionRequests', pr.id, { status: 'REVOKED', reviewNote: `${pr.reviewNote ?? ''} | Dicabut oleh ${req.user!.name}`.trim() });
  await audit(req, 'PERMISSION_REQUEST_REVOKE', { targetId: pr.id, details: { domain: pr.domain } });
  await requestDeployment({ labIds: [pr.labId], reason: `EXCEPTION_REVOKED:${pr.domain}`, actor: req.user!.uid });
  res.json(doc);
}));

export default r;
