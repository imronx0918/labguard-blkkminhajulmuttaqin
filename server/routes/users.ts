import { Router } from 'express';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { userCreateSchema, userUpdateSchema } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, notFound } from '../utils.js';
import { randomUUID } from 'node:crypto';

const r = Router();

async function setClaims(uid: string, role: string | null) {
  if (config.isDemoAuth) return;
  const { getAuth } = await import('firebase-admin/auth');
  const { getAdminApp } = await import('../firebase.js');
  await getAuth(getAdminApp()).setCustomUserClaims(uid, role ? { role } : {});
  await getAuth(getAdminApp()).revokeRefreshTokens(uid); // paksa token baru agar perubahan peran langsung berlaku
}

r.get('/', requirePermission('users.view'), ah(async (_req, res) => {
  res.json(await db().list('users', { orderBy: { field: 'displayName' }, limit: 1000 }));
}));

/** Daftar guru untuk dropdown sesi (dapat diakses peran yang membuat sesi). */
r.get('/teachers', requirePermission('sessions.view'), ah(async (_req, res) => {
  const items = (await db().list('users', { where: [['active', '==', true]], limit: 1000 })).items.filter((u) => ['teacher', 'lab_admin', 'super_admin'].includes(u.role));
  res.json({ items: items.map((u) => ({ id: u.id, displayName: u.displayName, role: u.role })), nextCursor: null });
}));

r.post('/', requirePermission('users.manage'), ah(async (req, res) => {
  const d = userCreateSchema.parse(req.body);
  if (await db().count('users', [['email', '==', d.email.toLowerCase()]])) throw conflict('Email sudah terdaftar');
  let uid: string;
  if (config.isDemoAuth) uid = `demo-${randomUUID().slice(0, 8)}`;
  else {
    const { getAuth } = await import('firebase-admin/auth');
    const { getAdminApp } = await import('../firebase.js');
    const auth = getAuth(getAdminApp());
    const existing = await auth.getUserByEmail(d.email).catch(() => null);
    const user = existing ?? (await auth.createUser({ email: d.email, displayName: d.displayName, password: d.password, emailVerified: false }));
    uid = user.uid;
  }
  const doc = await db().set('users', uid, { email: d.email.toLowerCase(), displayName: d.displayName, role: d.role, active: true, labIds: d.labIds, createdBy: req.user!.uid, demo: config.isDemoAuth });
  await setClaims(uid, d.role);
  await audit(req, 'USER_CREATE', { targetId: uid, details: { email: d.email, role: d.role } });
  res.status(201).json(doc);
}));

r.put('/:id', requirePermission('users.manage'), ah(async (req, res) => {
  const prev = await db().get('users', req.params.id);
  if (!prev) throw notFound('Pengguna');
  const d = userUpdateSchema.parse(req.body);
  if (prev.id === req.user!.uid && (d.role && d.role !== prev.role || d.active === false)) throw badRequest('Anda tidak dapat mengubah peran atau menonaktifkan akun sendiri');
  if (prev.role === 'super_admin' && (d.role && d.role !== 'super_admin' || d.active === false)) {
    const supers = await db().count('users', [['role', '==', 'super_admin'], ['active', '==', true]]);
    if (supers <= 1) throw badRequest('Minimal harus ada satu Super Admin aktif');
  }
  if (req.user!.role !== 'super_admin' && (prev.role === 'super_admin' || d.role === 'super_admin')) throw forbidden('Hanya Super Admin yang dapat mengelola akun Super Admin');
  const doc = await db().update('users', prev.id, d);
  if (d.role && d.role !== prev.role) { await setClaims(prev.id, d.role); await audit(req, 'USER_ROLE_CHANGE', { targetId: prev.id, details: { from: prev.role, to: d.role } }); }
  if (d.active === false && !config.isDemoAuth) await setClaims(prev.id, null);
  await audit(req, 'USER_UPDATE', { targetId: prev.id, details: { fields: Object.keys(d) } });
  res.json(doc);
}));

r.delete('/:id', requirePermission('users.manage'), ah(async (req, res) => {
  const u = await db().get('users', req.params.id);
  if (!u) throw notFound('Pengguna');
  if (u.id === req.user!.uid) throw badRequest('Tidak dapat menghapus akun sendiri');
  if (u.role === 'super_admin') throw forbidden('Akun Super Admin tidak dapat dihapus. Turunkan perannya terlebih dahulu.');
  await db().delete('users', u.id);
  if (!config.isDemoAuth) {
    const { getAuth } = await import('firebase-admin/auth');
    const { getAdminApp } = await import('../firebase.js');
    await getAuth(getAdminApp()).deleteUser(u.id).catch(() => {});
  }
  await audit(req, 'USER_DELETE', { targetId: u.id, details: { email: u.email } });
  res.json({ ok: true });
}));

export default r;
