import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setTokenProvider, setUnauthorizedHandler } from './api';
import type { Permission, Role } from '../../shared/roles';

export interface PublicConfig {
  appName: string; tagline: string; institution: string; mode: 'DEMO' | 'LIVE'; authMode: 'firebase' | 'demo'; dataStore: string; needsBootstrap: boolean;
  firebase: { apiKey?: string; authDomain?: string; projectId?: string; appId?: string } | null;
}
export interface Me { uid: string; email: string; name: string; role: Role; labIds?: string[]; permissions: Permission[] }

interface AuthCtx {
  config: PublicConfig | null; me: Me | null; loading: boolean; error: string | null;
  can: (p: Permission) => boolean;
  loginDemo: (userId: string) => Promise<void>;
  loginFirebase: (email: string, password: string) => Promise<void>;
  bootstrap: (email: string, password: string, displayName: string, bootstrapToken: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as any);
const DEMO_KEY = 'labguard.demoToken'; // sessionStorage: token sesi DEMO (bukan data aplikasi)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fbAuth = useRef<any>(null);

  const loadMe = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')); } catch (e: any) { setMe(null); if (e.status !== 401) setError(e.message); }
  }, []);

  const refreshConfig = useCallback(async () => { setConfig(await api<PublicConfig>('/public/config')); }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<PublicConfig>('/public/config');
        setConfig(cfg);
        if (cfg.authMode === 'demo') {
          setTokenProvider(async () => sessionStorage.getItem(DEMO_KEY));
          if (sessionStorage.getItem(DEMO_KEY)) await loadMe();
          setLoading(false);
        } else {
          if (!cfg.firebase?.apiKey) { setError('Konfigurasi Firebase Web belum diisi di server (FIREBASE_WEB_API_KEY).'); setLoading(false); return; }
          const { initializeApp } = await import('firebase/app');
          const { getAuth, onIdTokenChanged } = await import('firebase/auth');
          const app = initializeApp(cfg.firebase as any);
          const auth = getAuth(app);
          fbAuth.current = auth;
          setTokenProvider(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
          onIdTokenChanged(auth, async (u) => { if (u) await loadMe(); else setMe(null); setLoading(false); });
        }
      } catch (e: any) { setError(e.message); setLoading(false); }
    })();
    setUnauthorizedHandler(() => setMe(null));
  }, [loadMe]);

  const value = useMemo<AuthCtx>(() => ({
    config, me, loading, error,
    can: (p) => !!me?.permissions.includes(p),
    loginDemo: async (userId) => {
      const { token } = await api<{ token: string }>('/auth/demo-login', { body: { userId } });
      sessionStorage.setItem(DEMO_KEY, token);
      await loadMe();
    },
    loginFirebase: async (email, password) => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      await signInWithEmailAndPassword(fbAuth.current, email, password);
      await loadMe();
      await api('/auth/login-event', { body: {} }).catch(() => {});
    },
    bootstrap: async (email, password, displayName, bootstrapToken) => {
      const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import('firebase/auth');
      const cred = await createUserWithEmailAndPassword(fbAuth.current, email, password).catch(() => signInWithEmailAndPassword(fbAuth.current, email, password));
      await api('/auth/bootstrap', { body: { bootstrapToken, idToken: await cred.user.getIdToken(), displayName } });
      await cred.user.getIdToken(true);
      await loadMe();
      await refreshConfig();
    },
    resetPassword: async (email) => {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(fbAuth.current, email);
    },
    logout: async () => {
      await api('/auth/logout-event', { body: {} }).catch(() => {});
      if (config?.authMode === 'demo') sessionStorage.removeItem(DEMO_KEY);
      else if (fbAuth.current) { const { signOut } = await import('firebase/auth'); await signOut(fbAuth.current); }
      setMe(null);
    },
    refreshConfig,
  }), [config, me, loading, error, loadMe, refreshConfig]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
