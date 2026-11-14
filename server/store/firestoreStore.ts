import type { Firestore, Query, DocumentSnapshot } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Collection, Doc, ListQuery, Store, Where } from './types.js';

// Konversi Timestamp Firestore → ISO string agar respons API konsisten.
function fromFs(v: any): any {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(fromFs);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromFs(x)]));
  return v;
}
// Konversi string ISO pada field tanggal yang dikenal → Timestamp, Date → Timestamp.
const DATE_FIELDS = /(At|^ts|^validFrom|^validUntil|^expiresAt|^startAt|^endAt)$/;
function toFs(v: any, key = ''): any {
  if (v instanceof Date) return Timestamp.fromDate(v);
  if (typeof v === 'string' && DATE_FIELDS.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Timestamp.fromDate(new Date(v));
  if (Array.isArray(v)) return v.map((x) => toFs(x));
  if (v && typeof v === 'object' && !(v instanceof Timestamp)) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFs(x, k)]));
  return v;
}
const snapToDoc = (s: DocumentSnapshot): Doc => ({ ...(fromFs(s.data()) as object), id: s.id });

export class FirestoreStore implements Store {
  readonly kind = 'firestore' as const;
  constructor(private db: Firestore) {}

  async get(col: Collection, id: string) {
    const s = await this.db.collection(col).doc(id).get();
    return s.exists ? snapToDoc(s) : null;
  }

  async getMany(col: Collection, ids: string[]) {
    if (!ids.length) return [];
    const refs = ids.map((id) => this.db.collection(col).doc(id));
    const snaps = await this.db.getAll(...refs);
    return snaps.filter((s) => s.exists).map(snapToDoc);
  }

  private applyWhere(q: Query, where: Where[] = []) {
    for (const [f, op, v] of where) q = q.where(f, op, toFs(v, f));
    return q;
  }

  async list(col: Collection, lq: ListQuery = {}) {
    let q: Query = this.applyWhere(this.db.collection(col), lq.where);
    if (lq.orderBy) q = q.orderBy(lq.orderBy.field, lq.orderBy.dir ?? 'asc');
    if (lq.cursor) {
      const c = await this.db.collection(col).doc(lq.cursor).get();
      if (c.exists) q = q.startAfter(c);
    }
    if (lq.limit) q = q.limit(lq.limit + 1);
    const snap = await q.get();
    let docs = snap.docs.map(snapToDoc);
    let nextCursor: string | null = null;
    if (lq.limit && docs.length > lq.limit) { docs = docs.slice(0, lq.limit); nextCursor = docs[docs.length - 1].id; }
    return { items: docs, nextCursor };
  }

  async count(col: Collection, where: Where[] = []) {
    const agg = await this.applyWhere(this.db.collection(col), where).count().get();
    return agg.data().count;
  }

  async create(col: Collection, data: Record<string, any>, id?: string) {
    const ref = id ? this.db.collection(col).doc(id) : this.db.collection(col).doc();
    await ref.set({ ...toFs(data), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return snapToDoc(await ref.get());
  }

  async createIfAbsent(col: Collection, id: string, data: Record<string, any>) {
    try {
      await this.db.collection(col).doc(id).create({ ...toFs(data), createdAt: FieldValue.serverTimestamp() });
      return true;
    } catch (e: any) {
      if (e?.code === 6 /* ALREADY_EXISTS */) return false;
      throw e;
    }
  }

  async set(col: Collection, id: string, data: Record<string, any>) {
    const ref = this.db.collection(col).doc(id);
    const prev = await ref.get();
    await ref.set({ ...toFs(data), ...(prev.exists ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    return snapToDoc(await ref.get());
  }

  async update(col: Collection, id: string, patch: Record<string, any>) {
    const ref = this.db.collection(col).doc(id);
    try {
      await ref.update({ ...toFs(patch), updatedAt: FieldValue.serverTimestamp() });
    } catch (e: any) {
      if (e?.code === 5 /* NOT_FOUND */) return null;
      throw e;
    }
    return snapToDoc(await ref.get());
  }

  async delete(col: Collection, id: string) { await this.db.collection(col).doc(id).delete(); }

  async increment(col: Collection, id: string, fields: Record<string, number>, base: Record<string, any> = {}) {
    const ref = this.db.collection(col).doc(id);
    const nested: Record<string, any> = { ...toFs(base), updatedAt: FieldValue.serverTimestamp() };
    for (const [path, n] of Object.entries(fields)) {
      const keys = path.split('.');
      let o = nested;
      for (const k of keys.slice(0, -1)) o = o[k] ??= {};
      o[keys[keys.length - 1]] = FieldValue.increment(n);
    }
    await ref.set(nested, { merge: true });
  }

  async deleteWhere(col: Collection, where: Where[], max = 500) {
    const snap = await this.applyWhere(this.db.collection(col), where).limit(max).get();
    if (snap.empty) return 0;
    const batch = this.db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }
}
