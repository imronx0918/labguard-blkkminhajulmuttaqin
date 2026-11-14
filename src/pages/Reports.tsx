import { useState } from 'react';
import { FileBarChart, FileSpreadsheet, FileText, Play, Printer } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useList, useLookups } from '../lib/hooks';
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { exportExcel, exportPdf } from '../lib/export';
import { fmtDate, fmtDateTime, todayJakarta } from '../lib/format';

const TYPES: [string, string][] = [
  ['lab-usage', 'Penggunaan laboratorium'], ['devices', 'Perangkat komputer'], ['sessions', 'Sesi pembelajaran'], ['internet-activity', 'Aktivitas internet'],
  ['blocked-attempts', 'Percobaan akses situs terlarang'], ['gateway-status', 'Status gateway'], ['policy-deployments', 'Penerapan kebijakan'], ['permission-requests', 'Permintaan izin website'],
];
const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; };

export default function Reports() {
  const { labs, classes } = useLookups();
  const teachers = useList<any>('/users/teachers');
  const devices = useList<any>('/devices?limit=200');
  const cats = useList<any>('/sites/categories');
  const [type, setType] = useState('internet-activity');
  const [period, setPeriod] = useState<'range' | 'month' | 'year'>('range');
  const t = todayJakarta();
  const [f, setF] = useState({ from: t.slice(0, 8) + '01', to: t, month: t.slice(0, 7), year: t.slice(0, 4), labId: '', classId: '', teacherId: '', deviceId: '', category: '' });
  const gen = useAction((p: string) => api(`/reports/${type}${p}`));
  const range = period === 'month' ? monthRange(f.month) : period === 'year' ? { from: `${f.year}-01-01`, to: `${f.year}-12-31` } : { from: f.from, to: f.to };
  const r = gen.data;
  const run = () => gen.mutate(qs({ ...range, labId: f.labId, classId: f.classId, teacherId: f.teacherId, deviceId: f.deviceId, category: f.category }));
  const subtitle = r ? `Periode ${fmtDate(r.period.from)} – ${fmtDate(r.period.to)} · dibuat ${fmtDateTime(r.generatedAt)} WIB oleh ${r.generatedBy}` : '';

  return (
    <>
      <PageHeader title="Laporan" subtitle="Laporan siap cetak, dapat diekspor ke PDF dan Excel." icon={<FileBarChart className="h-5 w-5" />} />
      <Card className="no-print mb-4">
        <div className="grid gap-4 p-4 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Jenis laporan" className="md:col-span-3 xl:col-span-2"><Select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Periode"><Select value={period} onChange={(e) => setPeriod(e.target.value as any)}><option value="range">Rentang tanggal</option><option value="month">Bulan</option><option value="year">Tahun</option></Select></Field>
          {period === 'range' && <><Field label="Dari"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Sampai"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></>}
          {period === 'month' && <Field label="Bulan"><Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>}
          {period === 'year' && <Field label="Tahun"><Input type="number" min={2020} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>}
          <Field label="Laboratorium"><Select value={f.labId} onChange={(e) => setF({ ...f, labId: e.target.value })}><option value="">Semua</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Kelas"><Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">Semua</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Guru"><Select value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">Semua</option>{teachers.data?.items.map((u: any) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select></Field>
          <Field label="Perangkat"><Select value={f.deviceId} onChange={(e) => setF({ ...f, deviceId: e.target.value })}><option value="">Semua</option>{devices.data?.items.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Kategori situs"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Semua</option>{cats.data?.items.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}</Select></Field>
          <div className="flex items-end"><Button className="w-full" icon={<Play className="h-4 w-4" />} loading={gen.isPending} onClick={run}>Buat laporan</Button></div>
        </div>
      </Card>
      {gen.isPending ? <Loading label="Menyusun laporan…" /> : !r ? <Card><Empty icon={<FileText className="h-6 w-6" />} title="Pilih jenis laporan dan filter" message="Laporan diambil langsung dari database." /></Card> : (
        <Card className="print-area">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div><p className="text-xs font-semibold uppercase tracking-widest text-navy-500">LABGUARD EDU {r.institution?.name ? `· ${r.institution.name}` : ''}</p><h2 className="text-lg font-extrabold text-navy-900">{r.title}</h2><p className="text-xs text-slate-500">{subtitle}</p>{r.mode === 'DEMO' && <Badge tone="violet" className="mt-1">MODE DEMO — dapat berisi data contoh</Badge>}</div>
            <div className="no-print flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Cetak</Button>
              <Button size="sm" variant="outline" icon={<FileText className="h-4 w-4" />} onClick={() => exportPdf({ title: r.title, subtitle, institution: r.institution?.name, columns: r.columns, rows: r.rows, summary: r.summary, filename: `${type}-${range.from}`, demo: r.mode === 'DEMO' })}>PDF</Button>
              <Button size="sm" variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exportExcel(`${type}-${range.from}`, r.title, r.columns, r.rows)}>Excel</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">{Object.entries(r.summary).map(([k, v]) => <div key={k} className="rounded-xl bg-soft-50 px-4 py-2.5"><p className="text-[11px] text-slate-500">{k}</p><p className="text-lg font-extrabold text-navy-900">{String(v)}</p></div>)}</div>
          {!r.rows.length ? <Empty title="Tidak ada data pada periode/filter ini" /> : <Table head={r.columns}>{r.rows.map((row: any[], i: number) => <tr key={i}>{row.map((c, j) => <td key={j} className="td text-xs">{String(c)}</td>)}</tr>)}</Table>}
          {r.truncated && <p className="p-3 text-xs text-amber-600">Dibatasi 5.000 baris — persempit filter.</p>}
        </Card>
      )}
    </>
  );
}
