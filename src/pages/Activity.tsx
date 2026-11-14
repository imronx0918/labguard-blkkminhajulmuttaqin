import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Download, RefreshCw } from 'lucide-react';
import { usePaged, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { qs } from '../lib/api';
import { Button, Card, DemoTag, Empty, ErrorState, Input, Loading, PageHeader, Select, StatusBadge, Table, Tabs } from '../components/ui';
import { fmtDateTime, fmtTime } from '../lib/format';
import { exportExcel } from '../lib/export';
import { LOG_TYPES } from '../../shared/types';

function AccessLogs() {
  const [sp] = useSearchParams();
  const { labs, labName, className } = useLookups();
  const [f, setF] = useState({ type: sp.get('type') ?? '', labId: '', domain: '', from: '', to: '' });
  const q = usePaged<any>('/access-logs', qs(f), { refetchInterval: 20_000 });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <Select className="sm:w-44" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Semua kategori log</option>{LOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        <Select className="sm:w-44" value={f.labId} onChange={(e) => setF({ ...f, labId: e.target.value })}><option value="">Semua lab</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        <Input className="sm:w-48" placeholder="Domain persis (youtube.com)" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value.trim() })} />
        <Input type="date" className="sm:w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Dari tanggal" />
        <Input type="date" className="sm:w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Sampai tanggal" />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={q.isFetching} onClick={() => q.refetch()}>Refresh</Button>
          <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} disabled={!rows.length} onClick={() => exportExcel('log-aktivitas', 'Log', ['Waktu', 'Perangkat', 'IP', 'Lab', 'Kelas', 'Domain', 'Kategori', 'Status', 'Alasan', 'Kebijakan'], rows.map((l) => [fmtDateTime(l.ts), l.deviceName, l.clientIp, labName(l.labId), className(l.classId), l.domain, l.category, l.type, l.reason, l.policyName ?? (l.policyVersion ? `v${l.policyVersion}` : '')]))}>Export</Button>
        </div>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? <Empty title="Belum ada log" message="Log berasal dari gateway agent (query DNS & deteksi bypass). Hanya domain, waktu, perangkat, dan hasil kebijakan yang disimpan." /> : (
        <>
          <Table head={['Waktu (WIB)', 'Komputer', 'Kelas', 'Domain diminta', 'Kategori', 'Status', 'Alasan', 'Kebijakan']}>
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <td className="td whitespace-nowrap"><span className="mono">{fmtTime(l.ts)}</span><div className="text-[11px] text-slate-400">{fmtDateTime(l.ts).split(',')[0]}</div></td>
                <td className="td"><div className="flex items-center gap-1.5 font-medium">{l.deviceName ?? '—'}{l.demo && <DemoTag />}</div><div className="mono text-slate-400">{l.clientIp ?? ''}</div></td>
                <td className="td text-xs">{className(l.classId)}<div className="text-slate-400">{labName(l.labId)}</div></td>
                <td className="td mono">{l.domain ?? '—'}</td>
                <td className="td text-xs">{l.category ?? '—'}</td>
                <td className="td"><StatusBadge status={l.type} /></td>
                <td className="td max-w-xs text-xs text-slate-600">{l.reason ?? '—'}</td>
                <td className="td text-xs">{l.policyName ?? (l.policyVersion ? `v${l.policyVersion}` : '—')}</td>
              </tr>
            ))}
          </Table>
          {q.hasNextPage && <div className="border-t border-slate-100 p-3 text-center"><Button variant="outline" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Muat lebih banyak</Button></div>}
        </>
      )}
    </Card>
  );
}

function AuditLogs() {
  const [f, setF] = useState({ action: '', from: '', to: '' });
  const q = usePaged<any>('/audit-logs', qs(f));
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card subtitle="Audit log hanya dapat ditulis oleh server dan tidak dapat diubah pengguna.">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <Input className="sm:w-60" placeholder="Tindakan (mis. SESSION_START)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value.trim().toUpperCase() })} />
        <Input type="date" className="sm:w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" className="sm:w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button className="ml-auto" size="sm" variant="outline" icon={<Download className="h-4 w-4" />} disabled={!rows.length} onClick={() => exportExcel('audit-log', 'Audit', ['Waktu', 'Pengguna', 'Peran', 'Tindakan', 'Data terkait', 'IP', 'Hasil'], rows.map((a) => [fmtDateTime(a.ts), a.userName, a.role, a.action, `${a.target ?? a.targetId ?? ''} ${JSON.stringify(a.details ?? {})}`, a.ip, a.result]))}>Export</Button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !rows.length ? <Empty title="Belum ada catatan audit" /> : (
        <>
          <Table head={['Waktu (WIB)', 'Pengguna', 'Tindakan', 'Data terkait', 'IP', 'Hasil']}>
            {rows.map((a) => (
              <tr key={a.id}><td className="td whitespace-nowrap text-xs">{fmtDateTime(a.ts)}</td><td className="td">{a.userName}<div className="text-[11px] text-slate-400">{a.role}</div></td><td className="td mono font-semibold">{a.action}</td>
                <td className="td max-w-md"><div className="mono truncate text-[11px] text-slate-500" title={JSON.stringify(a.details)}>{a.target ?? a.targetId ?? ''} {Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ''}</div></td>
                <td className="td mono text-xs">{a.ip ?? '—'}</td><td className="td"><StatusBadge status={a.result} /></td></tr>
            ))}
          </Table>
          {q.hasNextPage && <div className="border-t border-slate-100 p-3 text-center"><Button variant="outline" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Muat lebih banyak</Button></div>}
        </>
      )}
    </Card>
  );
}

export default function Activity() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'access' | 'audit'>('access');
  return (
    <>
      <PageHeader title="Aktivitas dan Log" subtitle="Tanpa dekripsi HTTPS. URL lengkap & parameter pencarian tidak disimpan — hanya domain, kategori, waktu, perangkat, dan hasil kebijakan." icon={<ClipboardList className="h-5 w-5" />} />
      {can('audit.view') && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'access', label: 'Monitoring aktivitas' }, { key: 'audit', label: 'Audit log administrator' }]} />}
      {tab === 'access' ? <AccessLogs /> : <AuditLogs />}
    </>
  );
}
