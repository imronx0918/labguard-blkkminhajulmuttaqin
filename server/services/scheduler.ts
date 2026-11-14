import { db } from '../store/index.js';
import { getSettings } from './settings.js';
import { notify } from './notifications.js';
import { isGatewayOnline, requestDeployment } from './policyEngine.js';
import { startSession, stopSession } from './sessions.js';
import { audit } from './audit.js';
import { jakartaDayKey } from '../utils.js';

const offlineState = new Map<string, boolean>();
let running = false;

/** Penjadwal (tiap 60 detik). Di Cloud Run aktifkan min-instances=1 atau panggil POST /api/internal/tick dari Cloud Scheduler. */
export async function tick() {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings(true);
    const now = new Date();

    // 1) Izin sementara: aktif saat periode mulai, kedaluwarsa otomatis
    const temps = (await db().list('allowedDomains', { where: [['temporary', '==', true]], limit: 1000 })).items;
    const labsToRedeploy = new Set<string>();
    for (const t of temps) {
      if (t.expiresAt && Date.parse(t.expiresAt) <= now.getTime()) {
        await db().delete('allowedDomains', t.id);
        if (t.permissionRequestId) await db().update('permissionRequests', t.permissionRequestId, { status: 'EXPIRED' });
        (t.labIds ?? []).forEach((l: string) => labsToRedeploy.add(l));
        await audit(null, 'TEMP_EXCEPTION_EXPIRED', { targetId: t.id, details: { domain: t.domain } });
      } else if (t.validFrom && !t.activatedAt && Date.parse(t.validFrom) <= now.getTime()) {
        await db().update('allowedDomains', t.id, { activatedAt: now });
        (t.labIds ?? []).forEach((l: string) => labsToRedeploy.add(l));
      }
    }
    if (labsToRedeploy.size) await requestDeployment({ labIds: [...labsToRedeploy], reason: 'TEMP_EXCEPTION_SCHEDULE', actor: 'system' });

    // 2) Sesi: mulai otomatis (autoStart) & akhiri otomatis saat jam selesai
    const today = jakartaDayKey(now);
    const sess = (await db().list('sessions', { where: [['date', '<=', today], ['status', 'in', ['SCHEDULED', 'ACTIVE']]], limit: 500 })).items;
    for (const s of sess) {
      try {
        if (s.status === 'ACTIVE' && Date.parse(s.endAt) <= now.getTime()) await stopSession(null, s.id, 'system', 'auto-end');
        else if (s.status === 'SCHEDULED' && s.autoStart && Date.parse(s.startAt) <= now.getTime() && Date.parse(s.endAt) > now.getTime()) await startSession(null, s.id, 'system');
        else if (s.status === 'SCHEDULED' && Date.parse(s.endAt) <= now.getTime() - 3600_000) await db().update('sessions', s.id, { status: 'CANCELLED', securityDetail: 'Tidak dimulai hingga jadwal berakhir' });
      } catch (e) { console.warn('[scheduler] sesi', s.id, (e as Error).message); }
    }

    // 3) Gateway offline detection (berdasarkan heartbeat valid saja)
    const gws = (await db().list('gateways', { where: [['status', '==', 'PAIRED']], limit: 200 })).items;
    for (const g of gws) {
      const online = isGatewayOnline(g, settings);
      const prev = offlineState.get(g.id);
      if (prev !== undefined && prev && !online) {
        await db().create('accessLogs', { ts: now, type: 'GATEWAY_ERROR', gatewayId: g.id, deviceName: `Gateway ${g.name}`, reason: 'Heartbeat hilang — gateway OFFLINE. Kebijakan terakhir yang valid tetap dipertahankan di gateway.', dayKey: today });
        await notify({ kind: 'GATEWAY_OFFLINE', severity: 'error', title: 'Gateway offline', message: `${g.name} tidak mengirim heartbeat lebih dari ${settings.gateway.offlineAfterSec} detik.`, link: '/gateways', dedupeKey: `offline-${g.id}`, dedupeMinutes: 60 });
      }
      offlineState.set(g.id, online);
      // deployment menunggu terlalu lama
      if (settings.mode === 'LIVE') {
        const pend = (await db().list('policyDeployments', { where: [['gatewayId', '==', g.id], ['status', '==', 'PENDING']], limit: 5 })).items;
        for (const p of pend) if (Date.now() - Date.parse(p.createdAt) > 10 * 60_000) await notify({ kind: 'SYNC_FAILED', severity: 'warning', title: 'Sinkronisasi kebijakan tertunda', message: `${g.name} belum mengonfirmasi kebijakan v${p.version} lebih dari 10 menit.`, link: '/gateways', dedupeKey: `pending-${p.id}`, dedupeMinutes: 120 });
      }
    }

    // 4) Perangkat dengan kebijakan usang
    const outdated = await db().count('devices', [['policyApplyStatus', 'in', ['OUTDATED', 'FAILED']], ['credentialStatus', '==', 'issued']]);
    if (outdated) await notify({ kind: 'DEVICE_POLICY_OUTDATED', severity: 'warning', title: 'Perangkat belum menerapkan kebijakan terbaru', message: `${outdated} perangkat belum melaporkan versi kebijakan browser terbaru.`, link: '/devices', dedupeKey: 'devices-outdated', dedupeMinutes: 120 });

    // 5) Retensi log & pembersihan nonce/heartbeat
    const cutoff = new Date(now.getTime() - settings.logs.retentionDays * 86_400_000);
    await db().deleteWhere('accessLogs', [['ts', '<', cutoff]], 400);
    await db().deleteWhere('gatewayHeartbeats', [['ts', '<', new Date(now.getTime() - 7 * 86_400_000)]], 400);
    await db().deleteWhere('agentNonces', [['expiresAt', '<', now]], 400);
    await db().deleteWhere('notifications', [['createdAt', '<', new Date(now.getTime() - 30 * 86_400_000)]], 200);
  } catch (e) {
    console.error('[scheduler]', e);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const t = setInterval(() => void tick(), 60_000);
  t.unref();
  setTimeout(() => void tick(), 5_000).unref();
}
