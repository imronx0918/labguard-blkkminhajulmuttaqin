import { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Mail, UserCog, KeyRound, Network, Search, Ban } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';
import { Button, Field, Input, Badge } from '../components/ui';
import { ROLE_LABELS } from '../../shared/roles';

export default function Login() {
  const { config, loginDemo, loginFirebase, bootstrap, resetPassword, error } = useAuth();
  const [demoUsers, setDemoUsers] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const isDemo = config?.authMode === 'demo';

  useEffect(() => { if (isDemo) api('/auth/demo-users').then((r) => setDemoUsers(r.items)).catch((e) => setMsg(e.message)); }, [isDemo]);
  useEffect(() => { if (config?.needsBootstrap && !isDemo) setMode('bootstrap'); }, [config, isDemo]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e: any) { setMsg(e.code === 'auth/invalid-credential' ? 'Email atau kata sandi salah' : e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        <div className="relative flex items-center gap-3"><Logo size={46} /><div><p className="text-xl font-extrabold tracking-wide">LABGUARD <span className="text-soft-300">EDU</span></p><p className="text-sm text-navy-300">{config?.institution || 'Sistem Pengendalian Akses Internet Laboratorium'}</p></div></div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-extrabold leading-tight">Lab komputer fokus belajar.<br /><span className="text-soft-300">Google Search saja.</span></h1>
          <p className="mt-4 text-navy-200">Kendalikan akses internet peserta didik per sesi pembelajaran — kebijakan browser terkelola, DNS filtering, dan firewall gateway lokal yang terkonfirmasi.</p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-sm">
            {[[Search, 'Google Search + SafeSearch'], [Ban, 'Default deny situs lain'], [Network, 'Gateway lokal terverifikasi']].map(([I, t]: any) => (
              <div key={t} className="rounded-xl border border-white/10 bg-white/5 p-3"><I className="mb-2 h-5 w-5 text-soft-300" /><p className="text-navy-100">{t}</p></div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-navy-400">Tidak ada dekripsi HTTPS. Log hanya domain, waktu, perangkat, dan hasil kebijakan.</p>
      </div>
      <div className="flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Logo size={40} /><p className="text-lg font-extrabold">LABGUARD <span className="text-navy-500">EDU</span></p></div>
          <div className="card p-7">
            {isDemo ? (
              <>
                <div className="mb-1 flex items-center gap-2"><h2 className="text-xl font-extrabold text-navy-900">Masuk (Mode DEMO)</h2><Badge tone="violet">DEMO</Badge></div>
                <p className="mb-5 text-sm text-slate-500">Server berjalan dengan <code className="mono">AUTH_MODE=demo</code>. Pilih akun contoh untuk menguji hak akses tiap peran. Untuk produksi gunakan Firebase Authentication.</p>
                <div className="space-y-2">
                  {demoUsers.map((u) => (
                    <button key={u.id} disabled={busy} onClick={() => run(() => loginDemo(u.id))} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-navy-400 hover:bg-soft-50">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-100 text-navy-700"><UserCog className="h-5 w-5" /></div>
                      <div><p className="text-sm font-semibold">{u.displayName}</p><p className="text-xs text-slate-500">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]} · {u.email}</p></div>
                    </button>
                  ))}
                </div>
              </>
            ) : mode === 'bootstrap' ? (
              <form onSubmit={(e) => { e.preventDefault(); run(() => bootstrap(email, password, name, token)); }} className="space-y-4">
                <div><h2 className="text-xl font-extrabold text-navy-900">Registrasi Super Admin</h2><p className="text-sm text-slate-500">Belum ada Super Admin. Masukkan token bootstrap dari variabel server <code className="mono">BOOTSTRAP_TOKEN</code>.</p></div>
                <Field label="Nama lengkap"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Email"><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Kata sandi" hint="Minimal 8 karakter"><Input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <Field label="Token bootstrap"><Input required type="password" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
                <Button className="w-full" loading={busy} icon={<KeyRound className="h-4 w-4" />}>Daftarkan Super Admin</Button>
                <button type="button" className="w-full text-center text-xs text-navy-600 hover:underline" onClick={() => setMode('login')}>Sudah punya akun? Masuk</button>
              </form>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); run(() => loginFirebase(email, password)); }} className="space-y-4">
                <div><h2 className="text-xl font-extrabold text-navy-900">Masuk</h2><p className="text-sm text-slate-500">Gunakan akun yang didaftarkan administrator.</p></div>
                <Field label="Email"><div className="relative"><Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input required type="email" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div></Field>
                <Field label="Kata sandi"><div className="relative"><Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input required type="password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div></Field>
                <Button className="w-full" loading={busy} icon={<ShieldCheck className="h-4 w-4" />}>Masuk</Button>
                <button type="button" className="w-full text-center text-xs text-navy-600 hover:underline" onClick={() => email ? run(async () => { await resetPassword(email); setMsg('Tautan reset kata sandi telah dikirim ke email.'); }) : setMsg('Isi email terlebih dahulu')}>Lupa kata sandi?</button>
                {config?.needsBootstrap && <button type="button" className="w-full text-center text-xs text-navy-600 hover:underline" onClick={() => setMode('bootstrap')}>Registrasi Super Admin pertama</button>}
              </form>
            )}
            {(msg || error) && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg || error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
