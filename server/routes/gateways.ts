import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { gatewayCommandSchema, gatewaySchema, pageQuery } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { getSettings, markSetup } from '../services/settings.js';
import { buildBundleContent, isGatewayOnline, requestDeployment } from '../services/policyEngine.js';
import { can } from '../../shared/roles.js';
import { badRequest, forbidden, notFound, randomCode, sha256, conflict } from '../utils.js';
import { config } from '../config.js';
import type { Gateway } from '../../shared/types.js';
import { installerScript, agentConfigYaml } from '../services/gatewayFiles.js';

const r = Router();
const PAIRING_TTL_MS = 30 * 60_000;

async function decorate(g: any) {
  const settings = await getSettings();
  const online = isGatewayOnline(g, settings);
  const [handled, devs] = await Promise.all([
    db().count('devices', [['gatewayId', '==', g.id]]),
    db().list('devices', { where: [['gatewayId', '==', g.id]], limit: 1000 }),
  ]);
  const active = devs.items.filter((d) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 6 * 60_000).length;
  // Status komponen hanya dipercaya bila heartbeat valid & baru; selain itu UNKNOWN
  const stale = { state: 'UNKNOWN', detail: 'Tidak ada heartbeat valid' };
  return { ...g, online, devicesHandled: handled, devicesActive: active, dns: online ? g.dns : g.status === 'PAIRED' ? stale : { state: 'NOT_CONFIGURED' }, firewall: online ? g.firewall : g.status === 'PAIRED' ? stale : { state: 'NOT_CONFIGURED' }, filtering: online ? g.filtering : g.status === 'PAIRED' ? stale : { state: 'NOT_CONFIGURED' } };
}

r.get('/', requirePermission('gateways.view'), ah(async (_req, res) => {
  const items = (await db().list('gateways', { orderBy: { field: 'name' } })).items;
  res.json({ items: await Promise.all(items.map(decorate)), nextCursor: null });
}));

r.get('/installer', requirePermission('gateways.view'), ah(async (_req, res) => {
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="install-labguard-gateway.sh"');
  res.send(installerScript(config.PUBLIC_BASE_URL));
}));

r.get('/:id', requirePermission('gateways.view'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  const [hb, deps, backups] = await Promise.all([
    db().list('gatewayHeartbeats', { where: [['gatewayId', '==', g.id]], orderBy: { field: 'ts', dir: 'desc' }, limit: 20 }),
    db().list('policyDeployments', { where: [['gatewayId', '==', g.id]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 20 }),
    db().list('configBackups', { where: [['gatewayId', '==', g.id]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 20 }),
  ]);
  const labs = await db().getMany('laboratories', g.labIds ?? []);
  res.json({ ...(await decorate(g)), heartbeats: hb.items, deployments: deps.items, backups: backups.items.map(({ content: _c, ...b }) => b), labs: labs.map((l) => ({ id: l.id, name: l.name, subnet: l.subnet })) });
}));

r.get('/:id/logs', requirePermission('gateways.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  res.json(await db().list('accessLogs', { where: [['gatewayId', '==', req.params.id]], orderBy: { field: 'ts', dir: 'desc' }, limit, cursor }));
}));

r.get('/:id/bundle-preview', requirePermission('gateways.view'), ah(async (req, res) => {
  const g = (await db().get('gateways', req.params.id)) as Gateway | null;
  if (!g) throw notFound('Gateway');
  res.json(await buildBundleContent(g));
}));

r.get('/:id/config', requirePermission('gateways.manage'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="labguard-agent-${g.id.slice(0, 8)}.yaml"`);
  await audit(req, 'GATEWAY_CONFIG_DOWNLOAD', { targetId: g.id });
  res.send(agentConfigYaml(config.PUBLIC_BASE_URL, g as Gateway));
}));

r.get('/:id/backups/:backupId', requirePermission('gateways.manage'), ah(async (req, res) => {
  const b = await db().get('configBackups', req.params.backupId);
  if (!b || b.gatewayId !== req.params.id) throw notFound('Backup');
  await audit(req, 'GATEWAY_BACKUP_DOWNLOAD', { targetId: b.id });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gateway-backup-${b.id.slice(0, 8)}.json"`);
  res.send(JSON.stringify(b, null, 2));
}));

r.post('/', requirePermission('gateways.manage'), ah(async (req, res) => {
  const data = gatewaySchema.parse(req.body);
  for (const l of data.labIds) { const lab = await db().get('laboratories', l); if (!lab) throw badRequest('Laboratorium tidak ditemukan'); if (lab.gatewayId) throw conflict(`${lab.name} sudah terhubung ke gateway lain`); }
  const code = randomCode();
  const gw = await db().create('gateways', { ...data, status: 'UNPAIRED', desiredPolicyVersion: 0, appliedPolicyVersion: null, desiredBundleHash: null, lastHeartbeatAt: null, lastSyncAt: null, pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), pendingCommands: [], protections: [], createdBy: req.user!.uid });
  await db().set('gatewaySecrets', gw.id, { gatewayId: gw.id, pairingCodeHash: sha256(code), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), secretEnc: null });
  for (const l of data.labIds) await db().update('laboratories', l, { gatewayId: gw.id });
  await audit(req, 'GATEWAY_REGISTER', { targetId: gw.id, details: { name: data.name } });
  await markSetup('gatewayRegistered', true, req.user!.uid);
  if (data.labIds.length) await requestDeployment({ labIds: data.labIds, reason: 'GATEWAY_REGISTERED', actor: req.user!.uid });
  res.status(201).json({ gateway: gw, pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString() });
}));

r.put('/:id', requirePermission('gateways.manage'), ah(async (req, res) => {
  const prev = await db().get('gateways', req.params.id);
  if (!prev) throw notFound('Gateway');
  const data = gatewaySchema.partial().parse(req.body);
  if (data.labIds) {
    for (const l of data.labIds) { const lab = await db().get('laboratories', l); if (!lab) throw badRequest('Laboratorium tidak ditemukan'); if (lab.gatewayId && lab.gatewayId !== prev.id) throw conflict(`${lab.name} sudah terhubung ke gateway lain`); }
    for (const l of prev.labIds ?? []) if (!data.labIds.includes(l)) await db().update('laboratories', l, { gatewayId: null });
    for (const l of data.labIds) await db().update('laboratories', l, { gatewayId: prev.id });
  }
  const doc = await db().update('gateways', prev.id, data);
  await audit(req, 'GATEWAY_UPDATE', { targetId: prev.id, details: { fields: Object.keys(data) } });
  if (data.labIds) await requestDeployment({ labIds: [...new Set([...(prev.labIds ?? []), ...data.labIds])], reason: 'GATEWAY_LABS_CHANGED', actor: req.user!.uid });
  res.json(await decorate(doc));
}));

/** Terbitkan kode pairing baru (pairing ulang / rotasi secret). Secret lama tetap berlaku sampai pairing baru berhasil. */
r.post('/:id/pairing-code', requirePermission('gateways.manage'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  const code = randomCode();
  const sec = (await db().get('gatewaySecrets', g.id)) ?? {};
  await db().set('gatewaySecrets', g.id, { ...sec, gatewayId: g.id, pairingCodeHash: sha256(code), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS) });
  if (g.status === 'REVOKED') await db().update('gateways', g.id, { status: 'UNPAIRED' });
  await db().update('gateways', g.id, { pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS) });
  await audit(req, g.status === 'PAIRED' ? 'GATEWAY_TOKEN_ROTATE' : 'GATEWAY_PAIRING_CODE', { targetId: g.id });
  res.json({ pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString() });
}));

r.post('/:id/revoke', requirePermission('gateways.manage'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  await db().set('gatewaySecrets', g.id, { gatewayId: g.id, secretEnc: null, pairingCodeHash: null, pairingExpiresAt: null, revokedAt: new Date(), revokedBy: req.user!.uid });
  const doc = await db().update('gateways', g.id, { status: 'REVOKED', pendingCommands: [] });
  await audit(req, 'GATEWAY_TOKEN_REVOKE', { targetId: g.id, details: { name: g.name } });
  res.json(await decorate(doc));
}));

r.delete('/:id', requirePermission('gateways.manage'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  if (g.status === 'PAIRED') throw badRequest('Cabut (revoke) gateway terlebih dahulu sebelum menghapus');
  for (const l of g.labIds ?? []) await db().update('laboratories', l, { gatewayId: null });
  await db().delete('gateways', g.id);
  await db().delete('gatewaySecrets', g.id);
  await audit(req, 'GATEWAY_DELETE', { targetId: g.id, details: { name: g.name } });
  res.json({ ok: true });
}));

/** Antrekan operasi yang DIIZINKAN saja (tidak ada eksekusi perintah shell bebas). */
r.post('/:id/commands', requirePermission('gateways.test'), ah(async (req, res) => {
  const { type } = gatewayCommandSchema.parse(req.body);
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  if (g.status !== 'PAIRED') throw badRequest('Gateway belum dipasangkan');
  const needsManage = ['APPLY_POLICY', 'BACKUP_CONFIGURATION'].includes(type) && !can(req.user!.role, 'gateways.manage');
  const needsRollback = type === 'ROLLBACK' && !can(req.user!.role, 'policies.rollback');
  if (needsManage || needsRollback) throw forbidden();
  const cmd = { id: randomUUID(), type, issuedAt: new Date().toISOString(), issuedBy: req.user!.uid };
  const pending = [...(g.pendingCommands ?? []).filter((c: any) => c.type !== type), cmd].slice(-10);
  await db().update('gateways', g.id, { pendingCommands: pending });
  if (type === 'APPLY_POLICY' || type === 'SYNC_CONFIGURATION') await requestDeployment({ labIds: g.labIds ?? [], reason: `MANUAL_${type}`, actor: req.user!.uid, force: type === 'APPLY_POLICY' });
  await audit(req, type === 'ROLLBACK' ? 'GATEWAY_ROLLBACK_REQUEST' : 'GATEWAY_COMMAND', { targetId: g.id, details: { type } });
  const settings = await getSettings();
  res.json({ queued: cmd, online: isGatewayOnline(g, settings), note: isGatewayOnline(g, settings) ? 'Perintah akan dieksekusi pada heartbeat berikutnya.' : 'Gateway OFFLINE — perintah menunggu sampai gateway terhubung kembali.' });
}));

/** Tes koneksi: hanya membaca status heartbeat aktual (tidak ada simulasi). */
r.post('/:id/test-connection', requirePermission('gateways.test'), ah(async (req, res) => {
  const g = await db().get('gateways', req.params.id);
  if (!g) throw notFound('Gateway');
  const settings = await getSettings();
  const online = isGatewayOnline(g, settings);
  const ageSec = g.lastHeartbeatAt ? Math.round((Date.now() - Date.parse(g.lastHeartbeatAt)) / 1000) : null;
  if (g.status === 'PAIRED') {
    const cmd = { id: randomUUID(), type: 'CHECK_STATUS', issuedAt: new Date().toISOString(), issuedBy: req.user!.uid };
    await db().update('gateways', g.id, { pendingCommands: [...(g.pendingCommands ?? []).filter((c: any) => c.type !== 'CHECK_STATUS'), cmd].slice(-10) });
  }
  await audit(req, 'GATEWAY_TEST_CONNECTION', { targetId: g.id, details: { online, ageSec } });
  res.json({ status: g.status, online, lastHeartbeatAt: g.lastHeartbeatAt ?? null, heartbeatAgeSec: ageSec, offlineAfterSec: settings.gateway.offlineAfterSec, appliedPolicyVersion: g.appliedPolicyVersion, desiredPolicyVersion: g.desiredPolicyVersion,
    message: g.status !== 'PAIRED' ? 'Gateway belum dipasangkan (BELUM DIKONFIGURASI).' : online ? `Online — heartbeat ${ageSec} detik lalu.` : `OFFLINE — heartbeat terakhir ${ageSec === null ? 'tidak pernah' : `${ageSec} detik lalu`}. Gateway mempertahankan kebijakan terakhir yang valid.` });
}));

export default r;
