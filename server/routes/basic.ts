import { Router } from 'express';
import { z } from 'zod';
import { crudRouter } from './crud.js';
import { classSchema, labSchema, studentSchema, id } from '../validators/index.js';
import { db } from '../store/index.js';
import { requirePermission } from '../middleware/auth.js';
import { ah } from '../middleware/errors.js';
import { audit } from '../services/audit.js';
import { badRequest, conflict } from '../utils.js';
import { requestDeployment } from '../services/policyEngine.js';
import { markSetup } from '../services/settings.js';

async function recountClass(classId?: string | null) {
  if (!classId) return;
  const n = await db().count('students', [['classId', '==', classId], ['active', '==', true]]);
  await db().update('classes', classId, { studentCount: n });
}

export const studentsRouter = Router();
studentsRouter.post('/import', requirePermission('students.manage'), ah(async (req, res) => {
  // Import Excel: frontend mem-parsing file .xlsx lalu mengirim baris JSON ke sini (divalidasi per baris).
  const rows = z.array(z.record(z.any())).max(2000).parse(req.body?.rows);
  const classes = (await db().list('classes', { limit: 1000 })).items;
  const byName = new Map(classes.map((c) => [String(c.name).toLowerCase(), c.id]));
  const result = { created: 0, updated: 0, errors: [] as { row: number; message: string }[] };
  const touched = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const className = String(r.kelas ?? r.Kelas ?? r.class ?? '').trim().toLowerCase();
    const parsed = studentSchema.safeParse({
      nis: String(r.nis ?? r.NIS ?? '').trim(), name: String(r.nama ?? r.Nama ?? r.name ?? '').trim(),
      classId: byName.get(className) ?? '', major: String(r.jurusan ?? r.Jurusan ?? r.major ?? '').trim(),
      active: !/^(tidak|nonaktif|false|0)$/i.test(String(r.status ?? r.Status ?? 'aktif')),
    });
    if (!parsed.success) { result.errors.push({ row: i + 2, message: byName.get(className) ? parsed.error.issues[0].message : `Kelas "${className}" tidak ditemukan` }); continue; }
    const existing = (await db().list('students', { where: [['nis', '==', parsed.data.nis]], limit: 1 })).items[0];
    if (existing) { await db().update('students', existing.id, parsed.data); result.updated++; touched.add(existing.classId); }
    else { await db().create('students', { ...parsed.data, createdBy: req.user!.uid }); result.created++; }
    touched.add(parsed.data.classId);
  }
  for (const c of touched) await recountClass(c);
  await audit(req, 'STUDENTS_IMPORT', { details: { created: result.created, updated: result.updated, errors: result.errors.length } });
  res.json(result);
}));
studentsRouter.use(crudRouter({
  col: 'students', label: 'Peserta didik', schema: studentSchema, view: 'students.view', manage: 'students.manage',
  filters: ['classId', 'active'], searchFields: ['name', 'nis', 'major'], unique: 'nis',
  afterWrite: async (doc, _req, prev) => { await recountClass(doc.classId); if (prev && prev.classId !== doc.classId) await recountClass(prev.classId); },
  beforeDelete: async () => {},
}));

export const classesRouter = crudRouter({
  col: 'classes', label: 'Kelas', schema: classSchema, view: 'classes.view', manage: 'classes.manage', searchFields: ['name', 'major', 'homeroomTeacher'], unique: 'name',
  beforeWrite: (d, _req, prev) => (prev ? d : { ...d, studentCount: 0 }),
  beforeDelete: async (doc) => {
    if (await db().count('students', [['classId', '==', doc.id]])) throw conflict('Kelas masih memiliki peserta didik. Pindahkan atau hapus peserta didik terlebih dahulu.');
  },
});

export const labsRouter = Router();
labsRouter.use(crudRouter({
  col: 'laboratories', label: 'Laboratorium', schema: labSchema, view: 'labs.view', manage: 'labs.manage', searchFields: ['name', 'code', 'location'], unique: 'code',
  beforeWrite: async (d, _req, prev) => {
    if (d.gatewayId) { const gw = await db().get('gateways', d.gatewayId); if (!gw) throw badRequest('Gateway tidak ditemukan'); }
    if (d.defaultPolicyId) { const p = await db().get('policies', d.defaultPolicyId); if (!p) throw badRequest('Profil kebijakan tidak ditemukan'); }
    return prev ? d : { ...d, activeSessionId: null, activePolicyId: d.defaultPolicyId ?? null };
  },
  afterWrite: async (doc, req, prev) => {
    await markSetup('laboratory', true, req.user!.uid);
    // sinkronkan relasi gateway.labIds
    if (prev?.gatewayId && prev.gatewayId !== doc.gatewayId) {
      const g = await db().get('gateways', prev.gatewayId);
      if (g) await db().update('gateways', g.id, { labIds: (g.labIds ?? []).filter((x: string) => x !== doc.id) });
    }
    if (doc.gatewayId) {
      const g = await db().get('gateways', doc.gatewayId);
      if (g && !(g.labIds ?? []).includes(doc.id)) await db().update('gateways', g.id, { labIds: [...(g.labIds ?? []), doc.id] });
    }
    if (!prev || prev.defaultPolicyId !== doc.defaultPolicyId || prev.gatewayId !== doc.gatewayId || prev.subnet !== doc.subnet)
      await requestDeployment({ labIds: [doc.id], reason: 'LAB_CONFIG_CHANGED', actor: req.user!.uid });
  },
  beforeDelete: async (doc) => {
    if (doc.activeSessionId) throw conflict('Laboratorium sedang memiliki sesi aktif');
    if (await db().count('devices', [['labId', '==', doc.id]])) throw conflict('Masih ada perangkat di laboratorium ini. Pindahkan perangkat terlebih dahulu.');
    if (doc.gatewayId) { const g = await db().get('gateways', doc.gatewayId); if (g) await db().update('gateways', g.id, { labIds: (g.labIds ?? []).filter((x: string) => x !== doc.id) }); }
  },
}));

// Mapping kelas → laboratorium
classesRouter.post('/:id/map-lab', requirePermission('classes.manage'), ah(async (req, res) => {
  const { labId } = z.object({ labId: id.nullable() }).parse(req.body);
  if (labId && !(await db().get('laboratories', labId))) throw badRequest('Laboratorium tidak ditemukan');
  const doc = await db().update('classes', req.params.id, { defaultLabId: labId });
  await audit(req, 'CLASS_MAP_LAB', { targetId: req.params.id, details: { labId } });
  res.json(doc);
}));
