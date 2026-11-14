import { useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useList } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import type { Permission } from '../../shared/roles';
import { Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, Loading, Modal, PageHeader, SearchInput, Select, Table, Toggle, DemoTag } from './ui';

export interface FieldDef { name: string; label: string; type?: 'text' | 'number' | 'select' | 'toggle'; options?: { value: string; label: string }[]; required?: boolean; hint?: string; placeholder?: string; full?: boolean }
export interface ColDef { label: string; render: (row: any) => ReactNode }

/** Halaman CRUD generik (tabel, cari, filter, modal tambah/edit, konfirmasi hapus). */
export function ResourcePage(p: {
  title: string; subtitle: string; icon: ReactNode; endpoint: string; managePerm: Permission; fields: FieldDef[]; columns: ColDef[];
  filters?: ReactNode; query?: string; toolbar?: ReactNode; rowActions?: (row: any) => ReactNode; defaults?: Record<string, any>; label: string; invalidate?: string[];
}) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const list = useList<any>(`${p.endpoint}?limit=200${p.query ?? ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const canManage = can(p.managePerm);
  const inv = [p.endpoint, ...(p.invalidate ?? [])];
  const save = useAction((f: any) => (edit?.id ? api(`${p.endpoint}/${edit.id}`, { method: 'PUT', body: f }) : api(p.endpoint, { body: f })), { success: `${p.label} disimpan`, invalidate: inv, onSuccess: () => setEdit(null) });
  const remove = useAction((id: string) => api(`${p.endpoint}/${id}`, { method: 'DELETE' }), { success: `${p.label} dihapus`, invalidate: inv, onSuccess: () => setDel(null) });

  const open = (row?: any) => {
    const init: Record<string, any> = { ...(p.defaults ?? {}) };
    for (const f of p.fields) init[f.name] = row?.[f.name] ?? init[f.name] ?? (f.type === 'toggle' ? true : f.type === 'number' ? 0 : '');
    setForm(init);
    setEdit(row ?? {});
  };
  const submit = () => {
    const body: Record<string, any> = {};
    for (const f of p.fields) body[f.name] = f.type === 'number' ? Number(form[f.name]) : form[f.name];
    save.mutate(body);
  };

  return (
    <>
      <PageHeader title={p.title} subtitle={p.subtitle} icon={p.icon} actions={<>{p.toolbar}{canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => open()}>Tambah {p.label}</Button>}</>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3"><SearchInput value={q} onChange={setQ} />{p.filters}</div>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
          <Empty title={`Belum ada ${p.label.toLowerCase()}`} action={canManage && <Button size="sm" onClick={() => open()}>Tambah {p.label}</Button>} />
        ) : (
          <Table head={[...p.columns.map((c) => c.label), '']}>
            {list.data.items.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/60">
                {p.columns.map((c, i) => <td key={i} className="td">{i === 0 ? <span className="flex items-center gap-2">{c.render(row)}{row.demo && <DemoTag />}</span> : c.render(row)}</td>)}
                <td className="td text-right"><div className="flex justify-end gap-1">
                  {p.rowActions?.(row)}
                  {canManage && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => open(row)}>Edit</Button>}
                  {canManage && <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(row)}>Hapus</Button>}
                </div></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${p.label}` : `Tambah ${p.label}`} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Batal</Button><Button onClick={submit} loading={save.isPending}>Simpan</Button></>}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {p.fields.map((f) => (
            <div key={f.name} className={f.full ? 'sm:col-span-2' : ''}>
              {f.type === 'toggle' ? <Toggle label={f.label} checked={!!form[f.name]} onChange={(v) => setForm({ ...form, [f.name]: v })} hint={f.hint} /> : (
                <Field label={f.label + (f.required ? ' *' : '')} hint={f.hint}>
                  {f.type === 'select' ? (
                    <Select value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} required={f.required}>
                      <option value="">— Pilih —</option>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  ) : <Input type={f.type === 'number' ? 'number' : 'text'} value={form[f.name] ?? ''} placeholder={f.placeholder} required={f.required} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />}
                </Field>
              )}
            </div>
          ))}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate(del.id)} loading={remove.isPending} danger title={`Hapus ${p.label}?`} message={<>Data <b>{del?.name ?? del?.nis}</b> akan dihapus permanen. Tindakan ini dicatat di audit log.</>} confirmLabel="Hapus" />
    </>
  );
}
