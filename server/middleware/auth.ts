import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../store/index.js';
import { can, isRole, type Permission, type Role } from '../../shared/roles.js';
import { HttpError, forbidden, hmacHex, safeEqual } from '../utils.js';
import { audit } from '../services/audit.js';

export interface AuthUser { uid: string; email: string; name: string; role: Role; labIds?: string[] }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser; gateway?: { id: string; name: string; labIds: string[] }; device?: { id: string } } }
}

// ---- Token sesi MODE DEMO (HMAC). Tidak dipakai saat AUTH_MODE=firebase.
export function signDemoToken(uid: string, ttlSec = 12 * 3600): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `demo.${payload}.${hmacHex(config.SERVER_SECRET, payload)}`;
}
function verifyDemoToken(token: string): string | null {
  const [p, payload, sig] = token.split('.');
  if (p !== 'demo' || !payload || !sig || !safeEqual(sig, hmacHex(config.SERVER_SECRET, payload))) return null;
  const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return exp > Date.now() / 1000 ? uid : null;
}

async function resolveUid(token: string): Promise<{ uid: string; email?: string; role?: string } | null> {
  if (config.isDemoAuth) {
    const uid = verifyDemoToken(token);
    return uid ? { uid } : null;
  }
  const { getAuth } = await import('firebase-admin/auth');
  const { getAdminApp } = await import('../firebase.js');
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token, true);
    return { uid: decoded.uid, email: decoded.email, role: decoded.role as string | undefined };
  } catch {
    return null;
  }
}

/** Wajib login. Peran diambil dari dokumen users (sumber kebenaran) — custom claim hanya cache. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw new HttpError(401, 'Silakan login terlebih dahulu', 'UNAUTHENTICATED');
    const r = await resolveUid(token);
    if (!r) throw new HttpError(401, 'Sesi login tidak valid atau kedaluwarsa', 'UNAUTHENTICATED');
    const u = await db().get('users', r.uid);
    if (!u || !u.active) throw new HttpError(403, 'Akun tidak terdaftar atau dinonaktifkan. Hubungi Super Admin.', 'ACCOUNT_INACTIVE');
    if (!isRole(u.role)) throw forbidden('Peran akun tidak valid');
    req.user = { uid: u.id, email: u.email, name: u.displayName, role: u.role, labIds: u.labIds };
    next();
  } catch (e) { next(e); }
}

export function requirePermission(...perms: Permission[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Silakan login', 'UNAUTHENTICATED'));
    if (perms.every((p) => can(req.user!.role, p))) return next();
    await audit(req, 'ACCESS_DENIED', { target: req.originalUrl, details: { required: perms }, result: 'DENIED' }).catch(() => {});
    next(forbidden());
  };
}
