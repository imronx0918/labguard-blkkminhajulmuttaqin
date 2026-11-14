import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Rocket, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useGet } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, Loading, Modal, PageHeader, cx } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const LINKS: Record<string, [string, string]> = {
  firebase: ['/settings', 'Lihat docs/installation.md'], superAdmin: ['/users', 'Pengguna'], institution: ['/settings', 'Isi profil lembaga'], laboratory: ['/laboratories', 'Buat laboratorium'],
  gatewayRegistered: ['/gateways', 'Registrasi gateway'], gatewayInstalled: ['/gateways', 'Pasang agent'], networkCheck: ['/gateways', 'Periksa penerapan'], deviceRegistered: ['/devices', 'Registrasi perangkat'], chromePolicy: ['/devices', 'Pasang installer kebijakan'],
};
const TESTS: Record<string, { title: string; steps: string[] }> = {
  testGoogleSearch: { title: 'Pengujian Google Search', steps: ['Di komputer lab terkelola, buka https://www.google.com — halaman harus terbuka.', 'Cari kata kunci (mis. "fotosintesis") — hasil pencarian harus tampil dengan SafeSearch terkunci.', 'Klik salah satu hasil yang tidak ada di daftar izin — harus DIBLOKIR.', 'Buka https://drive.google.com — harus DIBLOKIR.'] },
  testTiktok: { title: 'Pengujian pemblokiran TikTok', steps: ['Buka https://www.tiktok.com di browser — harus DIBLOKIR (halaman "diblokir administrator").', 'Opsional: jalankan nslookup tiktok.com dari komputer lab — harus NXDOMAIN (setelah LIVE).'] },
  testYoutube: { title: 'Pengujian pemblokiran YouTube', steps: ['Buka https://www.youtube.com dan https://youtu.be/xyz — harus DIBLOKIR.', 'Cari "youtube" di Google lalu klik hasil — tetap DIBLOKIR.'] },
};

export default function Setup() {
  const { can, refreshConfig } = useAuth();
  const q = useGet<any>('/settings/setup', { refetchInterval: 15_000 });
  const [test, setTest] = useState<string | null>(null);
  const [device, setDevice] = useState('');
  const [note, setNote] = useState('');
  const [live, setLive] = useState<'LIVE' | 'DEMO' | null>(null);
  const record = useAction((b: any) => api(`/settings/setup/${test}`, { body: b }), { success: 'Hasil uji dicatat', invalidate: ['/settings'], onSuccess: () => { setTest(null); setNote(''); } });
  const mode = useAction((m: string) => api('/settings/mode', { body: { mode: m, confirm: true } }), { success: (r: any) => `Mode ${r.mode} aktif`, invalidate: ['/'], onSuccess: () => { setLive(null); refreshConfig(); } });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data;
  const done = d.steps.filter((s: any) => s.done).length;
  return (
    <>
      <PageHeader title="Instalasi Terpandu" subtitle="Langkah otomatis dicentang dari data sistem nyata. LIVE MODE baru dapat diaktifkan setelah konfigurasi minimum & tes dasar lulus." icon={<Rocket className="h-5 w-5" />} />
      <Card className="mb-4"><div className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1"><p className="text-sm font-semibold">Kemajuan: {done} / {d.steps.length} langkah</p><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-navy-500 to-emerald-500" style={{ width: `${(done / d.steps.length) * 100}%` }} /></div></div>
        <Badge tone={d.mode === 'LIVE' ? 'green' : 'violet'}>{d.mode} MODE</Badge>
        {can('system.mode') && (d.mode === 'DEMO' ? <Button variant="success" disabled={!d.canGoLive} icon={<Rocket className="h-4 w-4" />} onClick={() => setLive('LIVE')}>Aktifkan LIVE MODE</Button> : <Button variant="outline" onClick={() => setLive('DEMO')}>Kembali ke DEMO</Button>)}
      </div>
        {!d.canGoLive && d.mode === 'DEMO' && <div className="mx-5 mb-5 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert className="h-5 w-5 shrink-0" /><span>LIVE MODE terkunci. Belum lengkap: {d.missing.join('; ')}.</span></div>}
      </Card>
      <ol className="space-y-2">
        {d.steps.map((s: any, i: number) => (
          <li key={s.key} className={cx('card flex flex-wrap items-center gap-4 p-4', s.done && 'border-emerald-200')}>
            <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', s.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{s.done ? <CheckCircle2 className="h-5 w-5" /> : i + 1}</div>
            <div className="min-w-0 flex-1"><p className="font-semibold">{s.label}</p><p className="text-xs text-slate-500">{s.detail || (s.auto ? 'Diperiksa otomatis' : 'Dicatat oleh administrator setelah pengujian')}{s.at && ` · ${fmtDateTime(s.at)}`}</p></div>
            <Badge tone={s.auto ? 'blue' : 'slate'}>{s.auto ? 'Otomatis' : 'Manual'}</Badge>
            {LINKS[s.key] && !s.done && <Link to={LINKS[s.key][0]}><Button size="sm" variant="outline">{LINKS[s.key][1]}</Button></Link>}
            {TESTS[s.key] && can('settings.manage') && <Button size="sm" variant={s.done ? 'ghost' : 'secondary'} onClick={() => setTest(s.key)}>{s.done ? 'Uji ulang' : 'Catat hasil uji'}</Button>}
            {s.key === 'liveMode' && (s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />)}
          </li>
        ))}
      </ol>
      <Modal open={!!test} onClose={() => setTest(null)} title={test ? TESTS[test].title : ''} footer={<><Button variant="outline" onClick={() => setTest(null)}>Batal</Button><Button variant="danger" icon={<XCircle className="h-4 w-4" />} loading={record.isPending} onClick={() => record.mutate({ passed: false, note, deviceName: device })}>Gagal</Button><Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={record.isPending} onClick={() => record.mutate({ passed: true, note, deviceName: device })}>Lulus</Button></>}>
        {test && <div className="space-y-4 text-sm"><ol className="list-decimal space-y-1.5 pl-5">{TESTS[test].steps.map((st) => <li key={st}>{st}</li>)}</ol>
          <Field label="Komputer yang diuji"><Input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="PC-LAB1-01" /></Field>
          <Field label="Catatan"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-xs text-slate-500">Pengujian dilakukan di browser sungguhan karena pemblokiran URL ditegakkan oleh kebijakan Chrome di perangkat. Hasil dicatat di audit log.</p></div>}
      </Modal>
      <ConfirmDialog open={!!live} onClose={() => setLive(null)} danger={live === 'LIVE'} loading={mode.isPending} title={live === 'LIVE' ? 'Aktifkan LIVE MODE?' : 'Kembali ke MODE DEMO?'} confirmLabel={live === 'LIVE' ? 'Aktifkan LIVE' : 'Kembali ke DEMO'}
        message={live === 'LIVE' ? 'Gateway akan MENERAPKAN aturan firewall & DNS sungguhan ke jaringan laboratorium. Status hanya dinyatakan berhasil setelah konfirmasi agent. Pastikan akses administrasi (SSH) ke gateway tetap tersedia.' : 'Gateway akan berhenti menerapkan perubahan baru (hanya validasi). Aturan yang sudah terpasang di gateway tetap dipertahankan.'}
        onConfirm={() => mode.mutate(live!)} />
    </>
  );
}
