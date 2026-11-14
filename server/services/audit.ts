import type { Request } from 'express';
import { db } from '../store/index.js';
import { isoNow } from '../utils.js';

/** Catat tindakan penting ke auditLogs (hanya server yang dapat menulis — lihat firestore.rules). */
export async function audit(
  req: Request | null,
  action: string,
  opts: { target?: string; targetId?: string; details?: Record<string, unknown>; result?: 'SUCCESS' | 'FAILURE' | 'DENIED'; actor?: { uid: string; name: string; role?: string } } = {},
) {
  const actor = opts.actor ?? (req?.user ? { uid: req.user.uid, name: req.user.name, role: req.user.role } : req?.gateway ? { uid: `gateway:${req.gateway.id}`, name: `Gateway ${req.gateway.name}`, role: 'gateway' } : { uid: 'system', name: 'Sistem', role: 'system' });
  await db().create('auditLogs', {
    ts: new Date(), userId: actor.uid, userName: actor.name, role: actor.role ?? null, action,
    target: opts.target ?? null, targetId: opts.targetId ?? null, details: opts.details ?? {},
    ip: req ? (req.ip ?? null) : null, result: opts.result ?? 'SUCCESS', createdBy: actor.uid,
  });
}
export { isoNow };
