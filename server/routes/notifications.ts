import { Router } from 'express';
import { db } from '../store/index.js';
import { ah } from '../middleware/errors.js';
import { notFound } from '../utils.js';

const r = Router();
r.get('/', ah(async (req, res) => {
  const items = (await db().list('notifications', { where: [['audience', 'array-contains', req.user!.role]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 50 })).items;
  const out = items.map((n) => ({ ...n, read: (n.readBy ?? []).includes(req.user!.uid) }));
  res.json({ items: out, unread: out.filter((n) => !n.read).length });
}));
r.post('/:id/read', ah(async (req, res) => {
  const n = await db().get('notifications', req.params.id);
  if (!n || !(n.audience ?? []).includes(req.user!.role)) throw notFound('Notifikasi');
  if (!(n.readBy ?? []).includes(req.user!.uid)) await db().update('notifications', n.id, { readBy: [...(n.readBy ?? []), req.user!.uid] });
  res.json({ ok: true });
}));
r.post('/read-all', ah(async (req, res) => {
  const items = (await db().list('notifications', { where: [['audience', 'array-contains', req.user!.role]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 100 })).items;
  for (const n of items) if (!(n.readBy ?? []).includes(req.user!.uid)) await db().update('notifications', n.id, { readBy: [...(n.readBy ?? []), req.user!.uid] });
  res.json({ ok: true });
}));
export default r;
