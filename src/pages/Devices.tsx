import { useState } from 'react';
import { Ban, Download, Eye, KeyRound, LayoutGrid, List, Monitor, Network, Pencil, Plus, Power, RefreshCw, Tags, Trash2 } from 'lucide-react';
import { api, saveBlob } from '../lib/api';
import { useAction, useGet, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, DemoTag, Dot, Empty, ErrorState, Field, Input, KeyVal, Loading, Modal, PageHeader, SearchInput, Select, StatusBadge, Table, cx } from '../components/ui';
import { fmtDateTime, fmtTime, timeAgo } from '../lib/format';
import { exportExcel } from '../lib/export';

const EMPTY = { name: '', inventoryNo: '', mac: '', ip: '', os: '', browser: 'Google Chrome', labId: '', classId: '', group: '', gatewayId: '' };

function DeviceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useGet<any>(`/devices/${id}`);
  const logs = useGet<any>(`/devices/${id}/logs?limit=20`);
  const { labName, className } = useLookups();
  return (
    <Modal open onClose={onClose} title="Detail perangkat" size="lg">
      {d.isLoading ? <Loading /> : d.error ? <ErrorState error={d.error} /> : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="divide-y divide-slate-100">
            <KeyVal k="ID perangkat (UUID)" v={<span className="mono break-all">{d.data.id}</span>} />
            <KeyVal k="Nama komputer" v={d.data.name} />
            <KeyVal k="No. inventaris" v={d.data.inventoryNo || '—'} />
            <KeyVal k="MAC address" v={<span className="mono">{d.data.mac || '—'}</span>} />
            <KeyVal k="IP address" v={<span className="mono">{d.data.ip || '—'}</span>} />
            <KeyVal k="Sistem operasi" v={d.data.os || '—'} />
            <KeyVal k="Browser" v={d.data.browser || '—'} />
            <KeyVal k="Laboratorium" v={labName(d.data.labId)} />
            <KeyVal k="Kelas" v={className(d.data.classId)} />
          </div>
          <div className="divide-y divide-slate-100">
            <KeyVal k="Koneksi" v={<span className="flex items-center gap-2"><Dot on={d.data.online} />{d.data.online ? 'Online' : 'Offline'}</span>} />
            <KeyVal k="Status perangkat" v={<StatusBadge status={d.data.status} />} />
            <KeyVal k="Kredensial agen" v={<StatusBadge status={d.data.credentialStatus} />} />
            <KeyVal k="Versi agen" v={d.data.agentVersion || '—'} />
            <KeyVal k="Versi kebijakan terpasang" v={<span className="mono">{d.data.appliedPolicyVersion || '—'}</span>} />
            <KeyVal k="Versi kebijakan seharusnya" v={<span className="mono">{d.data.expectedPolicyVersion || '—'}</span>} />
            <KeyVal k="Penerapan aturan internet" v={<StatusBadge status={d.data.policyApplyStatus} />} />
            <KeyVal k="Komunikasi terakhir" v={`${fmtDateTime(d.data.lastSeenAt)} (${timeAgo(d.data.lastSeenAt)})`} />
          </div>
          <div className="md:col-span-2">
            <p className="label">Log perangkat</p>
            {logs.isLoading ? <Loading /> : !logs.data?.items.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Belum ada log untuk perangkat ini. Log dipetakan dari IP perangkat oleh gateway.</p> : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{logs.data.items.map((l: any) => <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="mono text-slate-500">{fmtTime(l.ts)}</span><span className="mono flex-1 truncate">{l.domain ?? l.reason}</span><StatusBadge status={l.type} /></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Devices() {
  const { can } = useAuth();
  const { labs, classes, labName } = useLookups();
  const gws = useList<any>('/gateways');
  const [q, setQ] = useState('');
  const [labId, setLabId] = useState('');
  const [conn, setConn] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'revoke' | 'disable'; row: any } | null>(null);
  const [reg, setReg] = useState<any | null>(null);
  const [regResult, setRegResult] = useState<any | null>(null);
  const [pair, setPair] = useState<any | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const canManage = can('devices.manage');
  const path = `/devices?limit=200${labId ? `&labId=${labId}` : ''}${conn ? `&connection=${conn}` : ''}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const list = useList<any>(path, { refetchInterval: 30_000 });
  const inv = ['/devices', '/dashboard'];

  const save = useAction((f: any) => (edit?.id ? api(`/devices/${edit.id}`, { method: 'PUT', body: f }) : api('/devices', { body: f })), { success: 'Perangkat disimpan', invalidate: inv, onSuccess: () => setEdit(null) });
  const act = useAction(({ url, body, method }: { url: string; body?: any; method?: string }) => api(url, { method: method ?? 'POST', body: body ?? {} }), { success: 'Berhasil', invalidate: inv, onSuccess: () => { setConfirm(null); setPair(null); setGroupOpen(false); setSel([]); } });
  const register = useAction((v: { id: string; platform: string }) => api(`/devices/${v.id}/register`, { body: { platform: v.platform } }), { invalidate: inv, onSuccess: (r) => { setRegResult(r); setReg(null); } });

  const open = (row?: any) => { setForm(row ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k] ?? ''])) } : EMPTY); setEdit(row ?? {}); };
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader title="Perangkat Komputer" subtitle="Identitas perangkat = UUID + token khusus per perangkat (MAC address bukan dasar autentikasi)." icon={<Monitor className="h-5 w-5" />}
        actions={<>
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => exportExcel('perangkat', 'Perangkat', ['ID', 'Nama', 'Inventaris', 'MAC', 'IP', 'OS', 'Browser', 'Lab', 'Grup', 'Koneksi', 'Kredensial', 'Versi kebijakan', 'Penerapan', 'Terakhir terlihat'], items.map((d) => [d.id, d.name, d.inventoryNo, d.mac, d.ip, d.os, d.browser, labName(d.labId), d.group, d.online ? 'Online' : 'Offline', d.credentialStatus, d.appliedPolicyVersion, d.policyApplyStatus, fmtDateTime(d.lastSeenAt)]))}>Export</Button>
          {canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Tambah perangkat</Button>}
        </>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Cari nama, IP, MAC, inventaris…" />
          <Select value={labId} onChange={(e) => setLabId(e.target.value)} className="sm:w-48"><option value="">Semua lab</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select value={conn} onChange={(e) => setConn(e.target.value)} className="sm:w-40"><option value="">Online & offline</option><option value="online">Online</option><option value="offline">Offline</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40"><option value="">Semua status</option><option value="active">Aktif</option><option value="disabled">Nonaktif</option></Select>
          <div className="ml-auto flex items-center gap-1">
            {canManage && sel.length > 0 && <Button size="sm" variant="secondary" icon={<Tags className="h-4 w-4" />} onClick={() => setGroupOpen(true)}>Kelompokkan ({sel.length})</Button>}
            <button className={cx('rounded-lg p-2', view === 'table' ? 'bg-navy-50 text-navy-700' : 'text-slate-400 hover:bg-slate-100')} onClick={() => setView('table')} aria-label="Tampilan tabel"><List className="h-4 w-4" /></button>
            <button className={cx('rounded-lg p-2', view === 'cards' ? 'bg-navy-50 text-navy-700' : 'text-slate-400 hover:bg-slate-100')} onClick={() => setView('cards')} aria-label="Tampilan kartu"><LayoutGrid className="h-4 w-4" /></button>
          </div>
        </div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !items.length ? (
          <Empty title="Belum ada perangkat" message="Tambahkan komputer laboratorium, lalu lakukan registrasi untuk menerbitkan token dan installer kebijakan." action={canManage && <Button size="sm" onClick={() => open()}>Tambah perangkat</Button>} />
        ) : view === 'table' ? (
          <Table head={[canManage ? <input type="checkbox" aria-label="Pilih semua" checked={sel.length === items.length} onChange={(e) => setSel(e.target.checked ? items.map((i) => i.id) : [])} /> : '', 'Perangkat', 'IP / MAC', 'Lab / Grup', 'Koneksi', 'Agen', 'Kebijakan', 'Terakhir', '']}>
            {items.map((d) => (
              <tr key={d.id} className={cx('hover:bg-slate-50/60', d.status === 'disabled' && 'opacity-60')}>
                <td className="td w-8">{canManage && <input type="checkbox" checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />}</td>
                <td className="td"><div className="flex items-center gap-2 whitespace-nowrap"><span className="font-semibold">{d.name}</span>{d.demo && <DemoTag />}</div><div className="mono whitespace-nowrap text-slate-400" title={d.id}>{d.id.slice(0, 8)} · {d.inventoryNo || '—'}</div></td>
                <td className="td"><div className="mono">{d.ip || '—'}</div><div className="mono text-slate-400">{d.mac || '—'}</div></td>
                <td className="td"><div>{labName(d.labId)}</div><div className="text-xs text-slate-400">{d.group || '—'}</div></td>
                <td className="td"><span className="flex items-center gap-2"><Dot on={d.online} />{d.online ? 'Online' : 'Offline'}</span></td>
                <td className="td"><StatusBadge status={d.credentialStatus} /></td>
                <td className="td"><StatusBadge status={d.policyApplyStatus} /><div className="mono mt-0.5 text-slate-400">{d.appliedPolicyVersion || ''}</div></td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{timeAgo(d.lastSeenAt)}</td>
                <td className="td"><RowActions d={d} /></td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((d) => (
              <div key={d.id} className={cx('rounded-xl border p-4', d.online ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200', d.status === 'disabled' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5"><div className={cx('flex h-10 w-10 items-center justify-center rounded-lg', d.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}><Monitor className="h-5 w-5" /></div>
                    <div><p className="font-semibold">{d.name}</p><p className="mono text-slate-500">{d.ip || 'IP belum diketahui'}</p></div></div>
                  <Dot on={d.online} pulse />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5"><StatusBadge status={d.policyApplyStatus} /><StatusBadge status={d.credentialStatus} />{d.demo && <DemoTag />}</div>
                <p className="mt-2 text-xs text-slate-500">{labName(d.labId)} · {timeAgo(d.lastSeenAt)}</p>
                <div className="mt-3 border-t border-slate-100 pt-2"><RowActions d={d} /></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Tambah / edit */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit perangkat' : 'Tambah perangkat'} size="lg" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(form)}>Simpan</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama komputer *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="PC-LAB1-01" /></Field>
          <Field label="Nomor inventaris"><Input value={form.inventoryNo} onChange={(e) => setForm({ ...form, inventoryNo: e.target.value })} /></Field>
          <Field label="MAC address" hint="Opsional — informasi saja"><Input value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" /></Field>
          <Field label="IP address" hint="Untuk memetakan log gateway ke perangkat (gunakan DHCP reservation)"><Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.10.101" /></Field>
          <Field label="Sistem operasi"><Input value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} placeholder="Windows 11 Pro" /></Field>
          <Field label="Browser"><Input value={form.browser} onChange={(e) => setForm({ ...form, browser: e.target.value })} /></Field>
          <Field label="Laboratorium"><Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}><option value="">— Pilih —</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Kelas pengguna"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">— Tidak tetap —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Grup"><Input value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} placeholder="Baris 1" /></Field>
        </div>
      </Modal>

      {/* Registrasi */}
      <Modal open={!!reg} onClose={() => setReg(null)} title={`Registrasi ${reg?.name ?? ''}`} footer={<Button variant="outline" onClick={() => setReg(null)}>Batal</Button>}>
        <p className="mb-4 text-sm text-slate-600">Registrasi menerbitkan <b>token unik perangkat</b> (token lama otomatis tidak berlaku) dan installer yang memasang kebijakan Chrome/Edge serta agen sinkronisasi (tarik kebijakan tiap 5 menit).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" loading={register.isPending} onClick={() => register.mutate({ id: reg.id, platform: 'windows' })}>Windows (PowerShell)</Button>
          <Button variant="secondary" loading={register.isPending} onClick={() => register.mutate({ id: reg.id, platform: 'linux' })}>Linux (bash)</Button>
        </div>
      </Modal>
      <Modal open={!!regResult} onClose={() => setRegResult(null)} title="Installer perangkat siap" footer={<><Button variant="outline" onClick={() => setRegResult(null)}>Tutup</Button><Button icon={<Download className="h-4 w-4" />} onClick={() => saveBlob(new Blob([regResult.script], { type: 'text/plain' }), regResult.filename)}>Unduh installer</Button></>}>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800"><b>Token hanya ditampilkan sekali.</b> Unduh installer sekarang dan jalankan sebagai Administrator/root di perangkat. Simpan file secara aman lalu hapus setelah dipasang.</div>
          <KeyVal k="ID perangkat" v={<span className="mono">{regResult?.deviceId}</span>} />
          <KeyVal k="Berkas" v={<span className="mono">{regResult?.filename}</span>} />
          <p className="text-xs text-slate-500">Setelah dijalankan, perangkat akan check-in dan status penerapan berubah menjadi <b>Terbaru</b>. Verifikasi di <span className="mono">chrome://policy</span>.</p>
        </div>
      </Modal>

      {/* Pasangkan gateway */}
      <Modal open={!!pair} onClose={() => setPair(null)} title={`Pasangkan ${pair?.name ?? ''} dengan gateway`} footer={<Button variant="outline" onClick={() => setPair(null)}>Batal</Button>}>
        {!gws.data?.items.length ? <Empty title="Belum ada gateway" message="Daftarkan gateway di menu Gateway dan Jaringan." /> : (
          <div className="space-y-2">{gws.data.items.map((g: any) => (
            <button key={g.id} onClick={() => act.mutate({ url: `/devices/${pair.id}/pair-gateway`, body: { gatewayId: g.id } })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:border-navy-400">
              <span><span className="font-semibold">{g.name}</span><span className="block text-xs text-slate-500">{g.location}</span></span><StatusBadge status={g.online ? 'ONLINE' : 'OFFLINE'} />
            </button>))}</div>
        )}
      </Modal>
      <Modal open={groupOpen} onClose={() => setGroupOpen(false)} title={`Kelompokkan ${sel.length} perangkat`} size="sm" footer={<><Button variant="outline" onClick={() => setGroupOpen(false)}>Batal</Button><Button loading={act.isPending} onClick={() => act.mutate({ url: '/devices/bulk-group', body: { ids: sel, group: groupName } })}>Simpan</Button></>}>
        <Field label="Nama grup"><Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Baris 1" /></Field>
      </Modal>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger loading={act.isPending}
        title={confirm?.kind === 'delete' ? 'Hapus perangkat?' : confirm?.kind === 'revoke' ? 'Cabut kredensial perangkat?' : confirm?.row.status === 'disabled' ? 'Aktifkan perangkat?' : 'Nonaktifkan perangkat?'}
        message={confirm?.kind === 'delete' ? <>Perangkat <b>{confirm.row.name}</b> dan kredensialnya akan dihapus.</> : confirm?.kind === 'revoke' ? <>Token <b>{confirm?.row.name}</b> tidak akan berlaku lagi. Agen perangkat tidak dapat menarik kebijakan sampai diregistrasi ulang. Kebijakan yang sudah terpasang di browser tetap berlaku.</> : <>Perangkat yang dinonaktifkan tidak dapat melakukan check-in.</>}
        confirmLabel={confirm?.kind === 'delete' ? 'Hapus' : 'Lanjutkan'}
        onConfirm={() => confirm && act.mutate(confirm.kind === 'delete' ? { url: `/devices/${confirm.row.id}`, method: 'DELETE' } : confirm.kind === 'revoke' ? { url: `/devices/${confirm.row.id}/revoke` } : { url: `/devices/${confirm.row.id}/status`, body: { status: confirm.row.status === 'disabled' ? 'active' : 'disabled' } })} />
      {detail && <DeviceDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );

  function RowActions({ d }: { d: any }) {
    return (
      <div className="flex flex-wrap justify-end gap-0.5">
        <Button size="sm" variant="ghost" title="Detail & log" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDetail(d.id)} />
        {canManage && <>
          <Button size="sm" variant="ghost" title="Edit" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => open(d)} />
          <Button size="sm" variant="ghost" title="Registrasi / unduh installer" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setReg(d)} />
          <Button size="sm" variant="ghost" title="Pasangkan dengan gateway" icon={<Network className="h-3.5 w-3.5" />} onClick={() => setPair(d)} />
          <Button size="sm" variant="ghost" title="Kirim ulang sinkronisasi kebijakan" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={d.credentialStatus !== 'issued'} onClick={() => act.mutate({ url: `/devices/${d.id}/resync` })} />
          <Button size="sm" variant="ghost" title={d.status === 'disabled' ? 'Aktifkan' : 'Nonaktifkan'} icon={<Power className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'disable', row: d })} />
          <Button size="sm" variant="ghost" title="Cabut kredensial" icon={<Ban className="h-3.5 w-3.5" />} disabled={d.credentialStatus !== 'issued'} onClick={() => setConfirm({ kind: 'revoke', row: d })} />
          <Button size="sm" variant="ghost" title="Hapus" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirm({ kind: 'delete', row: d })} />
        </>}
        {d.resyncRequestedAt && <Badge tone="amber">Sinkron diminta</Badge>}
      </div>
    );
  }
}
