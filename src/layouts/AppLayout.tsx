import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Building2, CalendarClock, ChevronsLeft, ChevronsRight, ClipboardList, FileBarChart, Globe2, GraduationCap, LayoutDashboard, ListChecks, LogOut, Menu, Monitor, Network, Settings, ShieldCheck, Users, X, CheckCheck, Rocket } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';
import { cx, Badge } from '../components/ui';
import { ROLE_LABELS, type Permission } from '../../shared/roles';
import { timeAgo } from '../lib/format';

export const NAV: { to: string; label: string; icon: any; perm: Permission }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
  { to: '/devices', label: 'Perangkat Komputer', icon: Monitor, perm: 'devices.view' },
  { to: '/students', label: 'Peserta Didik', icon: GraduationCap, perm: 'students.view' },
  { to: '/classes', label: 'Data Kelas', icon: BookOpen, perm: 'classes.view' },
  { to: '/laboratories', label: 'Laboratorium', icon: Building2, perm: 'labs.view' },
  { to: '/sessions', label: 'Sesi Pembelajaran', icon: CalendarClock, perm: 'sessions.view' },
  { to: '/policies', label: 'Kebijakan Internet', icon: ShieldCheck, perm: 'policies.view' },
  { to: '/sites', label: 'Daftar Situs', icon: Globe2, perm: 'sites.view' },
  { to: '/activity', label: 'Aktivitas dan Log', icon: ClipboardList, perm: 'logs.view' },
  { to: '/gateways', label: 'Gateway dan Jaringan', icon: Network, perm: 'gateways.view' },
  { to: '/reports', label: 'Laporan', icon: FileBarChart, perm: 'reports.view' },
  { to: '/users', label: 'Pengguna dan Hak Akses', icon: Users, perm: 'users.view' },
  { to: '/settings', label: 'Pengaturan', icon: Settings, perm: 'settings.view' },
];

const PREF_KEY = 'labguard.sidebarCollapsed'; // localStorage hanya untuk preferensi UI

function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['/notifications'], queryFn: () => api<{ items: any[]; unread: number }>('/notifications'), refetchInterval: 30_000 });
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const sev: Record<string, string> = { error: 'bg-red-500', warning: 'bg-amber-500', success: 'bg-emerald-500', info: 'bg-navy-400' };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifikasi">
        <Bell className="h-5 w-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold">Pusat Notifikasi</p>
            <button className="flex items-center gap-1 text-xs font-semibold text-navy-600 hover:underline" onClick={async () => { await api('/notifications/read-all', { body: {} }); qc.invalidateQueries({ queryKey: ['/notifications'] }); }}><CheckCheck className="h-3.5 w-3.5" />Tandai semua dibaca</button>
          </div>
          <div className="scroll-thin max-h-[60vh] overflow-y-auto">
            {!data?.items.length && <p className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada notifikasi</p>}
            {data?.items.map((n) => (
              <button key={n.id} className={cx('flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-soft-50/60')} onClick={async () => { await api(`/notifications/${n.id}/read`, { body: {} }); qc.invalidateQueries({ queryKey: ['/notifications'] }); if (n.link) nav(n.link); setOpen(false); }}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', sev[n.severity])} />
                <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{n.title}</span><span className="block text-xs text-slate-500">{n.message}</span><span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { me, can, logout, config } = useAuth();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, collapsed ? '1' : '0'); } catch { /* abaikan */ } }, [collapsed]);
  const items = NAV.filter((n) => can(n.perm));
  const mode = config?.mode;

  const sidebar = (
    <aside className={cx('flex h-full flex-col bg-navy-900 text-navy-100 transition-all', collapsed ? 'w-[76px]' : 'w-[264px]')}>
      <div className={cx('flex items-center gap-3 border-b border-white/5 px-4 py-4', collapsed && 'justify-center px-2')}>
        <Logo size={collapsed ? 34 : 38} />
        {!collapsed && <div className="min-w-0"><p className="text-[15px] font-extrabold tracking-wide text-white">LABGUARD <span className="text-soft-300">EDU</span></p><p className="truncate text-[11px] text-navy-300">{config?.institution || 'Kontrol Akses Internet Lab'}</p></div>}
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} title={collapsed ? n.label : undefined}
            className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition', collapsed && 'justify-center px-0', isActive ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (<>
              {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-soft-300" />}
              <n.icon className={cx('h-[18px] w-[18px] shrink-0', isActive ? 'text-soft-300' : 'text-navy-300 group-hover:text-soft-200')} />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </>)}
          </NavLink>
        ))}
        {can('settings.manage') && (
          <NavLink to="/setup" title={collapsed ? 'Instalasi Terpandu' : undefined} className={({ isActive }) => cx('mt-3 flex items-center gap-3 rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-[13px] font-medium', collapsed && 'justify-center px-0', isActive ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5')}>
            <Rocket className="h-[18px] w-[18px] text-emerald-300" />{!collapsed && 'Instalasi Terpandu'}
          </NavLink>
        )}
      </nav>
      <div className="border-t border-white/5 p-2.5">
        <div className={cx('mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]', collapsed && 'justify-center')}>
          <span className={cx('h-2 w-2 rounded-full', mode === 'LIVE' ? 'bg-emerald-400' : 'bg-violet-400')} />
          {!collapsed && <span className="font-semibold text-navy-200">{mode === 'LIVE' ? 'LIVE MODE' : 'DEMO MODE'}</span>}
        </div>
        <button onClick={() => setCollapsed(!collapsed)} className="hidden w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-navy-300 hover:bg-white/5 lg:flex">
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" />Perkecil sidebar</>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">{sidebar}</div>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobile(false)} />
          <div className="relative h-full w-fit">{sidebar}<button className="absolute right-[-44px] top-3 rounded-lg bg-white p-2" onClick={() => setMobile(false)} aria-label="Tutup menu"><X className="h-5 w-5" /></button></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobile(true)} aria-label="Buka menu"><Menu className="h-5 w-5" /></button>
            <div className="hidden text-sm text-slate-500 sm:block">{items.find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)))?.label ?? (loc.pathname === '/setup' ? 'Instalasi Terpandu' : '')}</div>
          </div>
          <div className="flex items-center gap-2">
            {mode !== 'LIVE' && <Badge tone="violet" className="hidden sm:inline-flex">DEMO — tidak ada perubahan jaringan</Badge>}
            <NotificationCenter />
            <div className="mx-1 hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold leading-tight text-slate-800">{me?.name}</p><p className="text-[11px] text-slate-500">{me && ROLE_LABELS[me.role]}</p></div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-100 text-sm font-bold text-navy-700">{me?.name?.slice(0, 1).toUpperCase()}</div>
            <button onClick={() => logout()} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="Keluar" aria-label="Keluar"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>
        {mode !== 'LIVE' && (
          <div className="no-print flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs text-violet-800 sm:px-6">
            <ListChecks className="h-4 w-4 shrink-0" />
            <span><b>MODE DEMO.</b> Kebijakan hanya divalidasi/disimulasikan — tidak ada pemblokiran yang benar-benar diterapkan di jaringan. Data berlabel DEMO adalah contoh.</span>
          </div>
        )}
        <main className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1440px]"><Outlet /></div></main>
      </div>
    </div>
  );
}
