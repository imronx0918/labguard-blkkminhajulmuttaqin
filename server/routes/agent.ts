// API komunikasi LAB GATEWAY AGENT. Gateway selalu melakukan koneksi KELUAR via HTTPS;
// tidak ada port administrasi gateway yang perlu dibuka ke internet.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../store/index.js';
import { ah } from '../middleware/errors.js';
import { requireGateway } from '../middleware/agentAuth.js';
import { applyResultSchema, eventsSchema, heartbeatSchema, pairSchema } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { getSettings, markSetup } from '../services/settings.js';
import { notify } from '../services/notifications.js';
import { buildBundleContent, isGatewayOnline, requestDeployment } from '../services/policyEngine.js';
import { refreshSessionsForDeployment } from '../services/sessions.js';
import { HttpError, encrypt, jakartaDayKey, randomToken, sha256, safeEqual } from '../utils.js';
import type { Gateway } from '../../shared/types.js';
import { z } from 'zod';

const r = Router();

const pairLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Terlalu banyak percobaan pairing' } } });
const agentLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.headers.authorization ?? req.ip) });

/** POST /api/agent/pair — tukar kode pairing sekali pakai dengan secret gateway. */
r.post('/pair', pairLimiter, ah(async (req, res) => {
  const body = pairSchema.parse(req.body);
  const hash = sha256(body.code);
  const secrets = await db().list('gatewaySecrets', { where: [['pairingCodeHash', '==', hash]], limit: 1 });
  const sec = secrets.items[0];
  if (!sec || !safeEqual(sec.pairingCodeHash, hash) || !sec.pairingExpiresAt || Date.parse(sec.pairingExpiresAt) < Date.now()) {
    await audit(req, 'GATEWAY_PAIR', { details: { hostname: body.hostname }, result: 'FAILURE', actor: { uid: 'agent', name: `Agent ${body.hostname}` } });
    throw new HttpError(401, 'Kode pairing tidak valid atau kedaluwarsa', 'PAIRING_INVALID');
  }
  const gw = await db().get('gateways', sec.gatewayId);
  if (!gw) throw new HttpError(404, 'Gateway tidak ditemukan', 'NOT_FOUND');
  const secret = randomToken(32);
  // kode sekali pakai: langsung dihapus
  await db().set('gatewaySecrets', gw.id, { gatewayId: gw.id, secretEnc: encrypt(secret), pairingCodeHash: null, pairingExpiresAt: null, pairedAt: new Date(), rotatedFrom: sec.secretEnc ? 'previous' : null });
  await db().update('gateways', gw.id, { status: 'PAIRED', agentVersion: body.agentVersion, localIp: body.localIp || null, pairingExpiresAt: null, hostname: body.hostname });
  await audit(req, sec.secretEnc ? 'GATEWAY_TOKEN_ROTATE' : 'GATEWAY_PAIR', { targetId: gw.id, details: { hostname: body.hostname, agentVersion: body.agentVersion }, actor: { uid: `gateway:${gw.id}`, name: `Gateway ${gw.name}` } });
  const settings = await getSettings();
  res.json({ gatewayId: gw.id, secret, name: gw.name, heartbeatIntervalSec: settings.gateway.heartbeatIntervalSec, serverTime: new Date().toISOString() });
}));

r.use(agentLimiter, requireGateway);

/** GET /api/agent/policy/current — bundle kebijakan terkompilasi untuk gateway ini. */
r.get('/policy/current', ah(async (req, res) => {
  let gw = (await db().get('gateways', req.gateway!.id)) as Gateway;
  const settings = await getSettings();
  const content = await buildBundleContent(gw);
  if (content.hash !== gw.desiredBundleHash) {
    // Konten berubah tanpa deployment tercatat (mis. gateway baru, pengecualian kedaluwarsa) — catat deployment baru
    await requestDeployment({ labIds: gw.labIds ?? [], reason: 'AUTO_CONTENT_CHANGE', actor: 'system' });
    gw = (await db().get('gateways', gw.id)) as Gateway;
  }
  const pending = await db().list('policyDeployments', { where: [['gatewayId', '==', gw.id]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 1 });
  const dep = pending.items[0];
  if (dep && !dep.fetchedAt) await db().update('policyDeployments', dep.id, { fetchedAt: new Date() });
  res.json({
    schema: 'labguard.bundle/v1', gatewayId: gw.id, version: gw.desiredPolicyVersion, hash: content.hash, generatedAt: new Date().toISOString(),
    mode: settings.mode, // DEMO: agent hanya memvalidasi (dry-run), TIDAK menerapkan ke jaringan
    deploymentId: dep && dep.bundleHash === content.hash ? dep.id : null,
    logging: { storeAllowedEvents: settings.logs.storeAllowedEvents },
    labs: content.labs,
  });
}));

/** POST /api/agent/heartbeat */
r.post('/heartbeat', ah(async (req, res) => {
  const hb = heartbeatSchema.parse(req.body);
  const gw = (await db().get('gateways', req.gateway!.id)) as Gateway;
  const settings = await getSettings();
  const wasOnline = isGatewayOnline(gw, settings);
  const pending = (gw.pendingCommands ?? []).filter((c) => !hb.completedCommandIds.includes(c.id));
  await db().update('gateways', gw.id, {
    lastHeartbeatAt: new Date(), agentVersion: hb.agentVersion, localIp: hb.localIp || gw.localIp || null, appliedPolicyVersion: hb.appliedPolicyVersion,
    dns: hb.dns, firewall: hb.firewall, filtering: hb.filtering, protections: hb.protections, pendingCommands: pending, clientCount: hb.clients.length,
  });
  await db().create('gatewayHeartbeats', { gatewayId: gw.id, ts: new Date(), agentVersion: hb.agentVersion, appliedPolicyVersion: hb.appliedPolicyVersion, dns: hb.dns.state, firewall: hb.firewall.state, filtering: hb.filtering.state, clients: hb.clients.length, uptimeSec: hb.uptimeSec ?? null });
  if (!wasOnline) {
    await db().create('accessLogs', { ts: new Date(), type: 'DEVICE_ONLINE', gatewayId: gw.id, deviceName: `Gateway ${gw.name}`, reason: 'Gateway kembali online (heartbeat valid)', dayKey: jakartaDayKey() });
    await markSetup('gatewayInstalled', true, `gateway:${gw.id}`);
  }
  for (const [k, c] of [['DNS', hb.dns], ['Firewall', hb.firewall]] as const) {
    if (c.state === 'ERROR') await notify({ kind: 'CONFIG_ERROR', severity: 'error', title: `${k} gateway bermasalah`, message: `${gw.name}: ${c.detail ?? 'error'}`, link: '/gateways', dedupeKey: `comp-${gw.id}-${k}` });
  }
  // Pemetaan IP klien → perangkat (IP dari DHCP lease gateway; bukan dasar autentikasi)
  res.json({ ok: true, serverTime: new Date().toISOString(), desiredPolicyVersion: gw.desiredPolicyVersion, desiredBundleHash: gw.desiredBundleHash ?? null, commands: pending, heartbeatIntervalSec: settings.gateway.heartbeatIntervalSec, mode: settings.mode });
}));

/** POST /api/agent/events — log pemblokiran/izin (domain-level; tanpa isi komunikasi). */
r.post('/events', ah(async (req, res) => {
  const { events } = eventsSchema.parse(req.body);
  const gw = (await db().get('gateways', req.gateway!.id)) as Gateway;
  const settings = await getSettings();
  const devices = (await db().list('devices', { where: [['gatewayId', '==', gw.id]], limit: 2000 })).items;
  const byIp = new Map(devices.filter((d) => d.ip).map((d) => [d.ip, d]));
  const labs = await db().getMany('laboratories', gw.labIds ?? []);
  const sessionByLab = new Map<string, any>();
  for (const l of labs) if (l.activeSessionId) sessionByLab.set(l.id, await db().get('sessions', l.activeSessionId));
  let stored = 0, blocked = 0, bypass = 0;
  for (const e of events) {
    if (e.type === 'ALLOWED' && !settings.logs.storeAllowedEvents) continue;
    const dev = e.clientIp ? byIp.get(e.clientIp) : undefined;
    const labId = e.labId ?? dev?.labId ?? null;
    const sess = labId ? sessionByLab.get(labId) : null;
    const ts = new Date(e.ts);
    const dayKey = jakartaDayKey(ts);
    await db().create('accessLogs', {
      ts, type: e.type, gatewayId: gw.id, deviceId: dev?.id ?? null, deviceName: dev?.name ?? null, clientIp: e.clientIp || null,
      labId, classId: sess?.classId ?? dev?.classId ?? null, sessionId: sess?.status === 'ACTIVE' ? sess.id : null,
      domain: e.domain ? e.domain.toLowerCase().slice(0, 253) : null, path: null, category: e.category ?? null, reason: e.reason ?? null,
      policyId: sess?.policyId ?? labs.find((l) => l.id === labId)?.activePolicyId ?? null, policyVersion: e.policyVersion ?? gw.appliedPolicyVersion ?? null, dayKey,
    });
    stored++;
    if (e.type === 'ALLOWED' || e.type === 'BLOCKED') {
      const d = (e.domain ?? '').toLowerCase();
      const key = /(^|\.)google\.(com|co\.id)$/.test(d) ? 'google' : /youtube|youtu\.be|ytimg|googlevideo/.test(d) ? 'youtube' : /tiktok|bytedance|byteoversea|ibytedtos|musical\.ly/.test(d) ? 'tiktok' : 'other';
      await db().increment('dailyStats', dayKey, { total: 1, [e.type === 'BLOCKED' ? 'blocked' : 'allowed']: 1, [`sites.${key}.${e.type === 'BLOCKED' ? 'blocked' : 'allowed'}`]: 1 }, { dayKey });
    }
    if (e.type === 'BLOCKED') blocked++;
    if (e.type === 'BYPASS_ATTEMPT') bypass++;
  }
  if (blocked) await notify({ kind: 'BLOCKED_ATTEMPT', severity: 'warning', title: 'Percobaan akses situs terlarang', message: `${blocked} permintaan diblokir di ${gw.name} dalam batch terakhir.`, link: '/activity', dedupeKey: `blocked-${gw.id}`, dedupeMinutes: 15 });
  if (bypass) await notify({ kind: 'BLOCKED_ATTEMPT', severity: 'error', title: 'Indikasi percobaan bypass', message: `${bypass} indikasi bypass (DoH/DoT/VPN/DNS alternatif) terdeteksi di ${gw.name}.`, link: '/activity?type=BYPASS_ATTEMPT', dedupeKey: `bypass-${gw.id}`, dedupeMinutes: 15 });
  res.json({ ok: true, stored });
}));

/** POST /api/agent/apply-result — SATU-SATUNYA jalur yang dapat menyatakan kebijakan "diterapkan". */
r.post('/apply-result', ah(async (req, res) => {
  const body = applyResultSchema.parse(req.body);
  const gw = (await db().get('gateways', req.gateway!.id)) as Gateway;
  const settings = await getSettings();
  let dep = body.deploymentId ? await db().get('policyDeployments', body.deploymentId) : null;
  if (dep && dep.gatewayId !== gw.id) throw new HttpError(403, 'Deployment bukan milik gateway ini', 'FORBIDDEN');
  if (!dep) dep = (await db().list('policyDeployments', { where: [['gatewayId', '==', gw.id], ['bundleHash', '==', body.bundleHash]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 1 })).items[0] ?? null;
  const dryRun = settings.mode !== 'LIVE';
  const status = !body.success ? (body.rolledBack ? 'ROLLED_BACK' : 'FAILED') : dryRun ? 'SIMULATED_DEMO' : 'CONFIRMED';
  if (dep) await db().update('policyDeployments', dep.id, { status, confirmedAt: body.success && !dryRun ? new Date() : null, error: body.error ?? null, checks: body.checks, durationMs: body.durationMs ?? null, dryRun });
  if (body.success && !dryRun) await db().update('gateways', gw.id, { appliedPolicyVersion: body.version, lastSyncAt: new Date(), appliedBundleHash: body.bundleHash });
  if (body.success && dryRun) await db().update('gateways', gw.id, { lastValidatedAt: new Date(), lastValidatedVersion: body.version });
  await db().create('accessLogs', { ts: new Date(), type: body.success ? 'POLICY_APPLIED' : 'POLICY_FAILED', gatewayId: gw.id, deviceName: `Gateway ${gw.name}`, reason: body.success ? (dryRun ? `Validasi DEMO (dry-run) v${body.version} lolos — tidak diterapkan ke jaringan` : `Kebijakan v${body.version} diterapkan & dikonfirmasi agent`) : `Gagal: ${body.error ?? 'tidak diketahui'}${body.rolledBack ? ' (rollback ke konfigurasi sebelumnya)' : ''}`, policyVersion: body.version, dayKey: jakartaDayKey() });
  await audit(req, body.success ? 'POLICY_APPLY_CONFIRMED' : body.rolledBack ? 'CONFIG_ROLLBACK' : 'POLICY_APPLY_FAILED', { targetId: dep?.id, details: { version: body.version, dryRun, error: body.error ?? null, checksPassed: body.checks.filter((c) => c.passed).length, checksTotal: body.checks.length }, result: body.success ? 'SUCCESS' : 'FAILURE' });
  if (body.success) {
    if (!dryRun) await notify({ kind: 'POLICY_APPLIED', severity: 'success', title: 'Kebijakan berhasil diterapkan', message: `${gw.name} mengonfirmasi kebijakan v${body.version}.`, link: '/gateways', dedupeKey: `applied-${gw.id}-${body.version}` });
    if (body.checks.length && body.checks.every((c) => c.passed)) await markSetup('networkCheck', true, `gateway:${gw.id}`, dryRun ? 'Validasi dry-run lolos' : 'Penerapan LIVE terkonfirmasi');
  } else {
    await notify({ kind: 'SYNC_FAILED', severity: 'error', title: 'Penerapan kebijakan gagal', message: `${gw.name}: ${body.error ?? 'error'}${body.rolledBack ? ' — konfigurasi sebelumnya dipulihkan.' : ''}`, link: '/gateways' });
  }
  if (dep) await refreshSessionsForDeployment(dep.id);
  res.json({ ok: true, status });
}));

/** POST /api/agent/backup — unggah salinan konfigurasi (nftables/dnsmasq) sebelum perubahan. */
r.post('/backup', ah(async (req, res) => {
  const body = z.object({ reason: z.string().max(100), version: z.number().int().nullable(), files: z.record(z.string().max(200_000)).refine((f) => Object.keys(f).length <= 10) }).parse(req.body);
  const doc = await db().create('configBackups', { gatewayId: req.gateway!.id, reason: body.reason, version: body.version, files: Object.keys(body.files), content: body.files, size: JSON.stringify(body.files).length });
  // simpan maksimal 20 backup per gateway
  const all = await db().list('configBackups', { where: [['gatewayId', '==', req.gateway!.id]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 100 });
  for (const old of all.items.slice(20)) await db().delete('configBackups', old.id);
  res.json({ ok: true, id: doc.id });
}));

export default r;
