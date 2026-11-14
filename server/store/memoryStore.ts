import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Collection, Doc, ListQuery, Store, Where } from './types.js';

// Penyimpanan untuk MODE DEMO/pengujian lokal (sisi server, disimpan ke file JSON).
// BUKAN pengganti Firestore untuk produksi.
const toPlain = (v: any): any => {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v;
};

function getField(doc: Doc, field: string): any {
  return field.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), doc);
}

function cmp(a: any, b: any): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

function matchWhere(doc: Doc, [field, op, raw]: Where): boolean {
  const v = getField(doc, field);
  const val = toPlain(raw);
  switch (op) {
    case '==': return v === val;
    case '!=': return v !== val;
    case '<': return v != null && v < val;
    case '<=': return v != null && v <= val;
    case '>': return v != null && v > val;
    case '>=': return v != null && v >= val;
    case 'in': return Array.isArray(val) && val.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(val);
  }
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private data = new Map<string, Map<string, Doc>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file?: string) {
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, Doc>>;
      for (const [col, docs] of Object.entries(raw)) this.data.set(col, new Map(Object.entries(docs)));
    }
  }

  private col(c: string) {
    if (!this.data.has(c)) this.data.set(c, new Map());
    return this.data.get(c)!;
  }

  private persist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const out: Record<string, Record<string, Doc>> = {};
      for (const [c, m] of this.data) out[c] = Object.fromEntries(m);
      fs.mkdirSync(path.dirname(this.file!), { recursive: true });
      fs.writeFileSync(this.file!, JSON.stringify(out));
    }, 200);
  }

  async get(col: Collection, id: string) { const d = this.col(col).get(id); return d ? structuredClone(d) : null; }
  async getMany(col: Collection, ids: string[]) { return ids.map((id) => this.col(col).get(id)).filter(Boolean).map((d) => structuredClone(d!)); }

  async list(col: Collection, q: ListQuery = {}) {
    let items = [...this.col(col).values()];
    for (const w of q.where ?? []) items = items.filter((d) => matchWhere(d, w));
    if (q.orderBy) {
      const { field, dir = 'asc' } = q.orderBy;
      items.sort((a, b) => (dir === 'asc' ? 1 : -1) * cmp(getField(a, field), getField(b, field)) || a.id.localeCompare(b.id));
    }
    if (q.cursor) {
      const idx = items.findIndex((d) => d.id === q.cursor);
      if (idx >= 0) items = items.slice(idx + 1);
    }
    let nextCursor: string | null = null;
    if (q.limit && items.length > q.limit) { items = items.slice(0, q.limit); nextCursor = items[items.length - 1].id; }
    return { items: items.map((d) => structuredClone(d)), nextCursor };
  }

  async count(col: Collection, where: Where[] = []) {
    return [...this.col(col).values()].filter((d) => where.every((w) => matchWhere(d, w))).length;
  }

  async create(col: Collection, data: Record<string, any>, id?: string) {
    const docId = id ?? randomUUID();
    const now = new Date().toISOString();
    const doc = { createdAt: now, updatedAt: now, ...toPlain(data), id: docId } as Doc;
    this.col(col).set(docId, doc);
    this.persist();
    return structuredClone(doc);
  }

  async createIfAbsent(col: Collection, id: string, data: Record<string, any>) {
    if (this.col(col).has(id)) return false;
    await this.create(col, data, id);
    return true;
  }

  async set(col: Collection, id: string, data: Record<string, any>) {
    const prev = this.col(col).get(id);
    const now = new Date().toISOString();
    const doc = { createdAt: prev?.createdAt ?? now, ...toPlain(data), updatedAt: now, id } as Doc;
    this.col(col).set(id, doc);
    this.persist();
    return structuredClone(doc);
  }

  async update(col: Collection, id: string, patch: Record<string, any>) {
    const prev = this.col(col).get(id);
    if (!prev) return null;
    const doc = { ...prev, ...toPlain(patch), updatedAt: new Date().toISOString(), id } as Doc;
    this.col(col).set(id, doc);
    this.persist();
    return structuredClone(doc);
  }

  async delete(col: Collection, id: string) { this.col(col).delete(id); this.persist(); }

  async deleteWhere(col: Collection, where: Where[], max = 500) {
    let n = 0;
    for (const [id, d] of this.col(col)) {
      if (n >= max) break;
      if (where.every((w) => matchWhere(d, w))) { this.col(col).delete(id); n++; }
    }
    if (n) this.persist();
    return n;
  }

  async increment(col: Collection, id: string, fields: Record<string, number>, base: Record<string, any> = {}) {
    const m = this.col(col);
    const now = new Date().toISOString();
    const doc: any = m.get(id) ?? { ...toPlain(base), id, createdAt: now };
    for (const [path, n] of Object.entries(fields)) {
      const keys = path.split('.');
      let o = doc;
      for (const k of keys.slice(0, -1)) o = o[k] ??= {};
      const last = keys[keys.length - 1];
      o[last] = (o[last] ?? 0) + n;
    }
    doc.updatedAt = now;
    m.set(id, doc);
    this.persist();
  }

  /** Hanya untuk pengujian */
  reset() { this.data.clear(); }
}
