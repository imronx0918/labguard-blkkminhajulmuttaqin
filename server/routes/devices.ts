import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { deviceSchema, pageQuery, id } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { getSettings, markSetup } from '../services/settings.js';
import { notify } from '../services/notifications.js';
import { compileLab } from '../services/policyEngine.js';
import { notFound, badRequest, randomToken, sha256 } from '../utils.js';
import { linuxInstaller, windowsPowerShellInstaller } from '../../shared/browserPolicy.js';
import { config } from '../config.js';
import type { Where } from '../store/types.js';

export const DEVICE_ONLINE_MS = 6 * 60_000; // agen perangkat melapor tiap 5 menit
export const withOnline = (d: any) => ({ ...d, online: !!d.lastSeenAt && d.status === 'active' && Date.now() - Date.parse(d.lastSeenAt) < DEVICE_ONLINE_MS });

const r = Router();

r.get('/', requirePermission('devices.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  for (const f of ['labId', 'classId', 'status', 'group', 'gatewayId'] as const) if (typeof req.query[f] === 'string' && req.query[f]) where.push([f, '==', req.query[f]]);
  const scope = req.user!.labIds?.length && req.user!.role !== 'super_admin' ? req.user!.labIds : null;
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
  const conn = req.query.connection as string | undefined;
  const needsPostFilter = !!q || !!conn || !!scope;
  const page = await db().list('devices', { where, orderBy: { field: 'name' }, limit: needsPostFilter ? 2000 : limit, cursor: needsPostFilter ? null : cursor });
  let items = page.items.map(withOnline);
  if (scope) items = items.filter((d) => scope.includes(d.labId));
  if (q) items = items.filter((d) => [d.name, d.inventoryNo, d.ip, d.mac, d.id].some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (conn === 'online') items = items.filter((d) => d.online);
  if (conn === 'offline') items = items.filter((d) => !d.online);
  res.json(needsPostFilter ? { items: items.slice(0, limit), nextCursor: null } : { items, nextCursor: page.nextCursor });
}));

r.get('/:id', requirePermission('devices.view'), ah(async (req, res) => {
  const d = await db().get('devices', req.params.id);
  if (!d) throw notFound('Perangkat');
  let expectedPolicyVersion: string | null = null;
  if (d.labId) expectedPolicyVersion = (await compileLab(d.labId)).browserVersion;
  res.json({ ...withOnline(d), expectedPolicyVersion });
}));

r.get('/:id/logs', requirePermission('devices.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  res.json(await db().list('accessLogs', { where: [['deviceId', '==', req.params.id]], orderBy: { field: 'ts', dir: 'desc' }, limit, cursor }));
}));

r.post('/', requirePermission('devices.manage'), ah(async (req, res) => {
  const data = deviceSchema.parse(req.body);
  const deviceId = randomUUID(); // identitas perangkat = UUID (bukan MAC)
  if (data.labId && !data.gatewayId) data.gatewayId = (await db().get('laboratories', data.labId))?.gatewayId ?? null;
  const doc = await db().create('devices', { ...data, status: 'active', credentialStatus: 'none', lastSeenAt: null, appliedPolicyVersion: null, policyApplyStatus: 'NOT_CONFIGURED', createdBy: req.user!.uid }, deviceId);
  await audit(req, 'DEVICE_CREATE', { targetId: deviceId, details: { name: data.name } });
  await markSetup('deviceRegistered', true, req.user!.uid);
  res.status(201).json(withOnline(doc));
}));

r.put('/:id', requirePermission('devices.manage'), ah(async (req, res) => {
  const prev = await db().get('devices', req.params.id);
  if (!prev) throw notFound('Perangkat');
  const data = deviceSchema.partial().parse(req.body);
  if (data.labId && data.labId !== prev.labId && !data.gatewayId) data.gatewayId = (await db().get('laboratories', data.labId))?.gatewayId ?? null;
  const doc = await db().update('devices', req.params.id, data);
  await audit(req, 'DEVICE_UPDATE', { targetId: req.params.id, details: { fields: Object.keys(data) } });
  res.json(withOnline(doc));
}));

r.delete('/:id', requirePermission('devices.manage'), ah(async (req, res) => {
  const prev = await db().get('devices', req.params.id);
  if (!prev) throw notFound('Perangkat');
  await db().delete('devices', req.params.id);
  await db().delete('deviceCredentials', req.params.id);
  await audit(req, 'DEVICE_DELETE', { targetId: req.params.id, details: { name: prev.name } });
  res.json({ ok: true });
}));

/** Registrasi: menerbitkan token perangkat (ditampilkan SEKALI) + installer. Token lama otomatis tidak berlaku. */
r.post('/:id/register', requirePermission('devices.manage'), ah(async (req, res) => {
  const d = await db().get('devices', req.params.id);
  if (!d) throw notFound('Perangkat');
  const { platform } = z.object({ platform: z.enum(['windows', 'linux']) }).parse(req.body);
  if (!d.labId) throw badRequest('Tetapkan laboratorium perangkat sebelum registrasi');
  const token = randomToken(32);
  await db().set('deviceCredentials', d.id, { deviceId: d.id, tokenHash: sha256(token), revoked: false, issuedBy: req.user!.uid, issuedAt: new Date() });
  await db().update('devices', d.id, { credentialStatus: 'issued', policyApplyStatus: 'OUTDATED' });
  const { compiled, browserVersion } = await compileLab(d.labId);
  const opts = { baseUrl: config.PUBLIC_BASE_URL, deviceId: d.id, deviceToken: token };
  const script = platform === 'windows' ? windowsPowerShellInstaller(compiled, browserVersion, opts) : linuxInstaller(compiled, browserVersion, opts);
  await audit(req, 'DEVICE_CREDENTIAL_ISSUE', { targetId: d.id, details: { platform } });
  await markSetup('deviceRegistered', true, req.user!.uid);
  res.json({ deviceId: d.id, token, filename: platform === 'windows' ? `labguard-${d.name}.ps1` : `labguard-${d.name}.sh`, script, note: 'Token hanya ditampilkan sekali. Simpan installer secara aman.' });
}));

r.post('/:id/revoke', requirePermission('devices.manage'), ah(async (req, res) => {
  const d = await db().get('devices', req.params.id);
  if (!d) throw notFound('Perangkat');
  await db().update('deviceCredentials', d.id, { revoked: true, revokedAt: new Date(), revokedBy: req.user!.uid });
  const doc = await db().update('devices', d.id, { credentialStatus: 'revoked', policyApplyStatus: 'NOT_CONFIGURED' });
  await audit(req, 'DEVICE_CREDENTIAL_REVOKE', { targetId: d.id, details: { name: d.name } });
  res.json(withOnline(doc));
}));

r.post('/:id/status', requirePermission('devices.manage'), ah(async (req, res) => {
  const { status } = z.object({ status: z.enum(['active', 'disabled']) }).parse(req.body);
  const doc = await db().update('devices', req.params.id, { status });
  if (!doc) throw notFound('Perangkat');
  await audit(req, status === 'disabled' ? 'DEVICE_DISABLE' : 'DEVICE_ENABLE', { targetId: req.params.id });
  res.json(withOnline(doc));
}));

/** Minta sinkronisasi ulang: agen perangkat akan menarik kebijakan pada check-in berikutnya. */
r.post('/:id/resync', requirePermission('devices.manage'), ah(async (req, res) => {
  const d = await db().get('devices', req.params.id);
  if (!d) throw notFound('Perangkat');
  if (d.credentialStatus !== 'issued') throw badRequest('Perangkat belum diregistrasi (BELUM DIKONFIGURASI). Lakukan registrasi terlebih dahulu.');
  const doc = await db().update('devices', d.id, { resyncRequestedAt: new Date(), policyApplyStatus: 'OUTDATED' });
  await audit(req, 'DEVICE_RESYNC', { targetId: d.id });
  res.json(withOnline(doc));
}));

r.post('/bulk-group', requirePermission('devices.manage'), ah(async (req, res) => {
  const { ids, group } = z.object({ ids: z.array(id).min(1).max(500), group: z.string().max(60) }).parse(req.body);
  for (const i of ids) await db().update('devices', i, { group });
  await audit(req, 'DEVICE_GROUP', { details: { count: ids.length, group } });
  res.json({ ok: true, count: ids.length });
}));

/** Pasangkan perangkat ke gateway (gateway lab) */
r.post('/:id/pair-gateway', requirePermission('devices.manage'), ah(async (req, res) => {
  const { gatewayId } = z.object({ gatewayId: id }).parse(req.body);
  const gw = await db().get('gateways', gatewayId);
  if (!gw) throw notFound('Gateway');
  const doc = await db().update('devices', req.params.id, { gatewayId });
  await audit(req, 'DEVICE_PAIR_GATEWAY', { targetId: req.params.id, details: { gatewayId } });
  res.json(withOnline(doc));
}));

export default r;

// ------------------------------------------------- Endpoint agen perangkat (token per perangkat)
export const deviceAgentRouter = Router();
deviceAgentRouter.get('/browser-policy', ah(async (req, res) => {
  const d = await db().get('devices', req.device!.id);
  if (!d?.labId) throw badRequest('Perangkat belum ditetapkan ke laboratorium');
  const { compiled, browserVersion, profile } = await compileLab(d.labId);
  const { browserPolicyMap } = await import('../../shared/browserPolicy.js');
  res.json({ version: browserVersion, profileName: profile.name, policy: browserPolicyMap(compiled) });
}));
deviceAgentRouter.post('/checkin', ah(async (req, res) => {
  const { deviceCheckinSchema } = await import('../validators/index.js');
  const body = deviceCheckinSchema.parse(req.body);
  const d = await db().get('devices', req.device!.id);
  if (!d) throw notFound('Perangkat');
  const expected = d.labId ? (await compileLab(d.labId)).browserVersion : null;
  const status = body.status === 'FAILED' ? 'FAILED' : body.appliedPolicyVersion && body.appliedPolicyVersion === expected ? 'UP_TO_DATE' : 'OUTDATED';
  const wasOffline = !withOnline(d).online;
  const settings = await getSettings();
  await db().update('devices', d.id, {
    lastSeenAt: new Date(), appliedPolicyVersion: body.appliedPolicyVersion ?? null, policyApplyStatus: status,
    os: body.os ?? d.os ?? null, browser: body.browser ?? d.browser ?? null, agentVersion: body.agentVersion ?? null, ip: req.ip?.replace('::ffff:', '') ?? d.ip ?? null, resyncRequestedAt: null,
  });
  if (!d.lastSeenAt) {
    await notify({ kind: 'NEW_DEVICE', severity: 'info', title: 'Perangkat baru terhubung', message: `${d.name} melakukan check-in pertama.`, link: `/devices` });
  }
  if (wasOffline) await db().create('accessLogs', { ts: new Date(), type: 'DEVICE_ONLINE', deviceId: d.id, deviceName: d.name, labId: d.labId ?? null, dayKey: (await import('../utils.js')).jakartaDayKey(), reason: 'Check-in agen perangkat' });
  if (status === 'UP_TO_DATE') await markSetup('chromePolicy', true, 'device-agent');
  if (status === 'FAILED') await notify({ kind: 'DEVICE_POLICY_OUTDATED', severity: 'warning', title: 'Perangkat gagal menerapkan kebijakan', message: `${d.name}: ${body.error ?? 'tidak diketahui'}`, link: '/devices', dedupeKey: `devfail-${d.id}` });
  res.json({ ok: true, expectedVersion: expected, status });
}));
