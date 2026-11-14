import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db } from '../store/index.js';
import { ah } from '../middleware/errors.js';
import { requireAuth, signDemoToken } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getSettings, markSetup } from '../services/settings.js';
import { ensureDemoUsers } from '../services/seed.js';
import { HttpError, badRequest, safeEqual } from '../utils.js';
import { ROLE_PERMISSIONS } from '../../shared/roles.js';

export const publicRouter = Router();
publicRouter.get('/config', ah(async (_req, res) => {
  const s = await getSettings();
  const supers = await db().count('users', [['role', '==', 'super_admin']]);
  res.json({
    appName: s.app.name, tagline: s.app.tagline, institution: s.institution.name, mode: s.mode, authMode: config.AUTH_MODE, dataStore: config.DATA_STORE,
    needsBootstrap: supers === 0,
    firebase: config.AUTH_MODE === 'firebase' ? { apiKey: config.FIREBASE_WEB_API_KEY, authDomain: config.FIREBASE_WEB_AUTH_DOMAIN, projectId: config.FIREBASE_PROJECT_ID, appId: config.FIREBASE_WEB_APP_ID } : null,
  });
}));
publicRouter.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

// ---- MODE DEMO: pilih akun DEMO (tanpa password). Tidak tersedia saat AUTH_MODE=firebase.
authRouter.get('/demo-users', ah(async (_req, res) => {
  if (!config.isDemoAuth) throw new HttpError(404, 'Tidak tersedia', 'NOT_FOUND');
  await ensureDemoUsers();
  const users = (await db().list('users', { where: [['demo', '==', true]], limit: 20 })).items;
  res.json({ items: users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, role: u.role })) });
}));
authRouter.post('/demo-login', loginLimiter, ah(async (req, res) => {
  if (!config.isDemoAuth) throw new HttpError(404, 'Tidak tersedia', 'NOT_FOUND');
  const { userId } = z.object({ userId: z.string().max(128) }).parse(req.body);
  const u = await db().get('users', userId);
  if (!u || !u.active || !u.demo) throw new HttpError(401, 'Akun demo tidak valid', 'UNAUTHENTICATED');
  await db().update('users', u.id, { lastLoginAt: new Date() });
  await audit(req, 'LOGIN', { actor: { uid: u.id, name: u.displayName, role: u.role }, details: { method: 'demo' } });
  res.json({ token: signDemoToken(u.id) });
}));

/**
 * Registrasi Super Admin pertama (FIREBASE): pengguna mendaftar di Firebase Auth (client),
 * lalu memanggil endpoint ini dengan ID token + BOOTSTRAP_TOKEN. Hanya berhasil jika belum ada Super Admin.
 */
authRouter.post('/bootstrap', loginLimiter, ah(async (req, res) => {
  const { bootstrapToken, idToken, displayName } = z.object({ bootstrapToken: z.string().min(8).max(200), idToken: z.string().min(10).max(5000), displayName: z.string().min(2).max(120) }).parse(req.body);
  if (config.isDemoAuth) throw badRequest('Bootstrap hanya untuk AUTH_MODE=firebase');
  if (!config.BOOTSTRAP_TOKEN || !safeEqual(bootstrapToken, config.BOOTSTRAP_TOKEN)) throw new HttpError(403, 'Token bootstrap salah', 'FORBIDDEN');
  if (await db().count('users', [['role', '==', 'super_admin']])) throw new HttpError(409, 'Super Admin sudah ada', 'CONFLICT');
  const { getAuth } = await import('firebase-admin/auth');
  const { getAdminApp } = await import('../firebase.js');
  const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
  await db().set('users', decoded.uid, { email: (decoded.email ?? '').toLowerCase(), displayName, role: 'super_admin', active: true, labIds: [] });
  await getAuth(getAdminApp()).setCustomUserClaims(decoded.uid, { role: 'super_admin' });
  await markSetup('superAdmin', true, decoded.uid);
  await audit(req, 'SUPER_ADMIN_BOOTSTRAP', { actor: { uid: decoded.uid, name: displayName, role: 'super_admin' } });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ ...req.user, permissions: [...ROLE_PERMISSIONS[req.user!.role]] });
}));
authRouter.post('/login-event', requireAuth, ah(async (req, res) => {
  await db().update('users', req.user!.uid, { lastLoginAt: new Date() });
  await audit(req, 'LOGIN', { details: { method: 'firebase' } });
  res.json({ ok: true });
}));
authRouter.post('/logout-event', requireAuth, ah(async (req, res) => {
  await audit(req, 'LOGOUT');
  res.json({ ok: true });
}));
