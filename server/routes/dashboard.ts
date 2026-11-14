import { Router } from 'express';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { getSettings } from '../services/settings.js';
import { isGatewayOnline } from '../services/policyEngine.js';
import { jakartaDayKey, jakartaDayRange } from '../utils.js';
import { DEVICE_ONLINE_MS } from './devices.js';
import type { ComponentStatus, DashboardData } from '../../shared/types.js';

const r = Router();

// Dashboard memakai agregasi COUNT + dokumen dailyStats (penghitung harian) agar tidak membaca seluruh koleksi log.
r.get('/', requirePermission('dashboard.view'), ah(async (_req, res) => {
  const settings = await getSettings();
  const today = jakartaDayKey();
  const { start, end } = jakartaDayRange(today);
  const onlineSince = new Date(Date.now() - DEVICE_ONLINE_MS);
  const [devicesTotal, devicesOnline, studentsActive, sessionsToday, activeSess, gateways, recent, outdated] = await Promise.all([
    db().count('devices', [['status', '==', 'active']]),
    db().count('devices', [['status', '==', 'active'], ['lastSeenAt', '>=', onlineSince]]),
    db().count('students', [['active', '==', true]]),
    db().count('sessions', [['date', '==', today]]),
    db().list('sessions', { where: [['status', '==', 'ACTIVE']], limit: 50 }),
    db().list('gateways', { limit: 100 }),
    db().list('accessLogs', { orderBy: { field: 'ts', dir: 'desc' }, limit: 12 }),
    db().count('devices', [['policyApplyStatus', 'in', ['OUTDATED', 'FAILED']]]),
  ]);
  const activeLabIds = activeSess.items.map((s) => s.labId);
  const inUse = activeLabIds.length ? await db().count('devices', [['labId', 'in', activeLabIds.slice(0, 30)], ['lastSeenAt', '>=', onlineSince]]) : 0;

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(jakartaDayKey(new Date(start.getTime() - i * 86_400_000 + 3_600_000)));
  const realStats = await db().getMany('dailyStats', days);
  // MODE DEMO: tambahkan penghitung contoh (berlabel demo) — tidak pernah dipakai pada LIVE
  const demoStats = settings.mode === 'DEMO' ? await db().getMany('dailyStats', days.map((d) => `demo-${d}`)) : [];
  const merge = (a: any, b: any): any => { if (!a) return b; if (!b) return a; const o: any = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = typeof v === 'number' ? (o[k] ?? 0) + v : v && typeof v === 'object' ? merge(o[k], v) : o[k] ?? v; return o; };
  const stats = days.map((d) => merge(realStats.find((s) => s.id === d), demoStats.find((s) => s.id === `demo-${d}`))).filter(Boolean).map((s, i) => ({ ...s, id: s.dayKey ?? days[i] }));
  const byDay = new Map(stats.map((s) => [s.dayKey ?? s.id, s]));
  const todayStats = byDay.get(today);

  const paired = gateways.items.filter((g) => g.status === 'PAIRED');
  const online = paired.filter((g) => isGatewayOnline(g, settings));
  const gatewayStatus: DashboardData['gatewayStatus'] = !paired.length ? 'NOT_CONFIGURED' : online.length === paired.length ? 'ONLINE' : online.length ? 'PARTIAL' : 'OFFLINE';
  const agg = (key: 'dns' | 'firewall'): ComponentStatus => {
    if (!paired.length) return { state: 'NOT_CONFIGURED', detail: 'Belum ada gateway terpasang' };
    if (!online.length) return { state: 'UNKNOWN', detail: 'Gateway offline — status tidak dapat dipastikan' };
    const err = online.find((g) => g[key]?.state === 'ERROR');
    if (err) return { state: 'ERROR', detail: `${err.name}: ${err[key]?.detail ?? ''}` };
    if (online.every((g) => g[key]?.state === 'OK')) return { state: 'OK', detail: `${online.length} gateway melaporkan aktif` };
    return { state: online[0][key]?.state ?? 'UNKNOWN', detail: online[0][key]?.detail };
  };
  const synced = paired.filter((g) => g.appliedPolicyVersion != null && g.appliedPolicyVersion === g.desiredPolicyVersion);
  const sync: ComponentStatus = !paired.length ? { state: 'NOT_CONFIGURED', detail: 'Belum ada gateway' }
    : settings.mode !== 'LIVE' ? { state: 'DISABLED', detail: 'MODE DEMO — kebijakan tidak diterapkan ke jaringan' }
    : synced.length === paired.length ? { state: 'OK', detail: 'Semua gateway pada versi terbaru (terkonfirmasi)' }
    : { state: 'ERROR', detail: `${paired.length - synced.length} gateway belum mengonfirmasi versi terbaru` };
  const lastSyncAt = paired.map((g) => g.lastSyncAt).filter(Boolean).sort().pop() ?? null;

  const sumSites = (k: string, f: 'allowed' | 'blocked') => stats.reduce((a, s) => a + (s.sites?.[k]?.[f] ?? 0), 0);
  const data: DashboardData = {
    mode: settings.mode,
    stats: { devicesTotal, devicesOnline, devicesOffline: devicesTotal - devicesOnline, devicesInUse: inUse, studentsActive, sessionsToday, blockedToday: todayStats?.blocked ?? 0, gatewaysTotal: paired.length, gatewaysOnline: online.length },
    gatewayStatus,
    system: { dns: agg('dns'), firewall: agg('firewall'), sync, lastSyncAt, devicesOutdated: outdated },
    daily: days.map((d) => ({ day: d, total: byDay.get(d)?.total ?? 0, allowed: byDay.get(d)?.allowed ?? 0, blocked: byDay.get(d)?.blocked ?? 0 })),
    sites: [
      { name: 'Google Search (diizinkan)', value: sumSites('google', 'allowed') },
      { name: 'YouTube (diblokir)', value: sumSites('youtube', 'blocked') },
      { name: 'TikTok (diblokir)', value: sumSites('tiktok', 'blocked') },
      { name: 'Situs lain (diblokir)', value: sumSites('other', 'blocked') },
    ],
    recent: recent.items as any,
    activeSessions: activeSess.items as any,
  };
  void end;
  res.json(data);
}));

export default r;
