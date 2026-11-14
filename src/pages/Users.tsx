import { useState } from 'react';
import { Pencil, Plus, Trash2, Users as UsersIcon, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useList, useLookups } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, ConfirmDialog, DemoTag, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Table, Toggle } from '../components/ui';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from '../../shared/roles';
import { fmtDateTime } from '../lib/format';

const ROLE_DESC: Record<string, string> = {
  super_admin: 'Akses penuh: pengguna, gateway, kebijakan inti, konfigurasi sistem, pemulihan.',
  lab_admin: 'Perangkat, sesi, kebijakan non-inti, log, pemeriksaan gateway, laporan.',
  teacher: 'Jadwal & sesi miliknya, memilih profil tersedia, mengajukan izin situs.',
  viewer: 'Hanya melihat dashboard, status komputer, laporan, riwayat sesi.',
};

export default function Users() {
  const { can, me, config } = useAuth();
  const { labs } = useLookups();
  const list = useList<any>('/users');
  const [form, setForm] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [matrix, setMatrix] = useState(false);
  const save = useAction((b: any) => (b.id ? api(`/users/${b.id}`, { method: 'PUT', body: { displayName: b.displayName, role: b.role, active: b.active, labIds: b.labIds } }) : api('/users', { body: b })), { success: 'Pengguna disimpan', invalidate: ['/users'], onSuccess: () => setForm(null) });
  const remove = useAction((id: string) => api(`/users/${id}`, { method: 'DELETE' }), { success: 'Pengguna dihapus', invalidate: ['/users'], onSuccess: () => setDel(null) });
  const manage = can('users.manage');
  return (
    <>
      <PageHeader title="Pengguna dan Hak Akses" subtitle="Peran diverifikasi di server untuk setiap permintaan API — menyembunyikan menu bukan pengaman." icon={<UsersIcon className="h-5 w-5" />}
        actions={<><Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setMatrix(true)}>Matriks hak akses</Button>{manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ email: '', displayName: '', role: 'teacher', labIds: [], password: '', active: true })}>Tambah pengguna</Button>}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{ROLES.map((r) => <div key={r} className="card p-4"><p className="font-bold text-navy-900">{ROLE_LABELS[r]}</p><p className="mt-1 text-xs text-slate-500">{ROLE_DESC[r]}</p><p className="mt-2 text-xl font-extrabold">{list.data?.items.filter((u) => u.role === r).length ?? 0}</p></div>)}</div>
      <Card>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : !list.data?.items.length ? <Empty /> : (
          <Table head={['Nama', 'Email', 'Peran', 'Lab dibatasi', 'Status', 'Login terakhir', '']}>
            {list.data.items.map((u) => (
              <tr key={u.id}><td className="td"><span className="flex items-center gap-2 font-semibold">{u.displayName}{u.demo && <DemoTag />}{u.id === me?.uid && <Badge tone="blue">Anda</Badge>}</span></td><td className="td">{u.email}</td><td className="td"><Badge tone={u.role === 'super_admin' ? 'navy' : u.role === 'lab_admin' ? 'blue' : 'slate'}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}</Badge></td>
                <td className="td text-xs">{u.labIds?.length ? u.labIds.map((l: string) => labs.find((x) => x.id === l)?.name ?? l).join(', ') : 'Semua'}</td><td className="td"><Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'Aktif' : 'Nonaktif'}</Badge></td><td className="td text-xs">{fmtDateTime(u.lastLoginAt)}</td>
                <td className="td text-right">{manage && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setForm({ ...u, labIds: u.labIds ?? [] })}>Edit</Button>{u.id !== me?.uid && u.role !== 'super_admin' && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(u)}>Hapus</Button>}</div>}</td></tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit pengguna' : 'Tambah pengguna'} footer={<><Button variant="outline" onClick={() => setForm(null)}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate(form.password ? form : { ...form, password: undefined })}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama *"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="Email *"><Input type="email" disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Peran *"><Select value={form.role} disabled={form.id === me?.uid} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.filter((r) => r !== 'super_admin' || me?.role === 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          {!form.id && config?.authMode === 'firebase' && <Field label="Kata sandi awal" hint="Min. 8 karakter; minta pengguna menggantinya"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
          {form.id && <div className="flex items-end"><Toggle label="Akun aktif" checked={form.active} disabled={form.id === me?.uid} onChange={(v) => setForm({ ...form, active: v })} /></div>}
          <div className="sm:col-span-2"><p className="label">Batasi ke laboratorium (opsional)</p><div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 p-3">{labs.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.labIds.includes(l.id)} onChange={(e) => setForm({ ...form, labIds: e.target.checked ? [...form.labIds, l.id] : form.labIds.filter((x: string) => x !== l.id) })} />{l.name}</label>)}{!labs.length && <span className="text-xs text-slate-400">Belum ada lab</span>}</div></div>
        </div>}
      </Modal>
      <Modal open={matrix} onClose={() => setMatrix(false)} title="Matriks hak akses (ditegakkan di backend)" size="xl">
        <Table head={['Izin', ...ROLES.map((r) => ROLE_LABELS[r])]}>
          {[...ROLE_PERMISSIONS.super_admin].map((p) => <tr key={p}><td className="td mono text-xs">{p}</td>{ROLES.map((r) => <td key={r} className="td text-center">{ROLE_PERMISSIONS[r].has(p) ? <span className="text-emerald-600">●</span> : <span className="text-slate-300">—</span>}</td>)}</tr>)}
        </Table>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger loading={remove.isPending} title="Hapus pengguna?" message={<>Akun <b>{del?.email}</b> akan dihapus dari aplikasi dan Firebase Authentication.</>} confirmLabel="Hapus" onConfirm={() => remove.mutate(del.id)} />
    </>
  );
}
