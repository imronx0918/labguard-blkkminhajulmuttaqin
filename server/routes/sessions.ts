import { Router } from 'express';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { pageQuery, sessionSchema } from '../validators/index.js';
import { audit } from '../services/audit.js';
import { startSession, stopSession } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';
import { can } from '../../shared/roles.js';
import { badRequest, conflict, forbidden, jakartaToDate, notFound } from '../utils.js';
import { withOnline } from './devices.js';
import type { Request } from 'express';
import type { Where } from '../store/types.js';

const r = Router();

function assertOwnerOrManager(req: Request, s: any) {
  if (can(req.user!.role, 'sessions.manageAll')) return;
  if (s.teacherId !== req.user!.uid) throw forbidden('Guru hanya dapat mengelola sesi miliknya sendiri');
}

async function validateRefs(d: any) {
  const [cls, lab, pol] = await Promise.all([db().get('classes', d.classId), db().get('laboratories', d.labId), db().get('policies', d.policyId)]);
  if (!cls) throw badRequest('Kelas tidak ditemukan');
  if (!lab) throw badRequest('Laboratorium tidak ditemukan');
  if (!pol || !pol.active) throw badRequest('Profil kebijakan tidak ditemukan atau tidak aktif');
  return { cls, lab, pol };
}

async function assertNoOverlap(d: any, ignoreId?: string) {
  const startAt = jakartaToDate(d.date, d.startTime), endAt = jakartaToDate(d.date, d.endTime);
  const same = await db().list('sessions', { where: [['labId', '==', d.labId], ['date', '==', d.date]], limit: 200 });
  const clash = same.items.find((s) => s.id !== ignoreId && ['SCHEDULED', 'ACTIVE'].includes(s.status) && Date.parse(s.startAt) < endAt.getTime() && Date.parse(s.endAt) > startAt.getTime());
  if (clash) throw conflict(`Jadwal bentrok dengan sesi "${clash.name}" (${clash.startTime}–${clash.endTime})`);
  return { startAt, endAt };
}

r.get('/', requirePermission('sessions.view'), ah(async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);
  const where: Where[] = [];
  for (const f of ['status', 'labId', 'classId', 'teacherId', 'date'] as const) if (typeof req.query[f] === 'string' && req.query[f]) where.push([f, '==', req.query[f]]);
  if (typeof req.query.from === 'string' && req.query.from) where.push(['startAt', '>=', jakartaToDate(req.query.from, '00:00')]);
  if (typeof req.query.to === 'string' && req.query.to) where.push(['startAt', '<', jakartaToDate(req.query.to, '23:59')]);
  res.json(await db().list('sessions', { where, orderBy: { field: 'startAt', dir: req.query.order === 'asc' ? 'asc' : 'desc' }, limit, cursor }));
}));

r.get('/:id', requirePermission('sessions.view'), ah(async (req, res) => {
  const s = await db().get('sessions', req.params.id);
  if (!s) throw notFound('Sesi');
  const links = (await db().list('sessionDevices', { where: [['sessionId', '==', s.id]], limit: 500 })).items;
  const devices = (await db().getMany('devices', links.map((l) => l.deviceId))).map(withOnline);
  const deployments = await db().getMany('policyDeployments', s.deploymentIds ?? []);
  const students = links.some((l) => l.studentId) ? await db().getMany('students', links.filter((l) => l.studentId).map((l) => l.studentId)) : [];
  res.json({ ...s, devices: devices.map((d) => ({ ...d, studentId: links.find((l) => l.deviceId === d.id)?.studentId ?? null })), deployments, students });
}));

r.post('/', requirePermission('sessions.create'), ah(async (req, res) => {
  const d = sessionSchema.parse(req.body);
  const settings = await getSettings();
  if (req.user!.role === 'teacher' && !settings.security.allowTeacherCreateSession) throw forbidden('Pembuatan sesi oleh guru dinonaktifkan oleh admin');
  // Guru hanya dapat membuat sesi atas namanya sendiri
  const teacherId = can(req.user!.role, 'sessions.manageAll') && d.teacherId ? d.teacherId : req.user!.uid;
  const teacher = await db().get('users', teacherId);
  if (!teacher) throw badRequest('Guru pengampu tidak ditemukan');
  await validateRefs(d);
  const { startAt, endAt } = await assertNoOverlap(d);
  const doc = await db().create('sessions', { ...d, teacherId, teacherName: teacher.displayName, startAt, endAt, status: 'SCHEDULED', securityStatus: 'NOT_STARTED', deploymentIds: [], startedAt: null, endedAt: null, createdBy: req.user!.uid });
  await audit(req, 'SESSION_CREATE', { targetId: doc.id, details: { name: d.name, date: d.date, labId: d.labId } });
  res.status(201).json(doc);
}));

r.put('/:id', requirePermission('sessions.create'), ah(async (req, res) => {
  const prev = await db().get('sessions', req.params.id);
  if (!prev) throw notFound('Sesi');
  assertOwnerOrManager(req, prev);
  if (prev.status !== 'SCHEDULED') throw badRequest('Hanya sesi terjadwal yang dapat diubah');
  const d = sessionSchema.parse({ ...prev, ...req.body });
  await validateRefs(d);
  const { startAt, endAt } = await assertNoOverlap(d, prev.id);
  const teacherId = can(req.user!.role, 'sessions.manageAll') && d.teacherId ? d.teacherId : prev.teacherId;
  const teacher = await db().get('users', teacherId);
  const doc = await db().update('sessions', prev.id, { ...d, teacherId, teacherName: teacher?.displayName ?? prev.teacherName, startAt, endAt });
  await audit(req, 'SESSION_UPDATE', { targetId: prev.id, details: { name: d.name } });
  res.json(doc);
}));

r.post('/:id/start', requirePermission('sessions.run'), ah(async (req, res) => {
  const s = await db().get('sessions', req.params.id);
  if (!s) throw notFound('Sesi');
  assertOwnerOrManager(req, s);
  res.json(await startSession(req, s.id, req.user!.uid));
}));

r.post('/:id/stop', requirePermission('sessions.run'), ah(async (req, res) => {
  const s = await db().get('sessions', req.params.id);
  if (!s) throw notFound('Sesi');
  assertOwnerOrManager(req, s);
  res.json(await stopSession(req, s.id, req.user!.uid));
}));

r.post('/:id/cancel', requirePermission('sessions.create'), ah(async (req, res) => {
  const s = await db().get('sessions', req.params.id);
  if (!s) throw notFound('Sesi');
  assertOwnerOrManager(req, s);
  if (s.status !== 'SCHEDULED') throw badRequest('Hanya sesi terjadwal yang dapat dibatalkan');
  const doc = await db().update('sessions', s.id, { status: 'CANCELLED' });
  await audit(req, 'SESSION_CANCEL', { targetId: s.id, details: { name: s.name } });
  res.json(doc);
}));

/** Hubungkan peserta didik dengan perangkat dalam sesi (opsional). */
r.post('/:id/assign', requirePermission('sessions.run'), ah(async (req, res) => {
  const s = await db().get('sessions', req.params.id);
  if (!s) throw notFound('Sesi');
  assertOwnerOrManager(req, s);
  const { z } = await import('zod');
  const { assignments } = z.object({ assignments: z.array(z.object({ deviceId: z.string().max(128), studentId: z.string().max(128).nullable() })).max(500) }).parse(req.body);
  for (const a of assignments) {
    if (a.studentId) { const st = await db().get('students', a.studentId); if (!st || st.classId !== s.classId) throw badRequest('Peserta didik bukan anggota kelas sesi'); }
    await db().set('sessionDevices', `${s.id}_${a.deviceId}`, { sessionId: s.id, deviceId: a.deviceId, studentId: a.studentId });
  }
  await audit(req, 'SESSION_ASSIGN_STUDENTS', { targetId: s.id, details: { count: assignments.length } });
  res.json({ ok: true });
}));

export default r;
