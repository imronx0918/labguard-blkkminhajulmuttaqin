import { useState } from 'react';
import { Activity, AlertTriangle, Archive, BookOpen, Download, KeyRound, Network, Plus, RefreshCw, RotateCcw, ShieldOff, Trash2, Wifi, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { api, download } from '../lib/api';
import { useAction, useGet, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, Dot, Empty, ErrorState, Field, Input, KeyVal, Loading, Modal, PageHeader, Select, StatusBadge, Table, Tabs, cx } from '../components/ui';
import { fmtDateTime, fmtTime, timeAgo } from '../lib/format';

function GatewayDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const q = useGet<any>(`/gateways/${id}`, { refetchInterval: 15_000 });
  const logs = useGet<any>(`/gateways/${id}/logs?limit=30`);
  const [tab, setTab] = useState<'status' | 'deploy' | 'logs' | 'backup' | 'install'>('status');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pairing, setPairing] = useState<any | null>(null);
  const [test, setTest] = useState<any | null>(null);
  const inv = ['/gateways', '/deployments', '/dashboard'];
  const cmd = useAction((type: string) => api(`/gateways/${id}/commands`, { body: { type } }), { success: (r: any) => r.note, invalidate: inv, onSuccess: () => setConfirm(null) });
  const testConn = useAction(() => api(`/gateways/${id}/test-connection`, { body: {} }), { onSuccess: setTest, invalidate: inv });
  const newCode = useAction(() => api(`/gateways/${id}/pairing-code`, { body: {} }), { onSuccess: setPairing, invalidate: inv });
  const revoke = useAction(() => api(`/gateways/${id}/revoke`, { body: {} }), { success: 'Gateway dicabut — secret tidak berlaku lagi', invalidate: inv, onSuccess: () => setConfirm(null) });
  const g = q.data;
  return (
    <Modal open onClose={onClose} size="xl" title={g ? `Gateway — ${g.name}` : 'Gateway'}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <>
          {!g.online && g.status === 'PAIRED' && <div className="mb-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="h-5 w-5 shrink-0" /><div><b>Gateway OFFLINE.</b> Heartbeat terakhir {timeAgo(g.lastHeartbeatAt)}. Gateway tetap mempertahankan kebijakan terakhir yang valid; konfigurasi baru tidak dinyatakan diterapkan sampai ada konfirmasi.</div></div>}
          <div className="mb-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<Wifi className="h-4 w-4" />} loading={testConn.isPending} onClick={() => testConn.mutate(undefined)}>Tes koneksi</Button>
            {can('gateways.test') && g.status === 'PAIRED' && <Button size="sm" variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => cmd.mutate('SYNC_CONFIGURATION')}>Sinkronisasi</Button>}
            {can('gateways.test') && g.status === 'PAIRED' && <Button size="sm" variant="outline" icon={<Activity className="h-4 w-4" />} onClick={() => cmd.mutate('RELOAD_FILTERING')}>Reload filtering</Button>}
            {can('gateways.manage') && g.status === 'PAIRED' && <Button size="sm" variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => cmd.mutate('BACKUP_CONFIGURATION')}>Backup konfigurasi</Button>}
            {can('policies.rollback') && g.status === 'PAIRED' && <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('rollback')}>Rollback</Button>}
            {can('gateways.manage') && <Button size="sm" variant="outline" icon={<KeyRound className="h-4 w-4" />} onClick={() => newCode.mutate(undefined)}>{g.status === 'PAIRED' ? 'Rotasi secret (pairing ulang)' : 'Kode pairing baru'}</Button>}
            {can('gateways.manage') && g.status !== 'REVOKED' && <Button size="sm" variant="danger" icon={<ShieldOff className="h-4 w-4" />} onClick={() => setConfirm('revoke')}>Revoke</Button>}
          </div>
          {test && <div className={cx('mb-4 rounded-lg border p-3 text-sm', test.online ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>{test.message} Versi diminta v{test.desiredPolicyVersion} · terkonfirmasi {test.appliedPolicyVersion != null ? `v${test.appliedPolicyVersion}` : '—'}</div>}
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'status', label: 'Status' }, { key: 'deploy', label: 'Penerapan' }, { key: 'logs', label: 'Log gateway' }, { key: 'backup', label: 'Backup' }, { key: 'install', label: 'Panduan instalasi' }]} />
          {tab === 'status' && (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="divide-y divide-slate-100">
                <KeyVal k="Gateway ID" v={<span className="mono">{g.id}</span>} /><KeyVal k="Lokasi" v={g.location || '—'} /><KeyVal k="IP lokal" v={<span className="mono">{g.localIp || '—'}</span>} />
                <KeyVal k="Status pairing" v={<StatusBadge status={g.status} />} /><KeyVal k="Koneksi" v={<span className="flex items-center gap-2"><Dot on={g.online} pulse />{g.online ? 'Online' : 'Offline'}</span>} />
                <KeyVal k="Heartbeat terakhir" v={`${fmtDateTime(g.lastHeartbeatAt)} (${timeAgo(g.lastHeartbeatAt)})`} /><KeyVal k="Versi agent" v={g.agentVersion || '—'} /><KeyVal k="Adapter" v={<span className="mono">{g.adapter}</span>} />
                <KeyVal k="Laboratorium" v={g.labs.map((l: any) => l.name).join(', ') || '—'} />
              </div>
              <div className="divide-y divide-slate-100">
                <KeyVal k="Status filtering" v={<StatusBadge status={g.filtering?.state} />} /><KeyVal k="Status DNS" v={<span className="text-right"><StatusBadge status={g.dns?.state} /><span className="block text-[11px] text-slate-400">{g.dns?.detail}</span></span>} />
                <KeyVal k="Status firewall" v={<span className="text-right"><StatusBadge status={g.firewall?.state} /><span className="block text-[11px] text-slate-400">{g.firewall?.detail}</span></span>} />
                <KeyVal k="Versi kebijakan diminta" v={`v${g.desiredPolicyVersion ?? 0}`} /><KeyVal k="Versi kebijakan aktif (terkonfirmasi)" v={g.appliedPolicyVersion != null ? `v${g.appliedPolicyVersion}` : '—'} />
                <KeyVal k="Sinkronisasi terakhir" v={fmtDateTime(g.lastSyncAt)} /><KeyVal k="Perangkat ditangani / aktif" v={`${g.devicesHandled} / ${g.devicesActive}`} />
              </div>
              <div className="md:col-span-2">
                <p className="label">Perlindungan anti-bypass (dilaporkan agent)</p>
                {!g.protections?.length ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Belum ada laporan — muncul setelah agent menerapkan kebijakan.</p> : (
                  <ul className="grid gap-2 sm:grid-cols-2">{g.protections.map((p: any) => <li key={p.key} className="flex gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">{p.active ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-slate-400" />}<span><span className="font-medium">{p.label}</span>{p.note && <span className="block text-xs text-slate-500">{p.note}</span>}</span></li>)}</ul>
                )}
              </div>
            </div>
          )}
          {tab === 'deploy' && (!g.deployments.length ? <Empty title="Belum ada penerapan" /> : (
            <Table head={['Dibuat', 'Versi', 'Alasan', 'Mode', 'Status', 'Diambil', 'Dikonfirmasi', 'Pemeriksaan']}>
              {g.deployments.map((d: any) => <tr key={d.id}><td className="td text-xs">{fmtDateTime(d.createdAt)}</td><td className="td mono">v{d.version}</td><td className="td mono text-xs">{d.reason}</td><td className="td"><Badge tone={d.mode === 'LIVE' ? 'green' : 'violet'}>{d.mode}</Badge></td><td className="td"><StatusBadge status={d.status} />{d.error && <div className="max-w-xs text-[11px] text-red-600">{d.error}</div>}</td><td className="td text-xs">{fmtDateTime(d.fetchedAt)}</td><td className="td text-xs">{fmtDateTime(d.confirmedAt)}</td><td className="td text-xs">{d.checks?.length ? `${d.checks.filter((c: any) => c.passed).length}/${d.checks.length} lolos` : '—'}</td></tr>)}
            </Table>
          ))}
          {tab === 'logs' && (!logs.data?.items.length ? <Empty title="Belum ada log gateway" /> : (
            <Table head={['Waktu', 'Tipe', 'Domain / keterangan', 'Klien']}>
              {logs.data.items.map((l: any) => <tr key={l.id}><td className="td mono text-xs">{fmtTime(l.ts)}</td><td className="td"><StatusBadge status={l.type} /></td><td className="td text-xs"><span className="mono">{l.domain}</span> {l.reason}</td><td className="td mono text-xs">{l.clientIp ?? l.deviceName}</td></tr>)}
            </Table>
          ))}
          {tab === 'backup' && (!g.backups.length ? <Empty title="Belum ada backup" message="Agent membuat backup otomatis sebelum setiap penerapan, dan dapat diminta manual." /> : (
            <Table head={['Waktu', 'Alasan', 'Versi', 'Berkas', '']}>
              {g.backups.map((b: any) => <tr key={b.id}><td className="td text-xs">{fmtDateTime(b.createdAt)}</td><td className="td">{b.reason}</td><td className="td mono">{b.version != null ? `v${b.version}` : '—'}</td><td className="td mono text-xs">{b.files.join(', ')}</td><td className="td text-right">{can('gateways.manage') && <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`/gateways/${id}/backups/${b.id}`, 'backup.json')}>Unduh</Button>}</td></tr>)}
            </Table>
          ))}
          {tab === 'install' && <InstallGuide gatewayId={id} />}
        </>
      )}
      <Modal open={!!pairing} onClose={() => setPairing(null)} title="Kode pairing" size="sm" footer={<Button onClick={() => setPairing(null)}>Selesai</Button>}><PairingCode p={pairing} /></Modal>
      <ConfirmDialog open={confirm === 'revoke'} onClose={() => setConfirm(null)} danger loading={revoke.isPending} title="Revoke gateway?" message="Secret gateway dicabut; agent tidak dapat lagi mengambil kebijakan atau mengirim data. Aturan yang sudah terpasang di gateway TIDAK dihapus otomatis (tidak fail-open)." confirmLabel="Revoke" onConfirm={() => revoke.mutate(undefined)} />
      <ConfirmDialog open={confirm === 'rollback'} onClose={() => setConfirm(null)} danger loading={cmd.isPending} title="Rollback konfigurasi gateway?" message="Agent akan memulihkan konfigurasi nftables & DNS dari backup terakhir pada heartbeat berikutnya. Tindakan dicatat di audit log." confirmLabel="Rollback" onConfirm={() => cmd.mutate('ROLLBACK')} />
    </Modal>
  );
}

function PairingCode({ p }: { p: any }) {
  if (!p) return null;
  return (
    <div className="space-y-3 text-sm">
      <p>Masukkan kode sekali pakai ini saat instalasi agent. Berlaku hingga <b>{fmtDateTime(p.pairingExpiresAt)}</b>.</p>
      <p className="rounded-xl bg-navy-900 py-4 text-center font-mono text-2xl font-bold tracking-[0.3em] text-white">{p.pairingCode}</p>
      <pre className="mono overflow-x-auto rounded-lg bg-slate-100 p-3">sudo bash install-labguard-gateway.sh {p.pairingCode}</pre>
      <p className="text-xs text-slate-500">Kode hanya ditampilkan sekali dan disimpan di server dalam bentuk hash.</p>
    </div>
  );
}

function InstallGuide({ gatewayId }: { gatewayId?: string }) {
  const { can } = useAuth();
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('/gateways/installer', 'install-labguard-gateway.sh')}>Download installer</Button>
        {gatewayId && can('gateways.manage') && <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => download(`/gateways/${gatewayId}/config`, 'agent.json')}>Download konfigurasi</Button>}
      </div>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Siapkan Ubuntu Server 22.04/24.04 dengan <b>dua antarmuka jaringan</b>: WAN (ke router internet) dan LAN (ke switch laboratorium). Gateway berada di antara router dan switch lab.</li>
        <li>Pastikan subnet setiap lab sudah diisi di menu <b>Laboratorium</b> dan lab tersebut terhubung ke gateway ini.</li>
        <li>Salin installer ke gateway, lalu jalankan: <code className="mono">sudo bash install-labguard-gateway.sh KODE-PAIRING</code>.</li>
        <li>Periksa <code className="mono">/etc/labguard-agent/agent.json</code>: <code className="mono">lan_interface</code>, <code className="mono">wan_interface</code>, <code className="mono">local_networks</code>.</li>
        <li>Jalankan <code className="mono">sudo python3 /opt/labguard-agent/labguard_agent.py validate</code> (dry-run) — tidak mengubah jaringan.</li>
        <li>Gateway akan online di dashboard setelah heartbeat valid pertama. Di MODE DEMO agent hanya memvalidasi; perubahan jaringan baru diterapkan setelah LIVE MODE diaktifkan.</li>
        <li>Komunikasi hanya keluar via HTTPS — tidak perlu membuka port administrasi gateway ke internet.</li>
      </ol>
      <p className="flex items-center gap-1 text-xs text-slate-500"><BookOpen className="h-3.5 w-3.5" />Dokumentasi lengkap: <span className="mono">docs/gateway-setup.md</span></p>
    </div>
  );
}

export default function Gateways() {
  const { can } = useAuth();
  const { labs } = useLookups();
  const list = useList<any>('/gateways', { refetchInterval: 15_000 });
  const [detail, setDetail] = useState<string | null>(null);
  const [form, setForm] = useState<any | null>(null);
  const [pairing, setPairing] = useState<any | null>(null);
  const [guide, setGuide] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const inv = ['/gateways', '/laboratories', '/dashboard'];
  const save = useAction((b: any) => (b.id ? api(`/gateways/${b.id}`, { method: 'PUT', body: { name: b.name, location: b.location, labIds: b.labIds, adapter: b.adapter } }) : api('/gateways', { body: b })), { invalidate: inv, onSuccess: (r: any) => { setForm(null); if (r.pairingCode) setPairing(r); } });
  const remove = useAction((id: string) => api(`/gateways/${id}`, { method: 'DELETE' }), { success: 'Gateway dihapus', invalidate: inv, onSuccess: () => setDel(null) });
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHeader title="Gateway dan Jaringan" subtitle="Status hanya dari heartbeat valid. Penerapan dinyatakan berhasil hanya setelah konfirmasi agent." icon={<Network className="h-5 w-5" />}
        actions={<><Button variant="outline" icon={<BookOpen className="h-4 w-4" />} onClick={() => setGuide(true)}>Panduan instalasi</Button>{can('gateways.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ name: '', location: '', labIds: [], adapter: 'linux-nftables-dnsmasq' })}>Registrasi gateway</Button>}</>} />
      {items.some((g) => g.status === 'PAIRED' && !g.online) && <div className="mb-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="h-5 w-5 shrink-0" /><div><b>Ada gateway OFFLINE.</b> Kebijakan terakhir yang valid tetap berlaku di gateway; filter tidak dimatikan otomatis.</div></div>}
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !items.length ? (
        <Card><Empty icon={<Network className="h-6 w-6" />} title="Belum ada gateway (BELUM DIKONFIGURASI)" message="Tanpa gateway, kebijakan jaringan tidak dapat diterapkan. Kebijakan browser tetap dapat dipasang di perangkat." action={can('gateways.manage') && <Button size="sm" onClick={() => setForm({ name: '', location: '', labIds: [], adapter: 'linux-nftables-dnsmasq' })}>Registrasi gateway</Button>} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((g) => (
            <div key={g.id} className={cx('card p-5', g.status === 'PAIRED' && !g.online && 'border-red-200')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><div className={cx('flex h-11 w-11 items-center justify-center rounded-xl', g.online ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}><Network className="h-5 w-5" /></div>
                  <div><p className="font-bold text-navy-900">{g.name}</p><p className="text-xs text-slate-500">{g.location || '—'} · <span className="mono">{g.localIp || 'IP belum diketahui'}</span></p></div></div>
                <div className="flex flex-col items-end gap-1"><span className="flex items-center gap-1.5 text-sm font-semibold"><Dot on={g.online} pulse />{g.online ? 'ONLINE' : 'OFFLINE'}</span><StatusBadge status={g.status} /></div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[['Filtering', g.filtering?.state], ['DNS', g.dns?.state], ['Firewall', g.firewall?.state]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">{k}</p><StatusBadge status={v} /></div>)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 text-sm">
                <KeyVal k="Versi agent" v={g.agentVersion || '—'} /><KeyVal k="Heartbeat" v={timeAgo(g.lastHeartbeatAt)} />
                <KeyVal k="Kebijakan aktif" v={g.appliedPolicyVersion != null ? `v${g.appliedPolicyVersion}` : '—'} /><KeyVal k="Diminta" v={<span className={cx(g.appliedPolicyVersion !== g.desiredPolicyVersion && 'text-amber-600')}>v{g.desiredPolicyVersion}</span>} />
                <KeyVal k="Perangkat (aktif)" v={`${g.devicesHandled} (${g.devicesActive})`} /><KeyVal k="Sinkron terakhir" v={timeAgo(g.lastSyncAt)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
                <Button size="sm" variant="secondary" onClick={() => setDetail(g.id)}>Kelola & detail</Button>
                {can('gateways.manage') && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setForm({ ...g })}>Edit</Button>}
                {can('gateways.manage') && g.status !== 'PAIRED' && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(g)}>Hapus</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit gateway' : 'Registrasi gateway'} footer={<><Button variant="outline" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(form)}>{form?.id ? 'Simpan' : 'Registrasi & buat kode pairing'}</Button></>}>
        {form && <div className="space-y-4">
          <Field label="Nama gateway *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gateway Gedung A" /></Field>
          <Field label="Lokasi"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Adapter jaringan" hint="Adapter router lain belum diverifikasi — gunakan gateway Linux."><Select value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}><option value="linux-nftables-dnsmasq">Linux gateway — nftables + dnsmasq (terverifikasi)</option><option value="mikrotik-routeros-rest">MikroTik RouterOS REST (BELUM DIVERIFIKASI)</option></Select></Field>
          <div><p className="label">Laboratorium yang ditangani</p><div className="space-y-1 rounded-lg border border-slate-200 p-3">{labs.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.labIds.includes(l.id)} onChange={(e) => setForm({ ...form, labIds: e.target.checked ? [...form.labIds, l.id] : form.labIds.filter((x: string) => x !== l.id) })} />{l.name} <span className="mono text-xs text-slate-400">{l.subnet || 'subnet belum diisi'}</span></label>)}{!labs.length && <p className="text-xs text-slate-400">Buat laboratorium terlebih dahulu.</p>}</div></div>
        </div>}
      </Modal>
      <Modal open={!!pairing} onClose={() => setPairing(null)} title="Gateway terdaftar" size="sm" footer={<Button onClick={() => setPairing(null)}>Selesai</Button>}><PairingCode p={pairing} /></Modal>
      <Modal open={guide} onClose={() => setGuide(false)} title="Panduan instalasi Gateway Agent" size="lg"><InstallGuide /></Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger loading={remove.isPending} title="Hapus gateway?" message={<>Gateway <b>{del?.name}</b> akan dihapus dan lab terkait menjadi BELUM DIKONFIGURASI.</>} confirmLabel="Hapus" onConfirm={() => remove.mutate(del.id)} />
      {detail && <GatewayDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
