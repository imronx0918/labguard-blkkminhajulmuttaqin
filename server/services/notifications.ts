import { db } from '../store/index.js';
import type { NotificationKind } from '../../shared/types.js';
import type { Role } from '../../shared/roles.js';
import { getSettings } from './settings.js';

const ADMINS: Role[] = ['super_admin', 'lab_admin'];

export async function notify(n: { kind: NotificationKind; title: string; message: string; severity?: 'info' | 'success' | 'warning' | 'error'; link?: string; audience?: Role[]; dedupeKey?: string; dedupeMinutes?: number }) {
  const s = await getSettings();
  if (s.notifications[n.kind] === false) return;
  if (n.dedupeKey) {
    const since = new Date(Date.now() - (n.dedupeMinutes ?? 30) * 60_000);
    const dup = await db().list('notifications', { where: [['dedupeKey', '==', n.dedupeKey], ['createdAt', '>=', since]], limit: 1 });
    if (dup.items.length) return;
  }
  await db().create('notifications', { kind: n.kind, title: n.title, message: n.message, severity: n.severity ?? 'info', link: n.link ?? null, audience: n.audience ?? ADMINS, readBy: [], dedupeKey: n.dedupeKey ?? null });
}
