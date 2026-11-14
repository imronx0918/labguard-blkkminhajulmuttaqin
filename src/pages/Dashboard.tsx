import { Activity, AlertTriangle, Ban, CalendarClock, CheckCircle2, GraduationCap, Monitor, MonitorOff, MonitorPlay, Network, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { useGet } from '../lib/hooks';
import { Badge, Button, Card, DemoTag, Empty, ErrorState, Loading, PageHeader, StatusBadge, cx } from '../components/ui';
import { dayLabel, fmtDateTime, fmtTime, timeAgo } from '../lib/format';
import type { DashboardData } from '../../shared/types';

function Stat({ icon: I, label, value, tone = 'navy', hint }: { icon: any; label: string; value: React.ReactNode; tone?: 'navy' | 'green' | 'red' | 'slate' | 'amber' | 'blue'; hint?: React.ReactNode }) {
  const t = { navy: 'bg-navy-50 text-navy-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', slate: 'bg-slate-100 text-slate-500', amber: 'bg-amber-50 text-amber-600', blue: 'bg-soft-100 text-navy-500' }[tone];
  return (
    <div className="card flex items-start gap-3.5 p-4">
      <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', t)}><I className="h-5 w-5" /></div>
      <div className="min-w-0"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-0.5 text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>{hint && <p className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</p>}</div>
    </div>
  );
}

const STATE_ICON: Record<string, any> = { OK: CheckCircle2, ERROR: AlertTriangle };
function SysRow({ label, s }: { label: string; s: { state: string; detail?: string } }) {
  const I = STATE_ICON[s.state] ?? AlertTriangle;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <I className={cx('mt-0.5 h-4 w-4 shrink-0', s.state === 'OK' ? 'text-emerald-500' : s.state === 'ERROR' ? 'text-red-500' : 'text-amber-500')} />
      <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-700">{label}</p><StatusBadge status={s.state} /></div>{s.detail && <p className="text-xs text-slate-500">{s.detail}</p>}</div>
    </div>
  );
}

export default function Dashboard() {
  const q = useGet<DashboardData>('/dashboard', { refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const gwTone = d.gatewayStatus === 'ONLINE' ? 'green' : d.gatewayStatus === 'NOT_CONFIGURED' ? 'amber' : 'red';
  const pieColors = ['#2f5aa8', '#dc2626', '#0f172a', '#f59e0b'];
  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Ringkasan kondisi laboratorium — diperbarui ${fmtTime(new Date(q.dataUpdatedAt).toISOString())} WIB`} icon={<Activity className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => q.refetch()} loading={q.isFetching}>Muat ulang</Button>} />
      {d.gatewayStatus === 'OFFLINE' || d.gatewayStatus === 'PARTIAL' ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><b>Gateway {d.gatewayStatus === 'OFFLINE' ? 'OFFLINE' : 'sebagian offline'}.</b> Konfigurasi baru belum dapat diterapkan; gateway mempertahankan kebijakan terakhir yang valid. <Link to="/gateways" className="font-semibold underline">Periksa gateway</Link></div></div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Monitor} label="Total komputer laboratorium" value={d.stats.devicesTotal} />
        <Stat icon={Wifi} label="Komputer online" value={d.stats.devicesOnline} tone="green" hint="Agen perangkat check-in ≤ 6 menit" />
        <Stat icon={MonitorOff} label="Komputer offline" value={d.stats.devicesOffline} tone="slate" />
        <Stat icon={MonitorPlay} label="Sedang digunakan (sesi aktif)" value={d.stats.devicesInUse} tone="blue" />
        <Stat icon={GraduationCap} label="Peserta didik aktif" value={d.stats.studentsActive} />
        <Stat icon={CalendarClock} label="Sesi pembelajaran hari ini" value={d.stats.sessionsToday} tone="blue" />
        <Stat icon={Ban} label="Percobaan situs terlarang (hari ini)" value={d.stats.blockedToday} tone="red" hint={d.mode === 'DEMO' ? 'Termasuk data contoh DEMO' : 'Dari log gateway'} />
        <Stat icon={Network} label="Status gateway" value={<span className="text-lg">{d.gatewayStatus === 'NOT_CONFIGURED' ? 'Belum dikonfigurasi' : `${d.stats.gatewaysOnline}/${d.stats.gatewaysTotal} online`}</span>} tone={gwTone as any} hint="Berdasarkan heartbeat valid" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Aktivitas jaringan harian" subtitle="7 hari terakhir — total, diizinkan, diblokir" actions={d.mode === 'DEMO' ? <DemoTag /> : undefined}>
          <div className="h-72 p-4">
            {d.daily.every((x) => !x.total) ? <Empty title="Belum ada aktivitas" message="Data muncul setelah gateway mengirim log DNS. Di MODE DEMO, muat data contoh dari Pengaturan." /> : (
              <ResponsiveContainer>
                <AreaChart data={d.daily.map((x) => ({ ...x, label: dayLabel(x.day) }))} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity={0.3} /><stop offset="1" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="1" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" name="Total permintaan" stroke="#1a376e" strokeWidth={2} fill="none" />
                  <Area type="monotone" dataKey="allowed" name="Diizinkan" stroke="#10b981" strokeWidth={2} fill="url(#gA)" />
                  <Area type="monotone" dataKey="blocked" name="Diblokir" stroke="#ef4444" strokeWidth={2} fill="url(#gB)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card title="Status sistem" subtitle="Hanya dari heartbeat & konfirmasi agent">
          <div className="divide-y divide-slate-100 px-5 py-1">
            <SysRow label="Gateway" s={{ state: d.gatewayStatus === 'ONLINE' ? 'OK' : d.gatewayStatus === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR', detail: d.gatewayStatus === 'NOT_CONFIGURED' ? 'Belum ada gateway terpasang' : `${d.stats.gatewaysOnline} dari ${d.stats.gatewaysTotal} online` }} />
            <SysRow label="DNS filtering" s={d.system.dns} />
            <SysRow label="Firewall" s={d.system.firewall} />
            <SysRow label="Sinkronisasi kebijakan" s={d.system.sync} />
            <div className="flex justify-between py-2.5 text-sm"><span className="text-slate-500">Sinkronisasi terakhir</span><span className="font-medium">{fmtDateTime(d.system.lastSyncAt)}</span></div>
            <div className="flex justify-between py-2.5 text-sm"><span className="text-slate-500">Perangkat belum menerapkan kebijakan terbaru</span><span className={cx('font-bold', d.system.devicesOutdated ? 'text-amber-600' : 'text-emerald-600')}>{d.system.devicesOutdated}</span></div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Aktivitas situs" subtitle="Akumulasi 7 hari" actions={d.mode === 'DEMO' ? <DemoTag /> : undefined}>
          <div className="h-64 p-4">
            {d.sites.every((s) => !s.value) ? <Empty title="Belum ada data" /> : (
              <ResponsiveContainer>
                <BarChart data={d.sites} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="value" name="Jumlah" radius={[0, 6, 6, 0]}>{d.sites.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Aktivitas terkini" actions={<Link to="/activity" className="text-xs font-semibold text-navy-600 hover:underline">Lihat semua</Link>}>
          {!d.recent.length ? <Empty title="Belum ada aktivitas" /> : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="mono w-[70px] shrink-0 text-slate-500">{fmtTime(l.ts)}</span>
                  <span className="w-28 shrink-0 truncate font-medium text-slate-700">{l.deviceName ?? l.clientIp ?? '—'}</span>
                  <span className="mono min-w-0 flex-1 truncate">{l.domain ?? l.reason}</span>
                  {l.demo && <DemoTag />}
                  <StatusBadge status={l.type} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Sesi berlangsung" subtitle="Status keamanan hanya 'Aman' setelah gateway mengonfirmasi">
        {!d.activeSessions.length ? <Empty title="Tidak ada sesi yang berlangsung" action={<Link to="/sessions"><Button size="sm" variant="secondary">Kelola sesi</Button></Link>} /> : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {d.activeSessions.map((s) => (
              <Link key={s.id} to={`/sessions?open=${s.id}`} className="rounded-xl border border-slate-200 p-4 hover:border-navy-300">
                <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{s.name}</p><ShieldCheck className={cx('h-4 w-4', s.securityStatus === 'SECURED' ? 'text-emerald-500' : 'text-amber-500')} /></div>
                <p className="text-xs text-slate-500">{s.subject} · {s.teacherName} · {s.startTime}–{s.endTime}</p>
                <div className="mt-2"><StatusBadge status={s.securityStatus} /></div>
                <p className="mt-1 text-[11px] text-slate-400">Dimulai {timeAgo(s.startedAt)}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>
      {d.mode === 'DEMO' && <p className="mt-4 text-center text-xs text-slate-400"><Badge tone="violet">DEMO</Badge> Angka bertanda DEMO berasal dari data contoh dan bukan aktivitas jaringan nyata.</p>}
    </>
  );
}
