import { db } from '../store/index.js';
import type { LabSession, PolicyDeployment } from '../../shared/types.js';
import { requestDeployment } from './policyEngine.js';
import { getSettings } from './settings.js';
import { conflict, badRequest, notFound } from '../utils.js';
import { audit } from './audit.js';
import type { Request } from 'express';

export function securityFromDeployments(deps: PolicyDeployment[], mode: string): { status: LabSession['securityStatus']; detail: string } {
  if (mode !== 'LIVE') return { status: 'SIMULATED_DEMO', detail: 'MODE DEMO: konfigurasi hanya disimulasikan, tidak ada perubahan jaringan.' };
  if (!deps.length || deps.some((d) => d.status === 'NO_GATEWAY')) return { status: 'NO_GATEWAY', detail: 'Laboratorium belum terhubung dengan gateway. Sesi BELUM diamankan.' };
  if (deps.some((d) => d.status === 'FAILED' || d.status === 'ROLLED_BACK')) return { status: 'FAILED', detail: deps.find((d) => d.error)?.error ?? 'Gateway gagal menerapkan kebijakan.' };
  if (deps.every((d) => d.status === 'CONFIRMED')) return { status: 'SECURED', detail: 'Gateway mengonfirmasi kebijakan sesi telah diterapkan.' };
  return { status: 'PENDING_CONFIRMATION', detail: 'Menunggu konfirmasi gateway. Sesi belum dinyatakan aman.' };
}

export async function startSession(req: Request | null, id: string, actor: string) {
  const s = (await db().get('sessions', id)) as LabSession | null;
  if (!s) throw notFound('Sesi');
  if (s.status !== 'SCHEDULED') throw badRequest(`Sesi berstatus ${s.status} tidak dapat dimulai`);
  const lab = await db().get('laboratories', s.labId);
  if (!lab) throw badRequest('Laboratorium sesi tidak ditemukan');
  if (lab.activeSessionId && lab.activeSessionId !== id) {
    const other = await db().get('sessions', lab.activeSessionId);
    if (other?.status === 'ACTIVE') throw conflict(`Laboratorium sedang dipakai sesi "${other.name}". Akhiri sesi tersebut terlebih dahulu.`);
  }
  await db().update('sessions', id, { status: 'ACTIVE', startedAt: new Date() });
  await db().update('laboratories', s.labId, { activeSessionId: id, activePolicyId: s.policyId });
  // Petakan perangkat lab ke sesi
  const devs = await db().list('devices', { where: [['labId', '==', s.labId], ['status', '==', 'active']], limit: 500 });
  const chosen = s.computerCount > 0 ? devs.items.slice(0, s.computerCount) : devs.items;
  for (const d of chosen) await db().create('sessionDevices', { sessionId: id, deviceId: d.id, studentId: null }, `${id}_${d.id}`);
  const deps = await requestDeployment({ labIds: [s.labId], reason: `SESSION_START:${s.name}`, actor, sessionId: id, force: true });
  const settings = await getSettings();
  const sec = securityFromDeployments(deps, settings.mode);
  const updated = await db().update('sessions', id, { deploymentIds: deps.map((d) => d.id), securityStatus: sec.status, securityDetail: sec.detail });
  await audit(req, 'SESSION_START', { target: `sessions/${id}`, targetId: id, details: { name: s.name, labId: s.labId, policyId: s.policyId, security: sec.status } });
  return updated;
}

export async function stopSession(req: Request | null, id: string, actor: string, reason = 'manual') {
  const s = (await db().get('sessions', id)) as LabSession | null;
  if (!s) throw notFound('Sesi');
  if (s.status !== 'ACTIVE') throw badRequest(`Sesi berstatus ${s.status} tidak dapat diakhiri`);
  await db().update('sessions', id, { status: 'ENDED', endedAt: new Date() });
  const lab = await db().get('laboratories', s.labId);
  if (lab?.activeSessionId === id) await db().update('laboratories', s.labId, { activeSessionId: null, activePolicyId: lab.defaultPolicyId ?? null });
  // Hapus perubahan sementara yang terikat sesi ini
  const temps = await db().list('allowedDomains', { where: [['sessionId', '==', id]], limit: 200 });
  for (const t of temps.items) {
    await db().delete('allowedDomains', t.id);
    if (t.permissionRequestId) await db().update('permissionRequests', t.permissionRequestId, { status: 'EXPIRED' });
  }
  const deps = await requestDeployment({ labIds: [s.labId], reason: `SESSION_END:${s.name}`, actor, sessionId: null, force: true });
  await audit(req, 'SESSION_STOP', { target: `sessions/${id}`, targetId: id, details: { name: s.name, reason, revertDeployments: deps.map((d) => d.id), removedTemporaryRules: temps.items.length } });
  return db().get('sessions', id);
}

/** Dipanggil setelah gateway melaporkan hasil penerapan. */
export async function refreshSessionsForDeployment(depId: string) {
  const settings = await getSettings();
  const sess = await db().list('sessions', { where: [['deploymentIds', 'array-contains', depId]], limit: 20 });
  for (const s of sess.items) {
    if (s.status !== 'ACTIVE') continue;
    const deps = (await db().getMany('policyDeployments', s.deploymentIds ?? [])) as PolicyDeployment[];
    const sec = securityFromDeployments(deps, settings.mode);
    await db().update('sessions', s.id, { securityStatus: sec.status, securityDetail: sec.detail });
  }
}
