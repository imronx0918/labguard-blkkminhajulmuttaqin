const TZ = 'Asia/Jakarta';
export const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const todayJakarta = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export function timeAgo(iso?: string | null) {
  if (!iso) return 'tidak pernah';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}
export const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', timeZone: 'UTC' });
