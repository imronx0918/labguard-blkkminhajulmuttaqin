import { useRef, useState } from 'react';
import { Download, GraduationCap, Upload } from 'lucide-react';
import { ResourcePage } from '../components/ResourcePage';
import { Badge, Button, Modal, Select } from '../components/ui';
import { useAction, useLookups } from '../lib/hooks';
import { api } from '../lib/api';
import { exportExcel, readExcel } from '../lib/export';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';

export default function Students() {
  const { classes, className } = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [result, setResult] = useState<any>(null);
  const file = useRef<HTMLInputElement>(null);
  const imp = useAction((rows: any[]) => api('/students/import', { body: { rows } }), { invalidate: ['/students', '/classes'], onSuccess: setResult });

  const doExport = async () => {
    const r = await api(`/students?limit=200${classId ? `&classId=${classId}` : ''}`);
    let items = r.items, cursor = r.nextCursor;
    while (cursor) { const n = await api(`/students?limit=200&cursor=${cursor}${classId ? `&classId=${classId}` : ''}`); items = items.concat(n.items); cursor = n.nextCursor; }
    await exportExcel(`peserta-didik-${new Date().toISOString().slice(0, 10)}`, 'Peserta Didik', ['NIS', 'Nama', 'Kelas', 'Jurusan', 'Status'], items.map((s: any) => [s.nis, s.name, className(s.classId), s.major, s.active ? 'Aktif' : 'Nonaktif']));
  };
  const template = () => exportExcel('template-import-peserta-didik', 'Template', ['NIS', 'Nama', 'Kelas', 'Jurusan', 'Status'], [['12345', 'Nama Peserta', classes[0]?.name ?? 'X TKJ 1', 'Teknik Komputer & Jaringan', 'Aktif']]);

  return (
    <>
      <ResourcePage
        title="Peserta Didik" subtitle="Data minimal: NIS, nama, kelas, jurusan, status. Tidak menyimpan kata sandi, isi layar, atau data sensitif." icon={<GraduationCap className="h-5 w-5" />}
        endpoint="/students" managePerm="students.manage" label="Peserta Didik" invalidate={['/classes']} query={classId ? `&classId=${classId}` : ''} defaults={{ active: true }}
        filters={<Select value={classId} onChange={(e) => setClassId(e.target.value)} className="sm:w-56"><option value="">Semua kelas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
        toolbar={<>
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => doExport().catch((e) => toast('error', 'Ekspor gagal', e.message))}>Export Excel</Button>
          {can('students.manage') && <><Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()} loading={imp.isPending}>Import Excel</Button>
            <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) imp.mutate(await readExcel(f)); }} /></>}
        </>}
        fields={[
          { name: 'nis', label: 'NIS', required: true }, { name: 'name', label: 'Nama', required: true },
          { name: 'classId', label: 'Kelas', type: 'select', required: true, options: classes.map((c) => ({ value: c.id, label: c.name })) },
          { name: 'major', label: 'Jurusan' }, { name: 'active', label: 'Status aktif', type: 'toggle', full: true },
        ]}
        columns={[
          { label: 'NIS', render: (r) => <span className="mono">{r.nis}</span> }, { label: 'Nama', render: (r) => <span className="font-medium">{r.name}</span> },
          { label: 'Kelas', render: (r) => className(r.classId) }, { label: 'Jurusan', render: (r) => r.major || '—' },
          { label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Aktif' : 'Nonaktif'}</Badge> },
        ]}
      />
      {can('students.manage') && <p className="mt-3 text-xs text-slate-500">Format import: kolom <b>NIS, Nama, Kelas, Jurusan, Status</b> (nama kelas harus sudah terdaftar). <button className="font-semibold text-navy-600 hover:underline" onClick={template}>Unduh template</button></p>}
      <Modal open={!!result} onClose={() => setResult(null)} title="Hasil import" footer={<Button onClick={() => setResult(null)}>Tutup</Button>}>
        {result && <div className="space-y-2 text-sm"><p>Ditambahkan: <b>{result.created}</b> · Diperbarui: <b>{result.updated}</b> · Gagal: <b className="text-red-600">{result.errors.length}</b></p>
          {!!result.errors.length && <ul className="max-h-60 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-700">{result.errors.map((e: any, i: number) => <li key={i}>Baris {e.row}: {e.message}</li>)}</ul>}</div>}
      </Modal>
    </>
  );
}
