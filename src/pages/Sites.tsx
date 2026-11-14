import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Globe2, ListPlus, Lock, Plus, Send, Trash2, X, Ban, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, DemoTag, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, SearchInput, Select, StatusBadge, Table, Tabs, Textarea, Toggle } from '../components/ui';
import { fmtDateTime, todayJakarta } from '../lib/format';

type Tab = 'blocked' | 'allowed' | 'categories' | 'requests';

function RequestsTab() {
  const { can, me } = useAuth();
  const { labs, classes, className, labName } = useLookups();
  const [status, setStatus] = useState('PENDING');
  const list = useList<any>(`/permission-requests?limit=100${status ? `&status=${status}` : ''}`, { refetchInterval: 30_000 });
  const [form, setForm] = useState<any | null>(null);
  const [review, setReview] = useState<{ row: any; kind: 'approve' | 'reject' } | null>(null);
  const [rv, setRv] = useState<any>({});
  const [revoke, setRevoke] = useState<any | null>(null);
  const inv = ['/permission-requests', '/sites', '/deployments'];
  const create = useAction((b: any) => api('/permission-requests', { body: b }), { success: 'Permintaan dikirim — menunggu persetujuan admin', invalidate: inv, onSuccess: () => setForm(null) });
  const decide = useAction(({ id, kind, body }: any) => api(`/permission-requests/${id}/${kind}`, { body }), { success: (r: any) => (r.status === 'APPROVED' ? `Disetujui — berlaku ${r.date} ${r.startTime}–${r.endTime} WIB, kedaluwarsa otomatis` : 'Permintaan ditolak'), invalidate: inv, onSuccess: () => setReview(null) });
  const doRevoke = useAction((id: string) => api(`/permission-requests/${id}/revoke`, { body: {} }), { success: 'Akses dicabut', invalidate: inv, onSuccess: () => setRevoke(null) });
  const blank = { siteName: '', url: '', reason: '', subject: '', classId: '', labId: '', date: todayJakarta(), startTime: '07:00', endTime: '08:30' };

  return (
    <Card title="Permintaan izin website" subtitle="Izin sementara berlaku hanya pada periode yang disetujui dan kedaluwarsa otomatis. Semua keputusan dicatat di audit log."
      actions={<><Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua status</option>{['PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>{can('permissionRequests.create') && <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setForm(blank)}>Ajukan izin</Button>}</>}>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? <Empty title="Tidak ada permintaan" /> : (
        <Table head={['Website', 'Pemohon', 'Mapel / Kelas', 'Periode (WIB)', 'Alasan', 'Status', '']}>
          {list.data.items.map((r: any) => (
            <tr key={r.id}>
              <td className="td"><div className="flex items-center gap-2 font-semibold">{r.siteName}{r.demo && <DemoTag />}</div><div className="mono text-slate-500">{r.domain}</div>{r.blockedBy && <Badge tone={r.blockedBy.startsWith('CORE') ? 'red' : 'amber'}>Diblokir {r.blockedBy}</Badge>}</td>
              <td className="td">{r.requestedByName}<div className="text-xs text-slate-400">{fmtDateTime(r.createdAt)}</div></td>
              <td className="td">{r.subject}<div className="text-xs text-slate-500">{className(r.classId)} · {labName(r.labId)}</div></td>
              <td className="td whitespace-nowrap">{r.date}<div className="text-xs text-slate-500">{r.startTime}–{r.endTime}</div></td>
              <td className="td max-w-xs text-xs text-slate-600">{r.reason}{r.reviewNote && <div className="mt-1 text-slate-400">Catatan: {r.reviewNote}</div>}</td>
              <td className="td"><StatusBadge status={r.status} />{r.reviewedByName && <div className="text-[11px] text-slate-400">oleh {r.reviewedByName}</div>}</td>
              <td className="td"><div className="flex justify-end gap-1">
                {can('permissionRequests.review') && r.status === 'PENDING' && <>
                  <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => { setRv({ date: r.date, startTime: r.startTime, endTime: r.endTime, note: '', overrideAdminBlock: false, coreOverride: false }); setReview({ row: r, kind: 'approve' }); }}>Setujui</Button>
                  <Button size="sm" variant="outline" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setRv({ note: '' }); setReview({ row: r, kind: 'reject' }); }}>Tolak</Button></>}
                {can('permissionRequests.review') && r.status === 'APPROVED' && <Button size="sm" variant="ghost" className="text-red-600" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setRevoke(r)}>Cabut</Button>}
              </div></td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Ajukan izin membuka website" size="lg" footer={<><Button variant="outline" onClick={() => setForm(null)}>Batal</Button><Button loading={create.isPending} onClick={() => create.mutate(form)}>Kirim permintaan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama website *"><Input value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} placeholder="GeoGebra" /></Field>
          <Field label="URL *"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://www.geogebra.org" /></Field>
          <Field label="Mata pelajaran *"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Kelas *"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">— Pilih —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Laboratorium *"><Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}><option value="">— Pilih —</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Tanggal *"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Jam mulai (WIB) *"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
          <Field label="Jam selesai (WIB) *"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
          <Field label="Alasan pembelajaran *" className="sm:col-span-2"><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Diajukan oleh <b>{me?.name}</b>. Izin hanya berlaku pada periode di atas, terbatas pada lab yang dipilih, dan dihapus otomatis saat sesi berakhir/kedaluwarsa.</p>
        </div>}
      </Modal>
      <Modal open={!!review} onClose={() => setReview(null)} title={review?.kind === 'approve' ? `Setujui ${review?.row.domain}` : `Tolak ${review?.row.domain}`} footer={<><Button variant="outline" onClick={() => setReview(null)}>Batal</Button><Button variant={review?.kind === 'approve' ? 'success' : 'danger'} loading={decide.isPending} onClick={() => decide.mutate({ id: review!.row.id, kind: review!.kind, body: rv })}>{review?.kind === 'approve' ? 'Setujui' : 'Tolak'}</Button></>}>
        {review?.kind === 'approve' ? <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={rv.date} onChange={(e) => setRv({ ...rv, date: e.target.value })} /></Field>
          <Field label="Mulai"><Input type="time" value={rv.startTime} onChange={(e) => setRv({ ...rv, startTime: e.target.value })} /></Field>
          <Field label="Selesai"><Input type="time" value={rv.endTime} onChange={(e) => setRv({ ...rv, endTime: e.target.value })} /></Field>
          <Field label="Catatan / alasan" className="sm:col-span-3"><Textarea value={rv.note} onChange={(e) => setRv({ ...rv, note: e.target.value })} /></Field>
          {review.row.blockedBy?.startsWith('ADMIN') && <div className="sm:col-span-3"><Toggle label="Override blokir administrator (sementara)" hint={`Domain termasuk ${review.row.blockedBy}. Hanya berlaku pada periode ini.`} checked={rv.overrideAdminBlock} onChange={(v) => setRv({ ...rv, overrideAdminBlock: v })} /></div>}
          {review.row.blockedBy?.startsWith('CORE') && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:col-span-3"><Lock className="mr-1 inline h-4 w-4" />Domain termasuk <b>kebijakan keamanan inti</b>. {can('permissionRequests.coreOverride') ? <Toggle label="Saya (Super Admin) mengotorisasi override inti sementara" checked={rv.coreOverride} onChange={(v) => setRv({ ...rv, coreOverride: v })} /> : 'Hanya Super Admin yang dapat menyetujui.'}</div>}
        </div> : <Field label="Alasan penolakan *"><Textarea value={rv.note} onChange={(e) => setRv({ ...rv, note: e.target.value })} /></Field>}
      </Modal>
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} danger loading={doRevoke.isPending} title="Cabut akses?" message={<>Akses sementara ke <b>{revoke?.domain}</b> akan dicabut dan gateway menerima kebijakan baru.</>} onConfirm={() => doRevoke.mutate(revoke.id)} />
    </Card>
  );
}

export default function Sites() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'blocked';
  const setTab = (t: Tab) => setSp({ tab: t });
  const cats = useList<any>('/sites/categories');
  const [catId, setCatId] = useState('');
  const [q, setQ] = useState('');
  const blocked = useList<any>(`/sites/blocked?limit=200${catId ? `&categoryId=${catId}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { enabled: tab === 'blocked' });
  const allowed = useList<any>('/sites/allowed?limit=200&temporary=false', { enabled: tab === 'allowed' });
  const temps = useList<any>('/sites/allowed?limit=200&temporary=true', { enabled: tab === 'allowed' });
  const { labName } = useLookups();
  const { labs } = useLookups();
  const [bulk, setBulk] = useState<any | null>(null);
  const [allowForm, setAllowForm] = useState<any | null>(null);
  const [catForm, setCatForm] = useState<any | null>(null);
  const [del, setDel] = useState<{ url: string; label: string } | null>(null);
  const catName = (id: string) => cats.data?.items.find((c: any) => c.id === id)?.name ?? '—';
  const catCore = (id: string) => !!cats.data?.items.find((c: any) => c.id === id)?.core;
  const inv = ['/sites', '/policies', '/deployments'];
  const addBulk = useAction((b: any) => api('/sites/blocked/bulk', { body: b }), { success: (r: any) => `${r.added.length} ditambahkan, ${r.skipped.length} sudah ada, ${r.invalid.length} tidak valid`, invalidate: inv, onSuccess: () => setBulk(null) });
  const addAllow = useAction((b: any) => api('/sites/allowed', { body: b }), { success: 'Ditambahkan ke daftar izin', invalidate: inv, onSuccess: () => setAllowForm(null) });
  const saveCat = useAction((b: any) => (b.id ? api(`/sites/categories/${b.id}`, { method: 'PUT', body: { name: b.name, description: b.description, enabled: b.enabled } }) : api('/sites/categories', { body: b })), { success: 'Kategori disimpan', invalidate: inv, onSuccess: () => setCatForm(null) });
  const remove = useAction((url: string) => api(url, { method: 'DELETE' }), { success: 'Dihapus', invalidate: inv, onSuccess: () => setDel(null) });

  return (
    <>
      <PageHeader title="Daftar Situs" subtitle="Daftar blokir mendukung subdomain, domain redirect, dan CDN. Google Search tidak diblokir; layanan Google lain dikelompokkan terpisah." icon={<Globe2 className="h-5 w-5" />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'blocked', label: 'Domain diblokir' }, { key: 'allowed', label: 'Daftar izin' }, { key: 'categories', label: 'Kategori', count: cats.data?.items.length }, { key: 'requests', label: 'Permintaan izin' }]} />
      {tab === 'blocked' && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Cari domain…" />
            <Select className="sm:w-60" value={catId} onChange={(e) => setCatId(e.target.value)}><option value="">Semua kategori</option>{cats.data?.items.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            {can('sites.manage') && <Button className="ml-auto" icon={<ListPlus className="h-4 w-4" />} onClick={() => setBulk({ categoryId: catId || '', text: '' })}>Tambah domain</Button>}
          </div>
          {blocked.isLoading ? <Loading /> : blocked.error ? <ErrorState error={blocked.error} /> : !blocked.data?.items.length ? <Empty title="Tidak ada domain" /> : (
            <Table head={['Domain', 'Kategori', 'Subdomain', 'Ditambahkan', '']}>
              {blocked.data.items.map((d: any) => (
                <tr key={d.id}><td className="td mono font-medium">{d.domain}</td><td className="td">{catName(d.categoryId)} {(d.core || catCore(d.categoryId)) && <Badge tone="red"><Lock className="h-3 w-3" />Inti</Badge>}</td><td className="td">{d.includeSubdomains ? <Badge tone="blue">*.{d.domain}</Badge> : 'Tidak'}</td><td className="td text-xs text-slate-500">{fmtDateTime(d.createdAt)}</td>
                  <td className="td text-right">{can('sites.manage') && (!catCore(d.categoryId) || can('sites.core')) && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel({ url: `/sites/blocked/${d.id}`, label: d.domain })}>Hapus</Button>}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === 'allowed' && (
        <div className="space-y-4">
          <Card title="Daftar izin situs pembelajaran" subtitle="Dipakai profil LEARNING MODE (global) atau per laboratorium." actions={can('sites.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAllowForm({ domain: '', note: '', scope: 'global', labIds: [] })}>Tambah</Button>}>
            {allowed.isLoading ? <Loading /> : !allowed.data?.items.length ? <Empty title="Daftar izin kosong" /> : (
              <Table head={['Domain', 'Cakupan', 'Catatan', '']}>
                {allowed.data.items.map((d: any) => <tr key={d.id}><td className="td mono font-medium">{d.domain}</td><td className="td">{d.scope === 'global' ? <Badge tone="blue">Global</Badge> : (d.labIds ?? []).map((l: string) => <Badge key={l}>{labName(l)}</Badge>)}</td><td className="td text-xs text-slate-500">{d.note}</td><td className="td text-right">{can('sites.manage') && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel({ url: `/sites/allowed/${d.id}`, label: d.domain })}>Hapus</Button>}</td></tr>)}
              </Table>
            )}
          </Card>
          <Card title="Pengecualian sementara aktif/terjadwal" subtitle="Dibuat dari permintaan izin yang disetujui; dihapus otomatis saat kedaluwarsa.">
            {!temps.data?.items.length ? <Empty title="Tidak ada pengecualian sementara" /> : (
              <Table head={['Domain', 'Lab', 'Berlaku', 'Kedaluwarsa', 'Override']}>
                {temps.data.items.map((d: any) => <tr key={d.id}><td className="td mono">{d.domain}</td><td className="td">{(d.labIds ?? []).map(labName).join(', ')}</td><td className="td">{fmtDateTime(d.validFrom)}</td><td className="td">{fmtDateTime(d.expiresAt)}</td><td className="td">{d.coreOverride ? <Badge tone="red">Inti</Badge> : d.overrideAdminBlock ? <Badge tone="amber">Admin</Badge> : '—'}</td></tr>)}
              </Table>
            )}
          </Card>
        </div>
      )}
      {tab === 'categories' && (
        <Card actions={can('sites.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCatForm({ name: '', slug: '', description: '', core: false, enabled: true })}>Kategori baru</Button>} title="Kategori situs">
          {cats.isLoading ? <Loading /> : (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {cats.data?.items.map((c: any) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2"><p className="font-semibold">{c.name}</p><div className="flex gap-1">{c.core && <Badge tone="red"><Lock className="h-3 w-3" />Inti</Badge>}<Badge tone={c.enabled ? 'green' : 'slate'}>{c.enabled ? 'Aktif' : 'Nonaktif'}</Badge></div></div>
                  <p className="mt-1 text-xs text-slate-500">{c.description}</p>
                  <div className="mt-3 flex items-center justify-between"><span className="text-sm"><b>{c.domainCount}</b> domain</span>
                    <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setCatId(c.id); setTab('blocked'); }}>Lihat</Button>{can('sites.manage') && (!c.core || can('sites.core')) && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setCatForm(c)}>Edit</Button>}</div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {tab === 'requests' && <RequestsTab />}

      <Modal open={!!bulk} onClose={() => setBulk(null)} title="Tambah domain ke daftar blokir" footer={<><Button variant="outline" onClick={() => setBulk(null)}>Batal</Button><Button loading={addBulk.isPending} onClick={() => addBulk.mutate({ categoryId: bulk.categoryId, domains: bulk.text.split(/[\s,]+/).filter(Boolean) })}>Tambahkan</Button></>}>
        {bulk && <div className="space-y-4">
          <Field label="Kategori *"><Select value={bulk.categoryId} onChange={(e) => setBulk({ ...bulk, categoryId: e.target.value })}><option value="">— Pilih —</option>{cats.data?.items.filter((c: any) => !c.core || can('sites.core')).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Domain" hint="Satu per baris atau dipisah koma. Subdomain otomatis tercakup. Tambahkan juga domain CDN/redirect bila layanan berganti domain."><Textarea rows={8} className="mono" value={bulk.text} onChange={(e) => setBulk({ ...bulk, text: e.target.value })} placeholder={'tiktokcdn-eu.com\nbytefcdn-oversea.com'} /></Field>
        </div>}
      </Modal>
      <Modal open={!!allowForm} onClose={() => setAllowForm(null)} title="Tambah ke daftar izin" footer={<><Button variant="outline" onClick={() => setAllowForm(null)}>Batal</Button><Button loading={addAllow.isPending} onClick={() => addAllow.mutate(allowForm)}>Simpan</Button></>}>
        {allowForm && <div className="space-y-4">
          <Field label="Domain *"><Input className="mono" value={allowForm.domain} onChange={(e) => setAllowForm({ ...allowForm, domain: e.target.value })} placeholder="rumahbelajar.id" /></Field>
          <Field label="Catatan"><Input value={allowForm.note} onChange={(e) => setAllowForm({ ...allowForm, note: e.target.value })} /></Field>
          <Field label="Cakupan"><Select value={allowForm.scope} onChange={(e) => setAllowForm({ ...allowForm, scope: e.target.value })}><option value="global">Global (profil yang menyertakan daftar izin)</option><option value="lab">Laboratorium tertentu</option></Select></Field>
          {allowForm.scope === 'lab' && <div className="space-y-1">{labs.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowForm.labIds.includes(l.id)} onChange={(e) => setAllowForm({ ...allowForm, labIds: e.target.checked ? [...allowForm.labIds, l.id] : allowForm.labIds.filter((x: string) => x !== l.id) })} />{l.name}</label>)}</div>}
        </div>}
      </Modal>
      <Modal open={!!catForm} onClose={() => setCatForm(null)} title={catForm?.id ? 'Edit kategori' : 'Kategori baru'} footer={<><Button variant="outline" onClick={() => setCatForm(null)}>Batal</Button><Button loading={saveCat.isPending} onClick={() => saveCat.mutate(catForm)}>Simpan</Button></>}>
        {catForm && <div className="space-y-4">
          <Field label="Nama *"><Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></Field>
          {!catForm.id && <Field label="Slug *" hint="huruf kecil, angka, tanda minus"><Input className="mono" value={catForm.slug} onChange={(e) => setCatForm({ ...catForm, slug: e.target.value })} /></Field>}
          <Field label="Deskripsi"><Textarea value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} /></Field>
          <Toggle label="Kategori aktif" checked={catForm.enabled} onChange={(v) => setCatForm({ ...catForm, enabled: v })} />
          {!catForm.id && can('sites.core') && <Toggle label="Kebijakan keamanan inti" hint="Selalu diblokir di semua profil; hanya Super Admin yang dapat mengubah" checked={catForm.core} onChange={(v) => setCatForm({ ...catForm, core: v })} />}
        </div>}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger loading={remove.isPending} title="Hapus domain?" message={<><b className="mono">{del?.label}</b> akan dihapus dan kebijakan baru dikirim ke gateway.</>} confirmLabel="Hapus" onConfirm={() => remove.mutate(del!.url)} />
    </>
  );
}
