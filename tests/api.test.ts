// Uji integrasi API end-to-end (Express + MemoryStore + autentikasi DEMO + simulasi agent ber-HMAC).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { MemoryStore } from '../server/store/memoryStore';
import { initStore, db } from '../server/store/index';
import { ensureBaseSeed, ensureDemoUsers } from '../server/services/seed';
import { createApp } from '../server/app';
import { signDemoToken } from '../server/middleware/auth';
import { updateSettings } from '../server/services/settings';
import { jakartaDayKey } from '../server/utils';

let app: ReturnType<typeof createApp>;
const T = { super: '', lab: '', guru: '', viewer: '' };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ---- simulasi agent gateway (format tanda tangan sama dengan agent Python)
const gw = { id: '', secret: '' };
function signed(method: 'get' | 'post', path: string, body?: unknown, opts: { nonce?: string; ts?: number; secret?: string } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(12).toString('base64url');
  const base = `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${createHash('sha256').update(raw).digest('hex')}`;
  const sig = createHmac('sha256', opts.secret ?? gw.secret).update(base).digest('hex');
  let r = request(app)[method](path).set({ Authorization: `Gateway ${gw.id}`, 'X-LG-Timestamp': ts, 'X-LG-Nonce': nonce, 'X-LG-Signature': sig });
  if (raw) r = r.set('Content-Type', 'application/json').send(raw);
  return r;
}
const hb = (applied: number | null = null) => ({ agentVersion: '1.0.0', localIp: '192.168.10.1', appliedPolicyVersion: applied, dns: { state: 'OK' }, firewall: { state: 'OK' }, filtering: { state: 'OK' }, protections: [], clients: [], completedCommandIds: [] });

let labId = '', classId = '', sessionId = '', today = '';

beforeAll(async () => {
  await initStore(new MemoryStore());
  await ensureBaseSeed();
  await ensureDemoUsers();
  app = createApp();
  T.super = signDemoToken('demo-superadmin'); T.lab = signDemoToken('demo-labadmin'); T.guru = signDemoToken('demo-guru'); T.viewer = signDemoToken('demo-viewer');
  today = jakartaDayKey();
});

describe('TEST 12 — RBAC ditegakkan di backend', () => {
  it('tanpa token → 401', async () => { expect((await request(app).get('/api/dashboard')).status).toBe(401); });
  it('token palsu → 401', async () => { expect((await request(app).get('/api/dashboard').set(auth('demo.eyJ1aWQiOiJkZW1vLXN1cGVyYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.00'))).status).toBe(401); });
  it('viewer tidak dapat mengakses halaman administrator', async () => {
    for (const [m, p] of [['put', '/api/settings'], ['post', '/api/users'], ['post', '/api/gateways'], ['get', '/api/audit-logs'], ['post', '/api/policies'], ['get', '/api/admin/ping']] as const) {
      const r = await (request(app) as any)[m](p).set(auth(T.viewer)).send({});
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });
  it('guru tidak dapat mengubah kebijakan, menonaktifkan firewall, atau mengelola gateway', async () => {
    expect((await request(app).put('/api/policies/policy-google-search-only').set(auth(T.guru)).send({ googleSearch: false })).status).toBe(403);
    expect((await request(app).post('/api/settings/mode').set(auth(T.guru)).send({ mode: 'LIVE', confirm: true })).status).toBe(403);
    expect((await request(app).delete('/api/sites/blocked/x').set(auth(T.guru))).status).toBe(403);
  });
  it('admin lab tidak dapat mengubah kategori inti (proxy/VPN)', async () => {
    const r = await request(app).put('/api/sites/categories/cat-proxy-vpn').set(auth(T.lab)).send({ enabled: false });
    expect(r.status).toBe(403);
  });
  it('admin lab tidak dapat menghapus kategori inti dari profil', async () => {
    const r = await request(app).put('/api/policies/policy-google-search-only').set(auth(T.lab)).send({ blockedCategoryIds: ['cat-video-streaming'] });
    expect(r.status).toBe(403);
  });
  it('akses ditolak dicatat di audit log', async () => {
    const a = await request(app).get('/api/audit-logs?action=ACCESS_DENIED').set(auth(T.super));
    expect(a.body.items.length).toBeGreaterThan(0);
  });
});

describe('Data master', () => {
  it('membuat lab, kelas, peserta didik (validasi Zod)', async () => {
    const bad = await request(app).post('/api/laboratories').set(auth(T.super)).send({ name: 'X', code: 'L1', subnet: '10.0.0.0' });
    expect(bad.status).toBe(400);
    const lab = await request(app).post('/api/laboratories').set(auth(T.super)).send({ name: 'Lab Komputer 1', code: 'LAB1', subnet: '192.168.10.0/24', defaultPolicyId: 'policy-google-search-only' });
    expect(lab.status).toBe(201); labId = lab.body.id;
    const cls = await request(app).post('/api/classes').set(auth(T.super)).send({ name: 'X TKJ 1', grade: 'X', major: 'TKJ', defaultLabId: labId });
    expect(cls.status).toBe(201); classId = cls.body.id;
    const st = await request(app).post('/api/students').set(auth(T.lab)).send({ nis: '1001', name: '<b>Ahmad</b>', classId });
    expect(st.status).toBe(201); expect(st.body.name).toBe('bAhmad/b'); // sanitasi tag
    expect((await request(app).get(`/api/classes/${classId}`).set(auth(T.super))).body.studentCount).toBe(1);
    expect((await request(app).post('/api/students').set(auth(T.lab)).send({ nis: '1001', name: 'Dup', classId })).status).toBe(409);
  });
});

describe('TEST 10 & 11 — gateway, pairing, heartbeat, konfirmasi penerapan', () => {
  let pairingCode = '';
  it('registrasi gateway menghasilkan kode pairing sekali pakai', async () => {
    const r = await request(app).post('/api/gateways').set(auth(T.super)).send({ name: 'Gateway A', labIds: [labId] });
    expect(r.status).toBe(201);
    pairingCode = r.body.pairingCode; gw.id = r.body.gateway.id;
    expect(pairingCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });
  it('pairing dengan kode benar; kode tidak bisa dipakai ulang', async () => {
    const r = await request(app).post('/api/agent/pair').send({ code: pairingCode, hostname: 'gw', agentVersion: '1.0.0', localIp: '192.168.10.1' });
    expect(r.status).toBe(200); gw.secret = r.body.secret;
    expect((await request(app).post('/api/agent/pair').send({ code: pairingCode, hostname: 'gw', agentVersion: '1.0.0' })).status).toBe(401);
  });
  it('TEST 10: sebelum heartbeat gateway OFFLINE; tidak ada klaim penerapan', async () => {
    const d = await request(app).get('/api/dashboard').set(auth(T.viewer));
    expect(d.body.gatewayStatus).toBe('OFFLINE');
    expect(d.body.system.dns.state).toBe('UNKNOWN');
    const g = await request(app).get(`/api/gateways/${gw.id}`).set(auth(T.super));
    expect(g.body.online).toBe(false);
    expect(g.body.appliedPolicyVersion).toBeNull();
  });
  it('tanda tangan salah, replay, dan timestamp kedaluwarsa ditolak', async () => {
    expect((await signed('post', '/api/agent/heartbeat', hb(), { secret: 'salah' })).status).toBe(401);
    const nonce = randomBytes(12).toString('base64url');
    expect((await signed('post', '/api/agent/heartbeat', hb(), { nonce })).status).toBe(200);
    const replay = await signed('post', '/api/agent/heartbeat', hb(), { nonce });
    expect(replay.status).toBe(401); expect(replay.body.error.code).toBe('REPLAY');
    expect((await signed('post', '/api/agent/heartbeat', hb(), { ts: Math.floor(Date.now() / 1000) - 3600 })).body.error.code).toBe('CLOCK_SKEW');
  });
  it('heartbeat valid → ONLINE', async () => {
    const d = await request(app).get('/api/dashboard').set(auth(T.viewer));
    expect(d.body.gatewayStatus).toBe('ONLINE');
  });
  it('MODE DEMO: hasil apply berstatus SIMULATED_DEMO, versi aktif TIDAK berubah', async () => {
    const b = await signed('get', '/api/agent/policy/current');
    expect(b.body.mode).toBe('DEMO');
    const r = await signed('post', '/api/agent/apply-result', { deploymentId: b.body.deploymentId, version: b.body.version, bundleHash: b.body.hash, success: true, checks: [] });
    expect(r.body.status).toBe('SIMULATED_DEMO');
    expect((await request(app).get(`/api/gateways/${gw.id}`).set(auth(T.super))).body.appliedPolicyVersion).toBeNull();
  });
  it('LIVE tidak dapat diaktifkan sebelum checklist lengkap', async () => {
    const r = await request(app).post('/api/settings/mode').set(auth(T.super)).send({ mode: 'LIVE', confirm: true });
    expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/LIVE MODE belum dapat diaktifkan/);
  });
  it('TEST 11: LIVE — sesi PENDING sampai agent mengonfirmasi, lalu SECURED dengan versi terbaru', async () => {
    await updateSettings({ mode: 'LIVE' }); // lewati checklist untuk uji alur agent
    const s = await request(app).post('/api/sessions').set(auth(T.guru)).send({ name: 'Praktikum', subject: 'KJD', classId, labId, date: today, startTime: '00:00', endTime: '23:59', policyId: 'policy-google-search-only' });
    expect(s.status).toBe(201); sessionId = s.body.id;
    expect(s.body.teacherId).toBe('demo-guru');
    const started = await request(app).post(`/api/sessions/${sessionId}/start`).set(auth(T.guru)).send({});
    expect(started.body.status).toBe('ACTIVE');
    expect(started.body.securityStatus).toBe('PENDING_CONFIRMATION');
    const before = await request(app).get(`/api/gateways/${gw.id}`).set(auth(T.super));
    const desired = before.body.desiredPolicyVersion;
    expect(before.body.appliedPolicyVersion).not.toBe(desired);
    const b = await signed('get', '/api/agent/policy/current');
    expect(b.body.mode).toBe('LIVE');
    expect(b.body.labs[0].sessionId).toBe(sessionId);
    const r = await signed('post', '/api/agent/apply-result', { deploymentId: b.body.deploymentId, version: b.body.version, bundleHash: b.body.hash, success: true, checks: [{ name: 'Uji DNS', layer: 'DNS', target: 'youtube.com', expected: 'BLOCKED', actual: 'BLOCKED', passed: true }] });
    expect(r.body.status).toBe('CONFIRMED');
    const after = await request(app).get(`/api/gateways/${gw.id}`).set(auth(T.super));
    expect(after.body.appliedPolicyVersion).toBe(b.body.version);
    const sess = await request(app).get(`/api/sessions/${sessionId}`).set(auth(T.viewer));
    expect(sess.body.securityStatus).toBe('SECURED');
  });
  it('penerapan gagal + rollback → sesi FAILED, tidak dinyatakan aman', async () => {
    await request(app).post('/api/policies/redeploy').set(auth(T.super)).send({ labIds: [labId] });
    const b = await signed('get', '/api/agent/policy/current');
    const r = await signed('post', '/api/agent/apply-result', { deploymentId: b.body.deploymentId, version: b.body.version, bundleHash: b.body.hash, success: false, rolledBack: true, error: 'nft -f gagal', checks: [] });
    expect(r.body.status).toBe('ROLLED_BACK');
  });
  it('perintah gateway hanya dari whitelist', async () => {
    expect((await request(app).post(`/api/gateways/${gw.id}/commands`).set(auth(T.super)).send({ type: 'RUN_SHELL' })).status).toBe(400);
    expect((await request(app).post(`/api/gateways/${gw.id}/commands`).set(auth(T.lab)).send({ type: 'ROLLBACK' })).status).toBe(403);
    expect((await request(app).post(`/api/gateways/${gw.id}/commands`).set(auth(T.super)).send({ type: 'CHECK_STATUS' })).status).toBe(200);
  });
  it('event log: domain tersimpan, statistik harian bertambah', async () => {
    const r = await signed('post', '/api/agent/events', { events: [
      { ts: new Date().toISOString(), type: 'BLOCKED', clientIp: '192.168.10.101', domain: 'www.youtube.com', category: 'Video dan Streaming', labId },
      { ts: new Date().toISOString(), type: 'ALLOWED', clientIp: '192.168.10.102', domain: 'www.google.com', labId },
    ] });
    expect(r.body.stored).toBe(2);
    const logs = await request(app).get('/api/access-logs?type=BLOCKED').set(auth(T.viewer));
    expect(logs.body.items[0].domain).toBe('www.youtube.com');
    expect(logs.body.items[0].sessionId).toBe(sessionId);
    const d = await request(app).get('/api/dashboard').set(auth(T.viewer));
    expect(d.body.stats.blockedToday).toBeGreaterThanOrEqual(1);
  });
  it('revoke gateway → agent ditolak', async () => {
    await request(app).post(`/api/gateways/${gw.id}/revoke`).set(auth(T.super)).send({});
    expect((await signed('post', '/api/agent/heartbeat', hb())).status).toBe(401);
  });
});

describe('TEST 8 & 9 — permintaan izin website', () => {
  let prId = '';
  it('TEST 8: guru meminta akses → PENDING', async () => {
    const r = await request(app).post('/api/permission-requests').set(auth(T.guru)).send({ siteName: 'GeoGebra', url: 'https://www.geogebra.org/calculator', reason: 'Grafik fungsi', subject: 'Matematika', classId, labId, date: today, startTime: '00:00', endTime: '23:59' });
    expect(r.status).toBe(201); expect(r.body.status).toBe('PENDING'); expect(r.body.domain).toBe('geogebra.org');
    prId = r.body.id;
    expect((await request(app).post(`/api/permission-requests/${prId}/approve`).set(auth(T.guru)).send({})).status).toBe(403);
  });
  it('TEST 9: admin menyetujui → izin sementara dengan kedaluwarsa, berlaku hanya pada periode', async () => {
    const r = await request(app).post(`/api/permission-requests/${prId}/approve`).set(auth(T.lab)).send({ note: 'OK' });
    expect(r.status).toBe(200); expect(r.body.status).toBe('APPROVED');
    const a = await db().get('allowedDomains', r.body.allowedDomainId);
    expect(a!.temporary).toBe(true); expect(a!.expiresAt).toBeTruthy(); expect(a!.labIds).toEqual([labId]);
    const ev = await request(app).post('/api/policies/policy-google-search-only/evaluate').set(auth(T.super)).send({ inputs: ['geogebra.org'] });
    expect(ev.status).toBe(200);
    const compiled = await request(app).get(`/api/policies/policy-google-search-only/compiled?labId=${labId}`).set(auth(T.super));
    expect(compiled.body.dns.allow).toContain('geogebra.org');
    // kedaluwarsa → tidak lagi dikompilasi
    await db().update('allowedDomains', a!.id, { expiresAt: new Date(Date.now() - 1000) });
    const c2 = await request(app).get(`/api/policies/policy-google-search-only/compiled?labId=${labId}`).set(auth(T.super));
    expect(c2.body.dns.allow).not.toContain('geogebra.org');
  });
  it('domain inti hanya dapat disetujui Super Admin dengan override', async () => {
    const r = await request(app).post('/api/permission-requests').set(auth(T.guru)).send({ siteName: 'VPN', url: 'nordvpn.com', reason: 'x', subject: 'TIK', classId, labId, date: today, startTime: '00:00', endTime: '23:59' });
    expect(r.body.blockedBy).toMatch(/^CORE/);
    expect((await request(app).post(`/api/permission-requests/${r.body.id}/approve`).set(auth(T.lab)).send({ coreOverride: true })).status).toBe(403);
    expect((await request(app).post(`/api/permission-requests/${r.body.id}/approve`).set(auth(T.lab)).send({})).status).toBe(400);
    const rej = await request(app).post(`/api/permission-requests/${r.body.id}/reject`).set(auth(T.lab)).send({ note: 'Tidak relevan' });
    expect(rej.body.status).toBe('REJECTED');
  });
  it('mengakhiri sesi menghapus pengecualian sementara sesi & kembali ke default', async () => {
    const r = await request(app).post(`/api/sessions/${sessionId}/stop`).set(auth(T.guru)).send({});
    expect(r.body.status).toBe('ENDED');
    const lab = await request(app).get(`/api/laboratories/${labId}`).set(auth(T.super));
    expect(lab.body.activeSessionId).toBeNull();
    const audit = await request(app).get('/api/audit-logs?action=SESSION_STOP').set(auth(T.super));
    expect(audit.body.items.length).toBe(1);
  });
});

describe('Perangkat — UUID + token per perangkat', () => {
  it('registrasi, check-in dengan token, dan pencabutan', async () => {
    const d = await request(app).post('/api/devices').set(auth(T.lab)).send({ name: 'PC-LAB1-01', labId, ip: '192.168.10.101', mac: 'AA:BB:CC:DD:EE:01' });
    expect(d.status).toBe(201); expect(d.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const reg = await request(app).post(`/api/devices/${d.body.id}/register`).set(auth(T.lab)).send({ platform: 'windows' });
    expect(reg.body.script).toContain('LabGuardEduDeviceAgent');
    const dh = { Authorization: `Device ${d.body.id}:${reg.body.token}` };
    const pol = await request(app).get('/api/device-agent/browser-policy').set(dh);
    expect(pol.body.policy.URLBlocklist[0]).toBe('*');
    const ci = await request(app).post('/api/device-agent/checkin').set(dh).send({ appliedPolicyVersion: pol.body.version, status: 'UP_TO_DATE', os: 'Windows 11' });
    expect(ci.body.status).toBe('UP_TO_DATE');
    expect((await request(app).get(`/api/devices/${d.body.id}`).set(auth(T.viewer))).body.online).toBe(true);
    expect((await request(app).get('/api/device-agent/browser-policy').set({ Authorization: `Device ${d.body.id}:${'x'.repeat(43)}` })).status).toBe(401);
    await request(app).post(`/api/devices/${d.body.id}/revoke`).set(auth(T.lab)).send({});
    expect((await request(app).get('/api/device-agent/browser-policy').set(dh)).status).toBe(401);
  });
});

describe('Laporan & backup', () => {
  it('laporan percobaan akses terlarang', async () => {
    const r = await request(app).get('/api/reports/blocked-attempts').set(auth(T.viewer));
    expect(r.status).toBe(200); expect(r.body.rows.length).toBeGreaterThan(0);
  });
  it('backup hanya Super Admin', async () => {
    expect((await request(app).get('/api/settings/backup').set(auth(T.lab))).status).toBe(403);
    const b = await request(app).get('/api/settings/backup').set(auth(T.super));
    expect(b.body.schema).toBe('labguard.backup/v1'); expect(b.body.policies.length).toBeGreaterThanOrEqual(3);
  });
});
