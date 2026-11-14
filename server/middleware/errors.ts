import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint ${req.method} ${req.path} tidak ditemukan` } });
}

// Penanganan error terpusat — tidak membocorkan stack trace ke klien.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Data yang dikirim tidak valid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if ((err as any)?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Ukuran data terlalu besar' } });
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON tidak valid' } });
  console.error('[error]', req.method, req.path, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
}

export const ah = <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
