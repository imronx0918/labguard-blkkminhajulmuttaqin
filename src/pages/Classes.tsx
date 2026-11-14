import { BookOpen, Download } from 'lucide-react';
import { ResourcePage } from '../components/ResourcePage';
import { Button } from '../components/ui';
import { useLookups } from '../lib/hooks';
import { api } from '../lib/api';
import { exportExcel } from '../lib/export';

export default function Classes() {
  const { labs, labName } = useLookups();
  return (
    <ResourcePage title="Data Kelas" subtitle="Kelas, wali kelas, dan pemetaan ke laboratorium yang biasa digunakan." icon={<BookOpen className="h-5 w-5" />}
      endpoint="/classes" managePerm="classes.manage" label="Kelas"
      toolbar={<Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={async () => { const r = await api('/classes?limit=200'); await exportExcel('data-kelas', 'Kelas', ['Nama kelas', 'Tingkat', 'Jurusan', 'Wali kelas', 'Jumlah peserta didik', 'Laboratorium'], r.items.map((c: any) => [c.name, c.grade, c.major, c.homeroomTeacher, c.studentCount, labName(c.defaultLabId)])); }}>Export Excel</Button>}
      fields={[
        { name: 'name', label: 'Nama kelas', required: true, placeholder: 'X TKJ 1' }, { name: 'grade', label: 'Tingkat', required: true, placeholder: 'X' },
        { name: 'major', label: 'Jurusan' }, { name: 'homeroomTeacher', label: 'Wali kelas' },
        { name: 'defaultLabId', label: 'Laboratorium yang biasa digunakan', type: 'select', options: labs.map((l) => ({ value: l.id, label: l.name })), full: true },
      ]}
      columns={[
        { label: 'Nama kelas', render: (r) => <span className="font-semibold">{r.name}</span> }, { label: 'Tingkat', render: (r) => r.grade },
        { label: 'Jurusan', render: (r) => r.major || '—' }, { label: 'Wali kelas', render: (r) => r.homeroomTeacher || '—' },
        { label: 'Peserta didik', render: (r) => r.studentCount ?? 0 }, { label: 'Laboratorium', render: (r) => labName(r.defaultLabId) },
      ]}
    />
  );
}
