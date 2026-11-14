import { Router, type Request } from 'express';
import type { ZodTypeAny } from 'zod';
import { db } from '../store/index.js';
import type { Collection, Where } from '../store/types.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import type { Permission } from '../../shared/roles.js';
import { audit } from '../services/audit.js';
import { notFound, conflict } from '../utils.js';
import { pageQuery } from '../validators/index.js';

export interface CrudOptions {
  col: Collection; label: string; schema: ZodTypeAny; view: Permission; manage: Permission;
  filters?: string[]; searchFields?: string[]; orderBy?: string;
  unique?: string; // field unik
  beforeWrite?: (data: any, req: Request, existing?: any) => Promise<any> | any;
  afterWrite?: (doc: any, req: Request, prev?: any) => Promise<void> | void;
  beforeDelete?: (doc: any, req: Request) => Promise<void> | void;
}

/** Router CRUD generik dengan validasi Zod, RBAC server-side, pencarian, filter, pagination, dan audit log. */
export function crudRouter(o: CrudOptions) {
  const r = Router();
  r.get('/', requirePermission(o.view), ah(async (req, res) => {
    const { limit, cursor } = pageQuery.parse(req.query);
    const where: Where[] = [];
    for (const f of o.filters ?? []) {
      const v = req.query[f];
      if (typeof v === 'string' && v) where.push([f, '==', v === 'true' ? true : v === 'false' ? false : v]);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
    if (q) {
      // Pencarian teks: filter sisi server di atas hasil terbatas (Firestore tidak mendukung full-text).
      const all = await db().list(o.col, { where, limit: 2000 });
      const items = all.items.filter((d) => (o.searchFields ?? ['name']).some((f) => String(d[f] ?? '').toLowerCase().includes(q)));
      return res.json({ items: items.slice(0, limit), nextCursor: null });
    }
    res.json(await db().list(o.col, { where, orderBy: { field: o.orderBy ?? 'name', dir: 'asc' }, limit, cursor }));
  }));
  r.get('/:id', requirePermission(o.view), ah(async (req, res) => {
    const d = await db().get(o.col, req.params.id);
    if (!d) throw notFound(o.label);
    res.json(d);
  }));
  r.post('/', requirePermission(o.manage), ah(async (req, res) => {
    let data = o.schema.parse(req.body);
    if (o.unique) {
      const dup = await db().count(o.col, [[o.unique, '==', data[o.unique]]]);
      if (dup) throw conflict(`${o.label} dengan ${o.unique} "${data[o.unique]}" sudah ada`);
    }
    if (o.beforeWrite) data = await o.beforeWrite(data, req);
    const doc = await db().create(o.col, { ...data, createdBy: req.user!.uid });
    await audit(req, `${o.col.toUpperCase()}_CREATE`, { target: `${o.col}/${doc.id}`, targetId: doc.id, details: { name: doc.name ?? doc.nis ?? doc.id } });
    await o.afterWrite?.(doc, req);
    res.status(201).json(doc);
  }));
  r.put('/:id', requirePermission(o.manage), ah(async (req, res) => {
    const prev = await db().get(o.col, req.params.id);
    if (!prev) throw notFound(o.label);
    let data = (o.schema as any).partial ? (o.schema as any).partial().parse(req.body) : o.schema.parse(req.body);
    if (o.unique && data[o.unique] && data[o.unique] !== prev[o.unique]) {
      const dup = await db().count(o.col, [[o.unique, '==', data[o.unique]]]);
      if (dup) throw conflict(`${o.label} dengan ${o.unique} "${data[o.unique]}" sudah ada`);
    }
    if (o.beforeWrite) data = await o.beforeWrite(data, req, prev);
    const doc = await db().update(o.col, req.params.id, data);
    await audit(req, `${o.col.toUpperCase()}_UPDATE`, { target: `${o.col}/${req.params.id}`, targetId: req.params.id, details: { fields: Object.keys(data) } });
    await o.afterWrite?.(doc, req, prev);
    res.json(doc);
  }));
  r.delete('/:id', requirePermission(o.manage), ah(async (req, res) => {
    const prev = await db().get(o.col, req.params.id);
    if (!prev) throw notFound(o.label);
    await o.beforeDelete?.(prev, req);
    await db().delete(o.col, req.params.id);
    await audit(req, `${o.col.toUpperCase()}_DELETE`, { target: `${o.col}/${req.params.id}`, targetId: req.params.id, details: { name: prev.name ?? prev.nis ?? prev.id } });
    res.json({ ok: true });
  }));
  return r;
}
