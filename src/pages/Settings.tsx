import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Building, Clock, Database, Download, Bell, Globe, Lock, Network, Rocket, Settings as SettingsIcon, Trash2, Upload, Users, AppWindow, Building2 } from 'lucide-react';
import { api, download } from '../lib/api';
import { useAction, useGet } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, Loading, PageHeader, Textarea, Toggle, cx } from '../components/ui';
import { useToast } from '../components/Toast';

const SECTIONS = [
  ['institution', 'Profil lembaga', Building], ['app', 'Identitas aplikasi', AppWindow], ['labs', 'Pengaturan laboratorium', Building2], ['timezone', 'Zona waktu', Clock],
  ['gateway', 'Pengaturan gateway', Network], ['security', 'Keamanan', Lock], ['logs', 'Retensi log', Database], ['notifications', 'Notifikasi', Bell],
  ['backup', 'Backup konfigurasi', Archive], ['admins', 'Manajemen administrator', Users],
] as const;
const NOTIF: Record<string, string> = { GATEWAY_OFFLINE: 'Gateway offline', DEVICE_POLICY_OUTDATED: 'Komputer tidak menerapkan kebijakan', SYNC_FAILED: 'Sinkronisasi gagal', NEW_DEVICE: 'Perangkat baru terhubung', BLOCKED_ATTEMPT: 'Percobaan mengakses situs terlarang', PERMISSION_REQUEST: 'Permintaan izin website', POLICY_APPLIED: 'Kebijakan berhasil diterapkan', CONFIG_ERROR: 'Kesalahan konfigurasi' };

export default function Settings() {
  const { can, refreshConfig } = useAuth();
  const toast = useToast();
  const q = useGet<any>('/settings');
  const [sec, setSec] = useState<string>('institution');
  const [s, setS] = useState<any>(null);
  const [demoClear, setDemoClear] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (q.data) setS(structuredClone(q.data)); }, [q.data]);
  const save = useAction((b: any) => api('/settings', { method: 'PUT', body: b }), { success: 'Pengaturan disimpan', invalidate: ['/settings', '/dashboard'], onSuccess: () => refreshConfig() });
  const demoLoad = useAction(() => api('/settings/demo-data', { body: {} }), { success: (r: any) => (r.skipped ? 'Data DEMO sudah dimuat sebelumnya' : 'Data contoh DEMO dimuat'), invalidate: ['/'] });
  const demoDel = useAction(() => api('/settings/demo-data', { method: 'DELETE' }), { success: 'Data DEMO dihapus', invalidate: ['/'], onSuccess: () => setDemoClear(false) });
  const restore = useAction((b: any) => api('/settings/restore', { body: b }), { success: (r: any) => `Konfigurasi dipulihkan (${Object.values(r.restored).reduce((a: number, b: any) => a + b, 0)} dokumen). Penerapan ulang dibuat.`, invalidate: ['/'] });
  const ro = !can('settings.manage');
  if (q.isLoading || !s) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const set = (path: string, v: any) => { const n = structuredClone(s); const k = path.split('.'); let o = n; for (const x of k.slice(0, -1)) o = o[x]; o[k[k.length - 1]] = v; setS(n); };
  const saveSec = (key: string) => save.mutate({ [key]: s[key] });
  const lines = (a: string[]) => a.join('\n');
  const split = (t: string) => t.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <PageHeader title="Pengaturan" subtitle="Konfigurasi sistem tersimpan di Firestore (systemSettings)." icon={<SettingsIcon className="h-5 w-5" />} actions={can('settings.manage') && <Link to="/setup"><Button variant="secondary" icon={<Rocket className="h-4 w-4" />}>Instalasi terpandu</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <nav className="card h-fit p-2">{SECTIONS.map(([k, l, I]) => <button key={k} onClick={() => setSec(k)} className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium', sec === k ? 'bg-navy-50 text-navy-800' : 'text-slate-600 hover:bg-slate-50')}><I className="h-4 w-4" />{l}</button>)}</nav>
        <div>
          {sec === 'institution' && <Card title="Profil lembaga" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('institution')}>Simpan</Button>}><div className="grid gap-4 p-5 sm:grid-cols-2">
            {[['name', 'Nama lembaga'], ['npsn', 'NPSN'], ['headmaster', 'Kepala sekolah / pimpinan'], ['phone', 'Telepon'], ['email', 'Email']].map(([k, l]) => <Field key={k} label={l}><Input disabled={ro} value={s.institution[k]} onChange={(e) => set(`institution.${k}`, e.target.value)} /></Field>)}
            <Field label="Alamat" className="sm:col-span-2"><Textarea disabled={ro} value={s.institution.address} onChange={(e) => set('institution.address', e.target.value)} /></Field></div></Card>}
          {sec === 'app' && <Card title="Identitas aplikasi" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('app')}>Simpan</Button>}><div className="grid gap-4 p-5"><Field label="Nama aplikasi"><Input disabled={ro} value={s.app.name} onChange={(e) => set('app.name', e.target.value)} /></Field><Field label="Tagline"><Input disabled={ro} value={s.app.tagline} onChange={(e) => set('app.tagline', e.target.value)} /></Field></div></Card>}
          {sec === 'labs' && <Card title="Pengaturan laboratorium"><div className="space-y-3 p-5 text-sm text-slate-600"><p>Data laboratorium (subnet, gateway, profil kebijakan default) dikelola di menu <Link className="font-semibold text-navy-600" to="/laboratories">Laboratorium</Link>. Akses Google Search diatur di bawah.</p>
            <Field label="Hostname Google Search yang diizinkan" hint="Satu per baris. Hanya host ini (tanpa subdomain) yang diizinkan di browser."><Textarea disabled={ro} className="mono" rows={4} value={lines(s.google.searchHosts)} onChange={(e) => set('google.searchHosts', split(e.target.value))} /></Field>
            <Field label="Host resource statis Google (DNS)" hint="Ditambahkan secara terkontrol melalui Diagnostik Google di menu Kebijakan."><Textarea disabled={ro} className="mono" rows={5} value={lines(s.google.resourceHosts)} onChange={(e) => set('google.resourceHosts', split(e.target.value))} /></Field>
            <Field label="Path non-pencarian yang diblokir di host Google" hint="mis. /maps, /travel"><Textarea disabled={ro} className="mono" rows={4} value={lines(s.google.blockedPaths)} onChange={(e) => set('google.blockedPaths', split(e.target.value))} /></Field>
            {!ro && <Button loading={save.isPending} onClick={() => saveSec('google')}>Simpan & terapkan ulang</Button>}</div></Card>}
          {sec === 'timezone' && <Card title="Zona waktu"><div className="p-5 text-sm"><Field label="Zona waktu sistem"><Input disabled value="Asia/Jakarta (WIB, UTC+7)" /></Field><p className="mt-2 text-xs text-slate-500">Semua jadwal sesi, izin sementara, dan laporan memakai Asia/Jakarta. Server menyimpan timestamp dalam UTC (Firestore Timestamp).</p></div></Card>}
          {sec === 'gateway' && <Card title="Pengaturan gateway" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('gateway')}>Simpan</Button>}><div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Interval heartbeat (detik)"><Input disabled={ro} type="number" value={s.gateway.heartbeatIntervalSec} onChange={(e) => set('gateway.heartbeatIntervalSec', Number(e.target.value))} /></Field>
            <Field label="Dianggap offline setelah (detik)"><Input disabled={ro} type="number" value={s.gateway.offlineAfterSec} onChange={(e) => set('gateway.offlineAfterSec', Number(e.target.value))} /></Field>
            <Field label="Toleransi selisih jam (anti-replay)"><Input disabled={ro} type="number" value={s.gateway.maxClockSkewSec} onChange={(e) => set('gateway.maxClockSkewSec', Number(e.target.value))} /></Field></div></Card>}
          {sec === 'security' && <Card title="Pengaturan keamanan" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('security')}>Simpan & terapkan ulang</Button>}><div className="space-y-4 p-5">
            <Toggle label="Override kebijakan inti wajib Super Admin" checked disabled hint="Selalu aktif — tidak dapat dimatikan" onChange={() => {}} />
            <Toggle label="Guru boleh membuat sesi" disabled={ro} checked={s.security.allowTeacherCreateSession} onChange={(v) => set('security.allowTeacherCreateSession', v)} />
            <Toggle label="Blokir DNS over TLS (port 853)" disabled={ro} checked={s.security.blockDoT} onChange={(v) => set('security.blockDoT', v)} />
            <Toggle label="Blokir QUIC (UDP 443)" disabled={ro} checked={s.security.blockQuic} onChange={(v) => set('security.blockQuic', v)} />
            <Toggle label="Blokir port VPN umum" disabled={ro} checked={s.security.blockVpnPorts} onChange={(v) => set('security.blockVpnPorts', v)} />
            <Toggle label="SafeSearch via DNS (forcesafesearch.google.com)" disabled={ro} checked={s.security.dnsSafeSearchRewrite} onChange={(v) => set('security.dnsSafeSearchRewrite', v)} />
            <Field label="Batas sesi login (menit)" className="max-w-xs"><Input disabled={ro} type="number" value={s.security.sessionTimeoutMin} onChange={(e) => set('security.sessionTimeoutMin', Number(e.target.value))} /></Field></div></Card>}
          {sec === 'logs' && <Card title="Retensi & privasi log" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('logs')}>Simpan</Button>}><div className="space-y-4 p-5">
            <Field label="Masa retensi log (hari)" className="max-w-xs" hint="Log lebih lama dihapus otomatis oleh penjadwal"><Input disabled={ro} type="number" value={s.logs.retentionDays} onChange={(e) => set('logs.retentionDays', Number(e.target.value))} /></Field>
            <Toggle label="Simpan event ALLOWED" hint="Matikan untuk mengurangi data — hanya pemblokiran yang dicatat" disabled={ro} checked={s.logs.storeAllowedEvents} onChange={(v) => set('logs.storeAllowedEvents', v)} />
            <Toggle label="Simpan URL lengkap" hint="Tidak didukung: agent hanya mengirim domain (minimalisasi data)" disabled checked={false} onChange={() => {}} /></div></Card>}
          {sec === 'notifications' && <Card title="Notifikasi" actions={!ro && <Button size="sm" loading={save.isPending} onClick={() => saveSec('notifications')}>Simpan</Button>}><div className="space-y-3 p-5">{Object.entries(NOTIF).map(([k, l]) => <Toggle key={k} label={l} disabled={ro} checked={s.notifications[k] !== false} onChange={(v) => set(`notifications.${k}`, v)} />)}</div></Card>}
          {sec === 'backup' && <div className="space-y-4">
            <Card title="Backup & pemulihan konfigurasi" subtitle="Profil kebijakan, kategori, daftar situs, laboratorium, kelas, dan pengaturan.">
              <div className="flex flex-wrap gap-2 p-5">
                {can('backup.manage') ? <><Button icon={<Download className="h-4 w-4" />} onClick={() => download('/settings/backup', 'labguard-backup.json')}>Unduh backup</Button>
                  <Button variant="outline" icon={<Upload className="h-4 w-4" />} loading={restore.isPending} onClick={() => file.current?.click()}>Pulihkan dari file</Button>
                  <input ref={file} type="file" accept="application/json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { restore.mutate(JSON.parse(await f.text())); } catch { toast('error', 'File backup tidak valid'); } }} /></> : <p className="text-sm text-slate-500">Hanya Super Admin.</p>}
              </div>
              <p className="px-5 pb-5 text-xs text-slate-500">Backup konfigurasi jaringan gateway (nftables/dnsmasq) dibuat otomatis oleh agent sebelum setiap perubahan — lihat menu Gateway › Backup.</p>
            </Card>
            <Card title="Data contoh (DEMO)" subtitle="Hanya pada MODE DEMO. Semua data contoh berlabel DEMO dan wajib dihapus sebelum LIVE MODE.">
              <div className="flex flex-wrap items-center gap-2 p-5">
                <Badge tone={s.mode === 'LIVE' ? 'green' : 'violet'}>{s.mode} MODE</Badge>
                {!ro && <Button variant="secondary" disabled={s.mode !== 'DEMO'} loading={demoLoad.isPending} onClick={() => demoLoad.mutate(undefined)}>Muat data contoh</Button>}
                {!ro && <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDemoClear(true)}>Hapus data DEMO</Button>}
              </div>
            </Card>
          </div>}
          {sec === 'admins' && <Card title="Manajemen administrator"><div className="p-5 text-sm text-slate-600">Kelola akun Super Admin, Admin Laboratorium, Guru, dan Viewer di menu <Link className="font-semibold text-navy-600" to="/users">Pengguna dan Hak Akses</Link>. Sistem mencegah penghapusan/penurunan Super Admin terakhir.</div></Card>}
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Globe className="h-3.5 w-3.5" />Perubahan pengaturan dicatat di audit log.</div>
        </div>
      </div>
      <ConfirmDialog open={demoClear} onClose={() => setDemoClear(false)} danger loading={demoDel.isPending} title="Hapus semua data DEMO?" message="Semua dokumen berlabel DEMO (lab, kelas, peserta didik, perangkat, sesi, log contoh) dihapus. Data nyata tidak terpengaruh." confirmLabel="Hapus data DEMO" onConfirm={() => demoDel.mutate(undefined)} />
    </>
  );
}
