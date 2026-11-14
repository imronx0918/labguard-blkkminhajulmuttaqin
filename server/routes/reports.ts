import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { isGatewayOnline } from '../services/policyEngine.js';
import { jakartaToDate, badRequest } from '../utils.js';
import { withOnline } from './devices.js';
import type { Where } from '../store/types.js';

const r = Router();
const MAX = 5000;
export const REPORT_TYPES = {
  'lab-usage': 'Laporan Penggunaan Laboratorium',
  devices: 'Laporan Perangkat Komputer',
  sessions: 'Laporan Sesi Pembelajaran',
  'internet-activity': 'Laporan Aktivitas Internet',
  'blocked-attempts': 'Laporan Percobaan Akses Situs Terlarang',
  'gateway-status': 'Laporan Status Gateway',
  'policy-deployments': 'Laporan Penerapan Kebijakan',
  'permission-requests': 'Laporan Permintaan Izin Website',
} as const;

const q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  labId: z.string().max(128).optional(), classId: z.string().max(128).optional(), teacherId: z.string().max(128).optional(),
  deviceId: z.string().max(128).optional(), category: z.string().max(80).optional(),
});

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) : '-');

r.get('/:type', requirePermission('reports.view'), ah(async (req, res) => {
  const type = req.params.type as keyof typeof REPORT_TYPES;
  if (!REPORT_TYPES[type]) throw badRequest('Jenis laporan tidak dikenal');
  const f = q.parse(req.query);
  const from = f.from ? jakartaToDate(f.from, '00:00') : new Date(Date.now() - 30 * 86_400_000);
  const to = f.to ? new Date(jakartaToDate(f.to, '00:00').getTime() + 86_400_000) : new Date();
  const labs = new Map((await db().list('laboratories')).items.map((l) => [l.id, l.name]));
  const classes = new Map((await db().list('classes', { limit: 1000 })).items.map((c) => [c.id, c.name]));
  let columns: string[] = [], rows: (string | number)[][] = [], summary: Record<string, string | number> = {};

  if (type === 'sessions' || type === 'lab-usage') {
    const where: Where[] = [['startAt', '>=', from], ['startAt', '<', to]];
    if (f.labId) where.push(['labId', '==', f.labId]);
    if (f.classId) where.push(['classId', '==', f.classId]);
    if (f.teacherId) where.push(['teacherId', '==', f.teacherId]);
    const items = (await db().list('sessions', { where, orderBy: { field: 'startAt', dir: 'asc' }, limit: MAX })).items;
    if (type === 'sessions') {
      columns = ['Tanggal', 'Jam', 'Sesi', 'Mapel', 'Guru', 'Kelas', 'Lab', 'Status', 'Keamanan'];
      rows = items.map((s) => [s.date, `${s.startTime}–${s.endTime}`, s.name, s.subject, s.teacherName, classes.get(s.classId) ?? '-', labs.get(s.labId) ?? '-', s.status, s.securityStatus]);
      summary = { 'Total sesi': items.length, Selesai: items.filter((s) => s.status === 'ENDED').length, Dibatalkan: items.filter((s) => s.status === 'CANCELLED').length, 'Terkonfirmasi aman': items.filter((s) => s.securityStatus === 'SECURED').length };
    } else {
      const agg = new Map<string, { sessions: number; minutes: number; classes: Set<string> }>();
      for (const s of items.filter((x) => x.status !== 'CANCELLED')) {
        const a = agg.get(s.labId) ?? { sessions: 0, minutes: 0, classes: new Set() };
        a.sessions++; a.minutes += (Date.parse(s.endAt) - Date.parse(s.startAt)) / 60000; a.classes.add(s.classId);
        agg.set(s.labId, a);
      }
      columns = ['Laboratorium', 'Jumlah sesi', 'Total jam', 'Jumlah kelas'];
      rows = [...agg.entries()].map(([id, a]) => [labs.get(id) ?? id, a.sessions, +(a.minutes / 60).toFixed(1), a.classes.size]);
      summary = { 'Total sesi': items.length, 'Total jam': +rows.reduce((x, r) => x + Number(r[2]), 0).toFixed(1) };
    }
  } else if (type === 'devices') {
    const where: Where[] = f.labId ? [['labId', '==', f.labId]] : [];
    const items = (await db().list('devices', { where, orderBy: { field: 'name' }, limit: MAX })).items.map(withOnline);
    columns = ['Nama', 'Inventaris', 'IP', 'OS', 'Lab', 'Status', 'Koneksi', 'Kredensial', 'Versi kebijakan', 'Penerapan', 'Terakhir terlihat'];
    rows = items.map((d) => [d.name, d.inventoryNo || '-', d.ip || '-', d.os || '-', labs.get(d.labId) ?? '-', d.status, d.online ? 'ONLINE' : 'OFFLINE', d.credentialStatus, d.appliedPolicyVersion ?? '-', d.policyApplyStatus, fmt(d.lastSeenAt)]);
    summary = { 'Total perangkat': items.length, Online: items.filter((d) => d.online).length, 'Kebijakan terbaru': items.filter((d) => d.policyApplyStatus === 'UP_TO_DATE').length };
  } else if (type === 'internet-activity' || type === 'blocked-attempts') {
    const where: Where[] = [['ts', '>=', from], ['ts', '<', to]];
    if (type === 'blocked-attempts') where.push(['type', 'in', ['BLOCKED', 'BYPASS_ATTEMPT']]);
    if (f.labId) where.push(['labId', '==', f.labId]);
    if (f.deviceId) where.push(['deviceId', '==', f.deviceId]);
    if (f.classId) where.push(['classId', '==', f.classId]);
    if (f.category) where.push(['category', '==', f.category]);
    const items = (await db().list('accessLogs', { where, orderBy: { field: 'ts', dir: 'desc' }, limit: MAX })).items;
    columns = ['Waktu', 'Perangkat', 'Lab', 'Kelas', 'Domain', 'Kategori', 'Status', 'Alasan'];
    rows = items.map((l) => [fmt(l.ts), l.deviceName ?? l.clientIp ?? '-', labs.get(l.labId) ?? '-', classes.get(l.classId) ?? '-', l.domain ?? '-', l.category ?? '-', l.type, l.reason ?? '-']);
    const top = new Map<string, number>();
    items.filter((l) => l.type === 'BLOCKED' && l.domain).forEach((l) => top.set(l.domain, (top.get(l.domain) ?? 0) + 1));
    summary = { 'Total kejadian': items.length, Diblokir: items.filter((l) => l.type === 'BLOCKED').length, Diizinkan: items.filter((l) => l.type === 'ALLOWED').length, 'Indikasi bypass': items.filter((l) => l.type === 'BYPASS_ATTEMPT').length, 'Domain terbanyak diblokir': [...top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-' };
  } else if (type === 'gateway-status') {
    const settings = await getSettings();
    const items = (await db().list('gateways')).items;
    columns = ['Gateway', 'Lokasi', 'IP lokal', 'Status', 'Koneksi', 'Agent', 'DNS', 'Firewall', 'Versi diminta', 'Versi terkonfirmasi', 'Heartbeat terakhir', 'Sinkron terakhir'];
    rows = items.map((g) => { const on = isGatewayOnline(g, settings); return [g.name, g.location || '-', g.localIp || '-', g.status, on ? 'ONLINE' : 'OFFLINE', g.agentVersion || '-', on ? g.dns?.state ?? '-' : 'UNKNOWN', on ? g.firewall?.state ?? '-' : 'UNKNOWN', g.desiredPolicyVersion ?? 0, g.appliedPolicyVersion ?? '-', fmt(g.lastHeartbeatAt), fmt(g.lastSyncAt)]; });
    summary = { 'Total gateway': items.length, Online: items.filter((g) => isGatewayOnline(g, settings)).length };
  } else if (type === 'policy-deployments') {
    const items = (await db().list('policyDeployments', { where: [['createdAt', '>=', from], ['createdAt', '<', to]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: MAX })).items;
    const gws = new Map((await db().list('gateways')).items.map((g) => [g.id, g.name]));
    columns = ['Dibuat', 'Gateway', 'Versi', 'Alasan', 'Mode', 'Status', 'Dikonfirmasi', 'Error'];
    rows = items.map((d) => [fmt(d.createdAt), gws.get(d.gatewayId) ?? '(tanpa gateway)', d.version, d.reason, d.mode, d.status, fmt(d.confirmedAt), d.error ?? '-']);
    summary = { Total: items.length, Terkonfirmasi: items.filter((d) => d.status === 'CONFIRMED').length, Gagal: items.filter((d) => ['FAILED', 'ROLLED_BACK'].includes(d.status)).length };
  } else if (type === 'permission-requests') {
    const items = (await db().list('permissionRequests', { where: [['createdAt', '>=', from], ['createdAt', '<', to]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: MAX })).items
      .filter((p) => (!f.labId || p.labId === f.labId) && (!f.classId || p.classId === f.classId) && (!f.teacherId || p.requestedBy === f.teacherId));
    columns = ['Diajukan', 'Guru', 'Website', 'Domain', 'Mapel', 'Kelas', 'Periode', 'Status', 'Peninjau', 'Catatan'];
    rows = items.map((p) => [fmt(p.createdAt), p.requestedByName, p.siteName, p.domain, p.subject, classes.get(p.classId) ?? '-', `${p.date} ${p.startTime}–${p.endTime}`, p.status, p.reviewedByName ?? '-', p.reviewNote ?? '-']);
    summary = { Total: items.length, Disetujui: items.filter((p) => p.status === 'APPROVED').length, Ditolak: items.filter((p) => p.status === 'REJECTED').length, Menunggu: items.filter((p) => p.status === 'PENDING').length };
  }
  const settings = await getSettings();
  await audit(req, 'REPORT_GENERATE', { details: { type, ...f } });
  res.json({ type, title: REPORT_TYPES[type], institution: settings.institution, mode: settings.mode, period: { from: from.toISOString(), to: to.toISOString() }, generatedAt: new Date().toISOString(), generatedBy: req.user!.name, columns, rows, summary, truncated: rows.length >= MAX });
}));

export default r;
