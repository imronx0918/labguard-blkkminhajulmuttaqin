import { Building2 } from 'lucide-react';
import { ResourcePage } from '../components/ResourcePage';
import { Badge, StatusBadge } from '../components/ui';
import { useList, useLookups } from '../lib/hooks';

export default function Laboratories() {
  const { policies, policyName } = useLookups();
  const gws = useList<any>('/gateways');
  const gwName = (id?: string) => gws.data?.items.find((g) => g.id === id)?.name;
  return (
    <ResourcePage title="Laboratorium" subtitle="Setiap lab memiliki subnet, gateway, dan profil kebijakan default." icon={<Building2 className="h-5 w-5" />}
      endpoint="/laboratories" managePerm="labs.manage" label="Laboratorium" invalidate={['/gateways', '/dashboard']}
      fields={[
        { name: 'name', label: 'Nama laboratorium', required: true }, { name: 'code', label: 'Kode', required: true, placeholder: 'LAB1' },
        { name: 'location', label: 'Lokasi' }, { name: 'capacity', label: 'Kapasitas komputer', type: 'number' },
        { name: 'subnet', label: 'Subnet jaringan (CIDR)', placeholder: '192.168.10.0/24', hint: 'Wajib untuk penerapan di gateway' },
        { name: 'gatewayId', label: 'Gateway', type: 'select', options: (gws.data?.items ?? []).map((g) => ({ value: g.id, label: g.name })) },
        { name: 'defaultPolicyId', label: 'Profil kebijakan default', type: 'select', options: policies.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })), full: true, hint: 'Dipakai di luar sesi pembelajaran. Bila kosong: GOOGLE SEARCH ONLY.' },
      ]}
      columns={[
        { label: 'Laboratorium', render: (r) => <span className="font-semibold">{r.name}</span> }, { label: 'Kode', render: (r) => <span className="mono">{r.code}</span> },
        { label: 'Subnet', render: (r) => r.subnet ? <span className="mono">{r.subnet}</span> : <StatusBadge status="NOT_CONFIGURED" /> },
        { label: 'Gateway', render: (r) => gwName(r.gatewayId) ?? <StatusBadge status="NOT_CONFIGURED" /> },
        { label: 'Kebijakan default', render: (r) => policyName(r.defaultPolicyId) },
        { label: 'Status', render: (r) => r.activeSessionId ? <Badge tone="green">Sesi berlangsung</Badge> : <Badge>Siaga</Badge> },
      ]}
    />
  );
}
