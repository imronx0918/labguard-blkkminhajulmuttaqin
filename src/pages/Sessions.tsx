import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, List, Pencil, Play, Plus, ShieldAlert, ShieldCheck, Square, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useGet, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, DemoTag, Dot, Empty, ErrorState, Field, Input, KeyVal, Loading, Modal, PageHeader, Select, StatusBadge, Table, Toggle, cx } from '../components/ui';
import { fmtDateTime, timeAgo, todayJakarta } from '../lib/format';

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekStart = (d: string) => { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((dow + 6) % 7)); };

function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, me } = useAuth();
  const q = useGet<any>(`/sessions/${id}`, { refetchInterval: 10_000 });
  const { labName, className, policyName } = useLookups();
  const students = useList<any>(q.data ? `/students?limit=200&classId=${q.data.classId}` : '/students?limit=0', { enabled: !!q.data });
  const [assign, setAssign] = useState<Record<string, string>>({});
  const saveAssign = useAction((a: any) => api(`/sessions/${id}/assign`, { body: { assignments: a } }), { success: 'Pemetaan peserta didik disimpan', invalidate: ['/sessions'] });
  const s = q.data;
  const mine = s && (can('sessions.manageAll') || s.teacherId === me?.uid);
  return (
    <Modal open onClose={onClose} size="xl" title={s?.name ?? 'Detail sesi'}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <div className="space-y-5">
          <div className={cx('flex items-start gap-3 rounded-xl border p-4', s.securityStatus === 'SECURED' ? 'border-emerald-200 bg-emerald-50' : s.securityStatus === 'FAILED' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
            {s.securityStatus === 'SECURED' ? <ShieldCheck className="h-6 w-6 text-emerald-600" /> : <ShieldAlert className="h-6 w-6 text-amber-600" />}
            <div><div className="flex items-center gap-2"><p className="font-bold">Status keamanan sesi</p><StatusBadge status={s.securityStatus} /></div><p className="text-sm text-slate-600">{s.securityDetail ?? (s.status === 'SCHEDULED' ? 'Sesi belum dimulai.' : '')}</p></div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="divide-y divide-slate-100">
              <KeyVal k="Mata pelajaran" v={s.subject} /><KeyVal k="Guru pengampu" v={s.teacherName} /><KeyVal k="Kelas" v={className(s.classId)} /><KeyVal k="Laboratorium" v={labName(s.labId)} />
              <KeyVal k="Jadwal (WIB)" v={`${s.date} · ${s.startTime}–${s.endTime}`} /><KeyVal k="Profil kebijakan" v={policyName(s.policyId)} /><KeyVal k="Status" v={<StatusBadge status={s.status} />} />
              <KeyVal k="Dimulai / diakhiri" v={`${fmtDateTime(s.startedAt)} / ${fmtDateTime(s.endedAt)}`} />
            </div>
            <div>
              <p className="label">Penerapan kebijakan</p>
              {!s.deployments?.length ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Belum ada penerapan.</p> : (
                <ul className="space-y-2">{s.deployments.map((d: any) => <li key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex items-center justify-between"><span className="mono">v{d.version} · {d.reason}</span><StatusBadge status={d.status} /></div>{d.error && <p className="mt-1 text-xs text-red-600">{d.error}</p>}{d.checks?.length > 0 && <p className="mt-1 text-xs text-slate-500">{d.checks.filter((c: any) => c.passed).length}/{d.checks.length} pemeriksaan lolos</p>}</li>)}</ul>
              )}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="label mb-0">Komputer yang terlibat ({s.devices?.length ?? 0})</p>{mine && s.status === 'ACTIVE' && !!s.devices?.length && <Button size="sm" variant="secondary" loading={saveAssign.isPending} onClick={() => saveAssign.mutate(Object.entries(assign).map(([deviceId, studentId]) => ({ deviceId, studentId: studentId || null })))}>Simpan pemetaan peserta didik</Button>}</div>
            {!s.devices?.length ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{s.status === 'SCHEDULED' ? 'Perangkat lab dipetakan saat sesi dimulai.' : 'Tidak ada perangkat terdaftar di laboratorium ini.'}</p> : (
              <Table head={['Komputer', 'Koneksi', 'Kebijakan', 'Peserta didik (opsional)']}>
                {s.devices.map((d: any) => <tr key={d.id}><td className="td font-medium">{d.name}<div className="mono text-slate-400">{d.ip}</div></td><td className="td"><span className="flex items-center gap-2"><Dot on={d.online} />{d.online ? 'Online' : 'Offline'}</span></td><td className="td"><StatusBadge status={d.policyApplyStatus} /></td>
                  <td className="td">{mine && s.status === 'ACTIVE' ? <Select className="w-56" value={assign[d.id] ?? d.studentId ?? ''} onChange={(e) => setAssign({ ...assign, [d.id]: e.target.value })}><option value="">—</option>{students.data?.items.map((st: any) => <option key={st.id} value={st.id}>{st.name}</option>)}</Select> : (students.data?.items.find((st: any) => st.id === d.studentId)?.name ?? '—')}</td></tr>)}
              </Table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Sessions() {
  const { can, me } = useAuth();
  const { labs, classes, policies, labName, className, policyName } = useLookups();
  const teachers = useList<any>('/users/teachers');
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'list' | 'week'>('list');
  const [status, setStatus] = useState('');
  const [labId, setLabId] = useState('');
  const [week, setWeek] = useState(weekStart(todayJakarta()));
  const path = view === 'week' ? `/sessions?limit=200&order=asc&from=${week}&to=${addDays(week, 6)}${labId ? `&labId=${labId}` : ''}` : `/sessions?limit=100${status ? `&status=${status}` : ''}${labId ? `&labId=${labId}` : ''}`;
  const list = useList<any>(path, { refetchInterval: 15_000 });
  const [form, setForm] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'start' | 'stop' | 'cancel'; row: any } | null>(null);
  const detail = sp.get('open');
  const inv = ['/sessions', '/dashboard', '/laboratories', '/deployments'];
  const save = useAction((b: any) => (b.id ? api(`/sessions/${b.id}`, { method: 'PUT', body: b }) : api('/sessions', { body: b })), { success: 'Sesi disimpan', invalidate: inv, onSuccess: () => setForm(null) });
  const run = useAction(({ id, kind }: any) => api(`/sessions/${id}/${kind}`, { body: {} }), {
    success: (r: any) => r.status === 'ACTIVE' ? (r.securityStatus === 'SECURED' ? 'Sesi dimulai & aman' : r.securityStatus === 'SIMULATED_DEMO' ? 'Sesi dimulai (DEMO — tidak ada perubahan jaringan)' : r.securityStatus === 'NO_GATEWAY' ? 'Sesi dimulai, tetapi lab BELUM terhubung gateway — sesi belum diamankan' : 'Sesi dimulai — menunggu konfirmasi gateway') : r.status === 'ENDED' ? 'Sesi diakhiri, lab kembali ke profil default' : 'Sesi dibatalkan',
    invalidate: inv, onSuccess: () => setConfirm(null),
  });
  const items = list.data?.items ?? [];
  const canOwn = (s: any) => can('sessions.manageAll') || s.teacherId === me?.uid;
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const blank = () => ({ name: '', subject: '', teacherId: me?.uid ?? '', classId: '', labId: '', date: todayJakarta(), startTime: '07:00', endTime: '08:30', computerCount: 0, policyId: policies.find((p) => p.type === 'GOOGLE_SEARCH_ONLY')?.id ?? '', autoStart: false });

  const actions = (s: any) => (
    <div className="flex flex-wrap justify-end gap-1">
      {s.status === 'SCHEDULED' && can('sessions.run') && canOwn(s) && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'start', row: s })}>Mulai sesi</Button>}
      {s.status === 'ACTIVE' && can('sessions.run') && canOwn(s) && <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'stop', row: s })}>Akhiri</Button>}
      {s.status === 'SCHEDULED' && can('sessions.create') && canOwn(s) && <><Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setForm({ ...s })}>Edit</Button><Button size="sm" variant="ghost" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'cancel', row: s })}>Batalkan</Button></>}
      <Button size="sm" variant="ghost" onClick={() => setSp({ open: s.id })}>Detail</Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Sesi Pembelajaran" subtitle="Zona waktu Asia/Jakarta (WIB). Sesi dinyatakan aman hanya setelah gateway mengonfirmasi penerapan." icon={<CalendarClock className="h-5 w-5" />}
        actions={can('sessions.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm(blank())}>Buat / jadwalkan sesi</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold', view === 'list' ? 'bg-white shadow-sm' : 'text-slate-500')} onClick={() => setView('list')}><List className="h-3.5 w-3.5" />Daftar & riwayat</button>
            <button className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold', view === 'week' ? 'bg-white shadow-sm' : 'text-slate-500')} onClick={() => setView('week')}><CalendarDays className="h-3.5 w-3.5" />Kalender</button>
          </div>
          <Select className="sm:w-48" value={labId} onChange={(e) => setLabId(e.target.value)}><option value="">Semua lab</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          {view === 'list' ? <Select className="sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua status</option><option value="SCHEDULED">Terjadwal</option><option value="ACTIVE">Berlangsung</option><option value="ENDED">Selesai (riwayat)</option><option value="CANCELLED">Dibatalkan</option></Select> : (
            <div className="flex items-center gap-1"><Button size="sm" variant="outline" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setWeek(addDays(week, -7))} /><span className="px-2 text-sm font-semibold">{week} – {addDays(week, 6)}</span><Button size="sm" variant="outline" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setWeek(addDays(week, 7))} /><Button size="sm" variant="ghost" onClick={() => setWeek(weekStart(todayJakarta()))}>Minggu ini</Button></div>
          )}
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : view === 'week' ? (
          <div className="scroll-thin grid grid-cols-1 gap-px overflow-x-auto bg-slate-100 md:grid-cols-7">
            {days.map((d) => (
              <div key={d} className={cx('min-h-[180px] bg-white p-2', d === todayJakarta() && 'bg-soft-50/60')}>
                <p className={cx('mb-2 text-xs font-bold', d === todayJakarta() ? 'text-navy-700' : 'text-slate-500')}>{new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</p>
                {items.filter((s) => s.date === d).map((s) => (
                  <button key={s.id} onClick={() => setSp({ open: s.id })} className={cx('mb-1.5 w-full rounded-lg border-l-4 p-2 text-left text-xs hover:shadow', s.status === 'ACTIVE' ? 'border-emerald-500 bg-emerald-50' : s.status === 'SCHEDULED' ? 'border-navy-500 bg-soft-50' : 'border-slate-300 bg-slate-50')}>
                    <p className="font-semibold">{s.startTime}–{s.endTime}</p><p className="truncate">{s.name}</p><p className="truncate text-slate-500">{labName(s.labId)}</p>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : !items.length ? <Empty title="Belum ada sesi" message="Buat sesi pembelajaran untuk mengaktifkan profil kebijakan di laboratorium." /> : (
          <Table head={['Sesi', 'Guru / Kelas', 'Lab', 'Jadwal (WIB)', 'Kebijakan', 'Status', 'Keamanan', '']}>
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/60">
                <td className="td"><div className="flex items-center gap-2 font-semibold">{s.name}{s.demo && <DemoTag />}</div><div className="text-xs text-slate-500">{s.subject}{s.autoStart && <Badge className="ml-1" tone="blue">Mulai otomatis</Badge>}</div></td>
                <td className="td">{s.teacherName}<div className="text-xs text-slate-500">{className(s.classId)}</div></td>
                <td className="td">{labName(s.labId)}</td>
                <td className="td whitespace-nowrap">{s.date}<div className="text-xs text-slate-500">{s.startTime}–{s.endTime}</div></td>
                <td className="td text-xs">{policyName(s.policyId)}</td>
                <td className="td"><StatusBadge status={s.status} />{s.status === 'ACTIVE' && <div className="text-[11px] text-slate-400">{timeAgo(s.startedAt)}</div>}</td>
                <td className="td"><StatusBadge status={s.securityStatus} /></td>
                <td className="td">{actions(s)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit sesi' : 'Sesi pembelajaran baru'} size="lg" footer={<><Button variant="outline" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate({ ...form, computerCount: Number(form.computerCount) })}>{form?.id ? 'Simpan' : 'Jadwalkan'}</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama sesi *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Praktikum Jaringan Dasar" /></Field>
          <Field label="Mata pelajaran *"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Guru pengampu *">{can('sessions.manageAll') ? <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>{teachers.data?.items.map((t: any) => <option key={t.id} value={t.id}>{t.displayName}</option>)}</Select> : <Input disabled value={me?.name} />}</Field>
          <Field label="Kelas *"><Select value={form.classId} onChange={(e) => { const c = classes.find((x) => x.id === e.target.value); setForm({ ...form, classId: e.target.value, labId: form.labId || c?.defaultLabId || '' }); }}><option value="">— Pilih —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Laboratorium *"><Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}><option value="">— Pilih —</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Profil kebijakan internet *" hint="Guru hanya memilih profil yang tersedia"><Select value={form.policyId} onChange={(e) => setForm({ ...form, policyId: e.target.value })}><option value="">— Pilih —</option>{policies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Tanggal *"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Jam mulai *"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field><Field label="Jam selesai *"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field></div>
          <Field label="Jumlah komputer" hint="0 = semua perangkat aktif di lab"><Input type="number" min={0} value={form.computerCount} onChange={(e) => setForm({ ...form, computerCount: e.target.value })} /></Field>
          <div className="flex items-end"><Toggle label="Mulai otomatis sesuai jadwal" hint="Penjadwal server memulai sesi pada jam mulai" checked={form.autoStart} onChange={(v) => setForm({ ...form, autoStart: v })} /></div>
          <p className="text-xs text-slate-500 sm:col-span-2">Sesi otomatis diakhiri pada jam selesai; laboratorium kembali ke profil default dan pengecualian sementara dihapus.</p>
        </div>}
      </Modal>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} loading={run.isPending} danger={confirm?.kind !== 'start'}
        title={confirm?.kind === 'start' ? 'MULAI SESI?' : confirm?.kind === 'stop' ? 'Akhiri sesi?' : 'Batalkan sesi?'}
        confirmLabel={confirm?.kind === 'start' ? 'Mulai sesi' : confirm?.kind === 'stop' ? 'Akhiri sesi' : 'Batalkan sesi'}
        message={confirm?.kind === 'start' ? <>Profil <b>{policyName(confirm.row.policyId)}</b> akan diaktifkan di <b>{labName(confirm.row.labId)}</b> dan dikirim ke gateway. Status menjadi <b>Aman</b> hanya setelah gateway mengonfirmasi.</> : confirm?.kind === 'stop' ? <>Laboratorium akan kembali ke profil default dan semua pengecualian sementara sesi ini dihapus.</> : <>Sesi <b>{confirm?.row.name}</b> dibatalkan.</>}
        onConfirm={() => run.mutate({ id: confirm!.row.id, kind: confirm!.kind === 'cancel' ? 'cancel' : confirm!.kind })} />
      {detail && <SessionDetail id={detail} onClose={() => setSp({})} />}
    </>
  );
}
