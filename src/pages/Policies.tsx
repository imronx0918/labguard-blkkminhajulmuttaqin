import { useMemo, useState } from 'react';
import { Copy, Download, FlaskConical, Layers, Lock, Pencil, Plus, Search, ShieldCheck, Stethoscope, Trash2 } from 'lucide-react';
import { api, download } from '../lib/api';
import { useAction, useGet, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Tabs, Textarea, Toggle, cx } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const TYPE_TONE: Record<string, any> = { GOOGLE_SEARCH_ONLY: 'blue', LEARNING: 'green', FULL_LOCK: 'red', CUSTOM: 'violet' };
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DEFAULT_TESTS = [
  'https://www.google.com/', 'https://www.google.com/search?q=fotosintesis', 'https://www.google.co.id/search?q=sejarah+indonesia',
  'https://www.google.com/url?q=https://contoh-situs.com', 'https://contoh-situs.com/', 'https://www.youtube.com/', 'https://youtu.be/abc123',
  'https://www.tiktok.com/', 'https://drive.google.com/', 'https://mail.google.com/', 'https://gemini.google.com/', 'https://www.google.com/maps', 'https://nordvpn.com/',
];
const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

function PolicyEditor({ policy, onClose }: { policy: any; onClose: () => void }) {
  const { can } = useAuth();
  const { labs, classes } = useLookups();
  const cats = useList<any>('/sites/categories');
  const isNew = !policy.id;
  const [f, setF] = useState(() => ({
    name: policy.name ?? '', description: policy.description ?? '', active: policy.active ?? true, googleSearch: policy.googleSearch ?? true, safeSearch: policy.safeSearch ?? true,
    includeGlobalAllowlist: policy.includeGlobalAllowlist ?? false, ipEnforcement: policy.ipEnforcement ?? false,
    blockedCategoryIds: policy.blockedCategoryIds ?? (cats.data?.items ?? []).map((c: any) => c.id),
    allowedDomains: (policy.allowedDomains ?? []).join('\n'), blockedDomains: (policy.blockedDomains ?? []).join('\n'),
    allowedUrls: (policy.allowedUrls ?? []).join('\n'), blockedUrls: (policy.blockedUrls ?? []).join('\n'),
    scheduleOn: !!policy.schedule, days: policy.schedule?.days ?? [1, 2, 3, 4, 5], start: policy.schedule?.start ?? '07:00', end: policy.schedule?.end ?? '15:00',
    targetLabIds: policy.targetLabIds ?? [], targetClassIds: policy.targetClassIds ?? [],
  }));
  const save = useAction((b: any) => (isNew ? api('/policies', { body: b }) : api(`/policies/${policy.id}`, { method: 'PUT', body: b })),
    { success: (r: any) => (r.deployments?.length ? `Profil disimpan — ${r.deployments.length} penerapan dibuat (menunggu konfirmasi gateway)` : 'Profil disimpan'), invalidate: ['/policies', '/deployments'], onSuccess: onClose });
  const fullLock = policy.type === 'FULL_LOCK';
  const submit = () => save.mutate({
    name: f.name, description: f.description, active: f.active, googleSearch: fullLock ? false : f.googleSearch, safeSearch: f.safeSearch, includeGlobalAllowlist: f.includeGlobalAllowlist, ipEnforcement: fullLock || f.ipEnforcement,
    blockedCategoryIds: f.blockedCategoryIds, allowedDomains: lines(f.allowedDomains), blockedDomains: lines(f.blockedDomains), allowedUrls: lines(f.allowedUrls), blockedUrls: lines(f.blockedUrls),
    schedule: f.scheduleOn ? { days: f.days, start: f.start, end: f.end } : null, targetLabIds: f.targetLabIds, targetClassIds: f.targetClassIds,
  });
  const toggleArr = (k: 'blockedCategoryIds' | 'targetLabIds' | 'targetClassIds' | 'days', v: any) => setF({ ...f, [k]: (f[k] as any[]).includes(v) ? (f[k] as any[]).filter((x) => x !== v) : [...(f[k] as any[]), v] });

  return (
    <Modal open onClose={onClose} size="xl" title={isNew ? 'Buat profil kebijakan (CUSTOM)' : `Editor aturan — ${policy.name}`} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button loading={save.isPending} onClick={submit}>Simpan & terapkan</Button></>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Nama profil *"><Input value={f.name} disabled={policy.builtin} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Deskripsi"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <Toggle label="Profil aktif" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
            <Toggle label="Izinkan Google Search" hint="Hanya host pencarian (www.google.com, google.co.id). Gmail/Drive/Photos/Gemini TIDAK termasuk." checked={!fullLock && f.googleSearch} disabled={fullLock} onChange={(v) => setF({ ...f, googleSearch: v })} />
            <Toggle label="Paksa SafeSearch" hint="ForceGoogleSafeSearch (browser) + forcesafesearch.google.com (DNS)" checked={f.safeSearch} onChange={(v) => setF({ ...f, safeSearch: v })} />
            <Toggle label="Sertakan daftar izin situs pembelajaran global" hint="Untuk LEARNING MODE — dikelola di Daftar Situs" checked={f.includeGlobalAllowlist} disabled={fullLock} onChange={(v) => setF({ ...f, includeGlobalAllowlist: v })} />
            <Toggle label="Penegakan IP (blokir akses IP langsung)" hint="Firewall hanya meneruskan IP hasil resolusi domain terizinkan (dnsmasq nftset). Lebih ketat; dapat mengganggu situs ber-CDN." checked={fullLock || f.ipEnforcement} disabled={fullLock} onChange={(v) => setF({ ...f, ipEnforcement: v })} />
          </div>
          <div>
            <p className="label">Kategori diblokir</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(cats.data?.items ?? []).map((c: any) => {
                const locked = c.core && !can('policies.core');
                return (
                  <label key={c.id} className={cx('flex items-start gap-2 rounded-lg border p-2.5 text-sm', f.blockedCategoryIds.includes(c.id) || c.core ? 'border-red-200 bg-red-50/40' : 'border-slate-200')}>
                    <input type="checkbox" className="mt-0.5" disabled={locked || c.core} checked={c.core || f.blockedCategoryIds.includes(c.id)} onChange={() => toggleArr('blockedCategoryIds', c.id)} />
                    <span><span className="font-medium">{c.name}</span> {c.core && <Badge tone="red"><Lock className="h-3 w-3" />Inti</Badge>}<span className="block text-xs text-slate-500">{c.domainCount} domain</span></span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-500">Kategori inti (keamanan) selalu diblokir pada semua profil dan hanya dapat diubah Super Admin.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Domain diizinkan" hint="Satu per baris, termasuk subdomain"><Textarea rows={5} className="mono" value={f.allowedDomains} disabled={fullLock} onChange={(e) => setF({ ...f, allowedDomains: e.target.value })} placeholder="kemdikbud.go.id" /></Field>
            <Field label="Domain diblokir"><Textarea rows={5} className="mono" value={f.blockedDomains} onChange={(e) => setF({ ...f, blockedDomains: e.target.value })} placeholder="contoh.com" /></Field>
            <Field label="URL diizinkan (browser)" hint="Format filter Chrome: host/path"><Textarea rows={4} className="mono" value={f.allowedUrls} disabled={fullLock} onChange={(e) => setF({ ...f, allowedUrls: e.target.value })} placeholder="www.wikipedia.org/wiki" /></Field>
            <Field label="URL diblokir (browser)"><Textarea rows={4} className="mono" value={f.blockedUrls} onChange={(e) => setF({ ...f, blockedUrls: e.target.value })} placeholder=".www.google.com/maps" /></Field>
          </div>
          <div className="rounded-lg bg-soft-50 p-3 text-xs text-navy-700"><b>Catatan teknis:</b> aturan <i>URL</i> (path) hanya ditegakkan oleh kebijakan browser terkelola (Chrome/Edge). Lapisan DNS hanya melihat nama domain dan tidak dapat memfilter path.</div>
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <Toggle label="Jadwal penerapan" hint="Informasi jadwal profil; penerapan aktual mengikuti sesi pembelajaran & default lab" checked={f.scheduleOn} onChange={(v) => setF({ ...f, scheduleOn: v })} />
            {f.scheduleOn && <div className="flex flex-wrap items-end gap-2">
              {DAYS.map((d, i) => <button key={d} type="button" onClick={() => toggleArr('days', i)} className={cx('rounded-md px-2.5 py-1 text-xs font-semibold', f.days.includes(i) ? 'bg-navy-700 text-white' : 'bg-slate-100 text-slate-600')}>{d}</button>)}
              <Input type="time" className="w-28" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /><Input type="time" className="w-28" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            </div>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="label">Laboratorium sasaran</p><div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">{labs.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.targetLabIds.includes(l.id)} onChange={() => toggleArr('targetLabIds', l.id)} />{l.name}</label>)}{!labs.length && <p className="text-xs text-slate-400">Belum ada lab</p>}</div></div>
            <div><p className="label">Kelas sasaran</p><div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">{classes.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.targetClassIds.includes(c.id)} onChange={() => toggleArr('targetClassIds', c.id)} />{c.name}</label>)}{!classes.length && <p className="text-xs text-slate-400">Belum ada kelas</p>}</div></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PolicyInspector({ policy, onClose }: { policy: any; onClose: () => void }) {
  const [tab, setTab] = useState<'compiled' | 'test' | 'download'>('test');
  const { labs } = useLookups();
  const [labId, setLabId] = useState('');
  const compiled = useGet<any>(`/policies/${policy.id}/compiled${labId ? `?labId=${labId}` : ''}`);
  const [inputs, setInputs] = useState(DEFAULT_TESTS.join('\n'));
  const evaluate = useAction((list: string[]) => api(`/policies/${policy.id}/evaluate`, { body: { inputs: list } }));
  const c = compiled.data;
  return (
    <Modal open onClose={onClose} size="xl" title={`${policy.name} — kompilasi, uji & generator`}>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'test', label: 'Uji keputusan' }, { key: 'compiled', label: 'Hasil kompilasi' }, { key: 'download', label: 'Generator Chrome policy' }]} />
      {tab === 'test' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div><Field label="URL / domain yang diuji" hint="Satu per baris"><Textarea rows={14} className="mono" value={inputs} onChange={(e) => setInputs(e.target.value)} /></Field>
            <Button className="mt-2 w-full" icon={<FlaskConical className="h-4 w-4" />} loading={evaluate.isPending} onClick={() => evaluate.mutate(lines(inputs))}>Jalankan uji</Button></div>
          <div>
            {!evaluate.data ? <Empty title="Belum ada hasil" message="Uji memisahkan lapisan DNS (domain) dan lapisan browser (URL+path) karena keduanya mekanisme berbeda." /> : (
              <>
                <Table head={['Input', 'DNS (domain)', 'Browser (URL)', 'Filter cocok']}>
                  {evaluate.data.results.map((r: any) => (
                    <tr key={r.input}><td className="td mono max-w-[260px] break-all">{r.input}</td><td className="td"><StatusBadge status={r.dns?.decision} /><div className="text-[11px] text-slate-500">{r.dns?.layer}</div></td><td className="td"><StatusBadge status={r.browser.decision} /></td><td className="td mono text-[11px] text-slate-500">{r.browser.matchedFilter ?? '—'}</td></tr>
                  ))}
                </Table>
                <p className="mt-2 text-xs text-slate-500">{evaluate.data.note}</p>
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'compiled' && (
        <div className="space-y-4">
          <Select className="sm:w-72" value={labId} onChange={(e) => setLabId(e.target.value)}><option value="">Tanpa pengecualian lab</option>{labs.map((l) => <option key={l.id} value={l.id}>Dengan pengecualian aktif: {l.name}</option>)}</Select>
          {compiled.isLoading ? <Loading /> : compiled.error ? <ErrorState error={compiled.error} /> : c && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                {[['Inti (CORE)', c.layers.core, 'red'], ['Administrator', c.layers.admin, 'amber'], ['Sesi/profil', c.layers.session, 'blue'], ['Pengecualian', c.layers.exception, 'green']].map(([k, v, t]: any) => <div key={k} className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{k}</p><p className="text-xl font-extrabold">{v}</p><Badge tone={t}>prioritas</Badge></div>)}
              </div>
              {!!c.warnings.length && <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{c.warnings.map((w: string) => <li key={w}>• {w}</li>)}</ul>}
              <div className="grid gap-4 lg:grid-cols-3">
                <div><p className="label">DNS diizinkan ({c.dns.allow.length})</p><pre className="mono max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-emerald-300">{c.dns.allow.join('\n') || '(kosong — default deny)'}</pre></div>
                <div><p className="label">Browser URLAllowlist ({c.browser.URLAllowlist.length})</p><pre className="mono max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-emerald-300">{c.browser.URLAllowlist.join('\n')}</pre></div>
                <div><p className="label">Browser URLBlocklist ({c.browser.URLBlocklist.length})</p><pre className="mono max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-red-300">{c.browser.URLBlocklist.slice(0, 300).join('\n')}</pre></div>
              </div>
              <div><p className="label">Firewall</p><div className="flex flex-wrap gap-2">{Object.entries(c.firewall).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => <Badge key={k} tone={v ? 'green' : 'slate'}>{k}: {v ? 'ya' : 'tidak'}</Badge>)}</div></div>
            </>
          )}
        </div>
      )}
      {tab === 'download' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Kebijakan browser dihasilkan terpisah dari kebijakan DNS. Berisi <span className="mono">URLBlocklist ["*"]</span>, <span className="mono">URLAllowlist</span> host/path Google Search, <span className="mono">ForceGoogleSafeSearch</span>, pembatasan mode Incognito/Guest, DevTools, ekstensi, DoH, dan proxy. Untuk sinkronisasi otomatis, gunakan installer per-perangkat dari menu Perangkat.</p>
          <Select className="sm:w-72" value={labId} onChange={(e) => setLabId(e.target.value)}><option value="">Profil saja</option>{labs.map((l) => <option key={l.id} value={l.id}>Versi efektif lab: {l.name}</option>)}</Select>
          <div className="grid gap-3 sm:grid-cols-2">
            {[['windows-ps1', 'Windows — PowerShell installer (.ps1)'], ['windows-reg', 'Windows — Registry policy (.reg)'], ['linux-sh', 'Linux — installer (.sh)'], ['linux-json', 'Linux — JSON managed policy']].map(([fmt, label]) => (
              <Button key={fmt} variant="outline" className="justify-start" icon={<Download className="h-4 w-4" />} onClick={() => download(`/policies/${policy.id}/browser-policy?format=${fmt}${labId ? `&labId=${labId}` : ''}`, `labguard.${fmt}`)}>{label}</Button>
            ))}
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b>Verifikasi:</b> buka <span className="mono">chrome://policy</span> → klik <i>Reload policies</i> → pastikan URLBlocklist, URLAllowlist, ForceGoogleSafeSearch berstatus OK. Panduan lengkap: <span className="mono">docs/browser-policy-setup.md</span>.</div>
        </div>
      )}
    </Modal>
  );
}

function GoogleDiagnostics({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const analyze = useAction((t: string) => api('/policies/google-diagnostics/analyze', { body: { text: t } }), { onSuccess: () => setPicked([]) });
  const add = useAction((hosts: string[]) => api('/policies/google-diagnostics/add', { body: { hosts } }), { success: 'Resource ditambahkan & penerapan dibuat', invalidate: ['/policies'], onSuccess: onClose });
  return (
    <Modal open onClose={onClose} size="lg" title="Diagnostik resource Google Search" footer={<><Button variant="outline" onClick={onClose}>Tutup</Button>{can('policies.manage') && <Button disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate(picked)}>Tambahkan {picked.length} host terpilih</Button>}</>}>
      <p className="mb-3 text-sm text-slate-600">Jika halaman pencarian tidak termuat sempurna di perangkat terkelola, buka DevTools (oleh admin) atau <span className="mono">chrome://net-export</span>, salin URL/host yang gagal (mis. <span className="mono">ERR_NAME_NOT_RESOLVED</span>, <span className="mono">ERR_BLOCKED_BY_ADMINISTRATOR</span>) lalu tempel di sini. Sistem hanya mengizinkan host <i>resource</i> milik Google dan menolak host aplikasi (Gmail, Drive, Photos, Gemini, YouTube…).</p>
      <Textarea rows={6} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://encrypted-tbn0.gstatic.com/images?q=… net::ERR_NAME_NOT_RESOLVED" />
      <Button className="mt-2" variant="secondary" icon={<Stethoscope className="h-4 w-4" />} loading={analyze.isPending} onClick={() => analyze.mutate(text)}>Analisis</Button>
      {analyze.data && <div className="mt-4"><Table head={['', 'Host', 'Rekomendasi']}>
        {analyze.data.results.map((r: any) => (
          <tr key={r.host}><td className="td w-8"><input type="checkbox" disabled={r.recommendation !== 'BOLEH_DITAMBAHKAN'} checked={picked.includes(r.host)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.host] : picked.filter((x) => x !== r.host))} /></td>
            <td className="td mono">{r.host}</td><td className="td"><Badge tone={r.recommendation === 'BOLEH_DITAMBAHKAN' ? 'green' : r.recommendation === 'SUDAH_DIIZINKAN' ? 'blue' : 'red'}>{r.recommendation.replace(/_/g, ' ')}</Badge></td></tr>
        ))}</Table></div>}
    </Modal>
  );
}

export default function Policies() {
  const { can } = useAuth();
  const list = useList<any>('/policies');
  const deps = useList<any>('/deployments?limit=10', { refetchInterval: 20_000 });
  const gws = useList<any>('/gateways');
  const [edit, setEdit] = useState<any | null>(null);
  const [inspect, setInspect] = useState<any | null>(null);
  const [diag, setDiag] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const remove = useAction((id: string) => api(`/policies/${id}`, { method: 'DELETE' }), { success: 'Profil dihapus', invalidate: ['/policies'], onSuccess: () => setDel(null) });
  const dup = useAction((id: string) => api(`/policies/${id}/duplicate`, { body: {} }), { success: 'Profil diduplikasi', invalidate: ['/policies'] });
  const gwName = useMemo(() => (id: string | null) => gws.data?.items.find((g: any) => g.id === id)?.name ?? '(tanpa gateway)', [gws.data]);

  return (
    <>
      <PageHeader title="Kebijakan Internet" subtitle="DEFAULT DENY — semua situs ditolak kecuali diizinkan. Prioritas: Inti › Administrator › Sesi › Pengecualian." icon={<ShieldCheck className="h-5 w-5" />}
        actions={<><Button variant="outline" icon={<Stethoscope className="h-4 w-4" />} onClick={() => setDiag(true)}>Diagnostik Google</Button>{can('policies.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>Profil custom</Button>}</>} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data!.items.map((p) => (
            <div key={p.id} className={cx('card flex flex-col p-5', !p.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3"><div className={cx('flex h-10 w-10 items-center justify-center rounded-xl', p.type === 'FULL_LOCK' ? 'bg-red-50 text-red-600' : p.type === 'LEARNING' ? 'bg-emerald-50 text-emerald-600' : 'bg-soft-100 text-navy-600')}>{p.type === 'GOOGLE_SEARCH_ONLY' ? <Search className="h-5 w-5" /> : p.type === 'FULL_LOCK' ? <Lock className="h-5 w-5" /> : <Layers className="h-5 w-5" />}</div>
                  <div><p className="font-bold text-navy-900">{p.name}</p><div className="mt-0.5 flex gap-1"><Badge tone={TYPE_TONE[p.type]}>{p.type.replace(/_/g, ' ')}</Badge>{p.builtin && <Badge>Bawaan</Badge>}{!p.active && <Badge tone="slate">Nonaktif</Badge>}</div></div></div>
                <span className="text-[11px] text-slate-400">rev {p.revision}</span>
              </div>
              <p className="mt-3 flex-1 text-sm text-slate-600">{p.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <Badge tone={p.googleSearch ? 'blue' : 'slate'}>Google Search {p.googleSearch ? 'ya' : 'tidak'}</Badge>
                <Badge tone={p.safeSearch ? 'green' : 'slate'}>SafeSearch</Badge>
                <Badge>{p.blockedCategoryIds.length} kategori diblokir</Badge>
                {p.ipEnforcement && <Badge tone="amber">Penegakan IP</Badge>}
              </div>
              <p className="mt-2 text-xs text-slate-500">Dipakai: {p.usedByLabs.length ? p.usedByLabs.map((l: any) => l.name).join(', ') : 'belum ada lab'}</p>
              <div className="mt-4 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
                <Button size="sm" variant="secondary" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setInspect(p)}>Uji & generator</Button>
                {can('policies.manage') && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(p)}>Edit aturan</Button>}
                {can('policies.manage') && <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => dup.mutate(p.id)}>Duplikat</Button>}
                {can('policies.manage') && !p.builtin && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(p)}>Hapus</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Card className="mt-5" title="Status penerapan kebijakan" subtitle="'Terkonfirmasi' hanya setelah gateway agent melaporkan sukses. DEMO = divalidasi tanpa perubahan jaringan.">
        {deps.isLoading ? <Loading /> : !deps.data?.items.length ? <Empty title="Belum ada penerapan" /> : (
          <Table head={['Waktu', 'Gateway', 'Versi', 'Alasan', 'Status', 'Dikonfirmasi', 'Error']}>
            {deps.data.items.map((d: any) => <tr key={d.id}><td className="td whitespace-nowrap">{fmtDateTime(d.createdAt)}</td><td className="td">{gwName(d.gatewayId)}</td><td className="td mono">v{d.version}</td><td className="td mono text-xs">{d.reason}</td><td className="td"><StatusBadge status={d.status} /></td><td className="td whitespace-nowrap">{fmtDateTime(d.confirmedAt)}</td><td className="td max-w-xs truncate text-xs text-red-600">{d.error ?? ''}</td></tr>)}
          </Table>
        )}
      </Card>
      {edit && <PolicyEditor policy={edit} onClose={() => setEdit(null)} />}
      {inspect && <PolicyInspector policy={inspect} onClose={() => setInspect(null)} />}
      {diag && <GoogleDiagnostics onClose={() => setDiag(false)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger loading={remove.isPending} title="Hapus profil?" message={<>Profil <b>{del?.name}</b> akan dihapus.</>} confirmLabel="Hapus" onConfirm={() => remove.mutate(del.id)} />
    </>
  );
}
