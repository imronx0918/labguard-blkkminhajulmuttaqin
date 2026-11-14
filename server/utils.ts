import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) { super(message); }
}
export const notFound = (what = 'Data') => new HttpError(404, `${what} tidak ditemukan`, 'NOT_FOUND');
export const forbidden = (msg = 'Anda tidak memiliki hak akses untuk tindakan ini') => new HttpError(403, msg, 'FORBIDDEN');
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const conflict = (msg: string) => new HttpError(409, msg, 'CONFLICT');

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(10);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('').replace(/^(.{5})/, '$1-');
};
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// AES-256-GCM untuk menyimpan secret HMAC gateway (secret harus dapat dipulihkan untuk verifikasi tanda tangan).
const encKey = () => createHash('sha256').update('labguard-enc:' + config.SERVER_SECRET).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ----- Waktu Asia/Jakarta (UTC+7, tanpa DST)
export const TZ = 'Asia/Jakarta';
const JKT_OFFSET_MIN = 7 * 60;
/** 'YYYY-MM-DD' + 'HH:mm' (waktu Jakarta) → Date UTC */
export function jakartaToDate(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JKT_OFFSET_MIN * 60_000);
}
/** Kunci hari (YYYY-MM-DD) menurut waktu Jakarta */
export function jakartaDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + JKT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
export function jakartaDayRange(dayKey: string): { start: Date; end: Date } {
  const start = jakartaToDate(dayKey, '00:00');
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
export const isoNow = () => new Date().toISOString();
