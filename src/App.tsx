import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from './lib/auth';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import { Button, Loading } from './components/ui';
import type { Permission } from '../shared/roles';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Devices = lazy(() => import('./pages/Devices'));
const Students = lazy(() => import('./pages/Students'));
const Classes = lazy(() => import('./pages/Classes'));
const Laboratories = lazy(() => import('./pages/Laboratories'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Policies = lazy(() => import('./pages/Policies'));
const Sites = lazy(() => import('./pages/Sites'));
const Activity = lazy(() => import('./pages/Activity'));
const Gateways = lazy(() => import('./pages/Gateways'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const Setup = lazy(() => import('./pages/Setup'));

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ShieldX className="mb-3 h-12 w-12 text-red-400" />
      <h2 className="text-lg font-bold">Akses ditolak</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">Peran Anda tidak memiliki izin <code className="mono">{perm}</code>. Server juga menolak permintaan API untuk halaman ini.</p>
      <Link to="/" className="mt-4"><Button variant="outline">Kembali ke dashboard</Button></Link>
    </div>
  );
  return <>{children}</>;
}

function NotFound() {
  return <div className="py-20 text-center"><h2 className="text-lg font-bold">Halaman tidak ditemukan</h2><Link to="/" className="mt-3 inline-block text-sm font-semibold text-navy-600">Ke dashboard</Link></div>;
}

export default function App() {
  const { me, loading, error, config } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Loading label="Memuat LABGUARD EDU…" /></div>;
  if (!config && error) return <div className="flex h-screen items-center justify-center p-6 text-center text-sm text-red-600">Tidak dapat terhubung ke server: {error}</div>;
  if (!me) return <Login />;
  const r = (path: string, perm: Permission, el: ReactNode) => <Route path={path} element={<Guard perm={perm}><Suspense fallback={<Loading />}>{el}</Suspense></Guard>} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {r('/', 'dashboard.view', <Dashboard />)}
          {r('/devices', 'devices.view', <Devices />)}
          {r('/students', 'students.view', <Students />)}
          {r('/classes', 'classes.view', <Classes />)}
          {r('/laboratories', 'labs.view', <Laboratories />)}
          {r('/sessions', 'sessions.view', <Sessions />)}
          {r('/policies', 'policies.view', <Policies />)}
          {r('/sites', 'sites.view', <Sites />)}
          {r('/activity', 'logs.view', <Activity />)}
          {r('/gateways', 'gateways.view', <Gateways />)}
          {r('/reports', 'reports.view', <Reports />)}
          {r('/users', 'users.view', <Users />)}
          {r('/settings', 'settings.view', <Settings />)}
          {r('/setup', 'settings.manage', <Setup />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
