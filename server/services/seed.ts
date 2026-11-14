import { db } from '../store/index.js';
import { SEED_CATEGORIES, SEED_LEARNING_SITES, SEED_POLICIES } from '../../shared/defaults.js';
import { getSettings } from './settings.js';
import { config } from '../config.js';
import { jakartaDayKey, jakartaToDate } from '../utils.js';
import { markSetup } from './settings.js';
import type { Collection } from '../store/types.js';

/** Seed data referensi (kategori, daftar domain, profil bawaan). Idempoten. Ini BUKAN data contoh. */
export async function ensureBaseSeed() {
  await getSettings(true);
  const catIds = new Map<string, string>();
  for (const c of SEED_CATEGORIES) {
    const existing = (await db().list('websiteCategories', { where: [['slug', '==', c.slug]], limit: 1 })).items[0];
    if (existing) { catIds.set(c.slug, existing.id); continue; }
    const doc = await db().create('websiteCategories', { slug: c.slug, name: c.name, description: c.description, core: c.core, enabled: true, createdBy: 'system' }, `cat-${c.slug}`);
    catIds.set(c.slug, doc.id);
    for (const d of c.domains) await db().create('blockedDomains', { domain: d, categoryId: doc.id, includeSubdomains: true, core: c.core, createdBy: 'system' });
  }
  if (!(await db().count('allowedDomains'))) {
    for (const d of SEED_LEARNING_SITES) await db().create('allowedDomains', { domain: d, note: 'Situs pembelajaran (seed awal — tinjau kembali)', scope: 'global', labIds: [], temporary: false, validFrom: null, expiresAt: null, createdBy: 'system' });
  }
  for (const p of SEED_POLICIES) {
    if (await db().get('policies', `policy-${p.key}`)) continue;
    await db().create('policies', {
      name: p.name, description: p.description, type: p.type, builtin: true, active: true, googleSearch: p.googleSearch, safeSearch: true,
      includeGlobalAllowlist: p.includeGlobalAllowlist, ipEnforcement: p.ipEnforcement,
      blockedCategoryIds: p.blockedCategorySlugs.map((s) => catIds.get(s)).filter(Boolean), allowedDomains: p.allowedDomains, blockedDomains: [], allowedUrls: [], blockedUrls: [],
      schedule: null, targetClassIds: [], targetLabIds: [], revision: 1, createdBy: 'system',
    }, `policy-${p.key}`);
  }
}

/** Akun DEMO (hanya AUTH_MODE=demo). */
export async function ensureDemoUsers() {
  if (!config.isDemoAuth) return;
  const users = [
    { id: 'demo-superadmin', displayName: 'Super Admin (DEMO)', email: 'superadmin@demo.labguard', role: 'super_admin' },
    { id: 'demo-labadmin', displayName: 'Admin Lab (DEMO)', email: 'labadmin@demo.labguard', role: 'lab_admin' },
    { id: 'demo-guru', displayName: 'Bu Sari — Guru (DEMO)', email: 'guru@demo.labguard', role: 'teacher' },
    { id: 'demo-viewer', displayName: 'Pengawas (DEMO)', email: 'viewer@demo.labguard', role: 'viewer' },
  ];
  for (const u of users) if (!(await db().get('users', u.id))) await db().create('users', { ...u, active: true, labIds: [], demo: true }, u.id);
  await markSetup('superAdmin', true, 'system');
}

const DEMO_COLS: Collection[] = ['laboratories', 'classes', 'students', 'devices', 'sessions', 'permissionRequests', 'accessLogs', 'gateways'];

/** Muat data CONTOH berlabel DEMO. Tidak ada heartbeat/konfirmasi palsu: gateway demo tetap UNPAIRED/offline. */
export async function loadDemoData(uid: string) {
  if (await db().count('laboratories', [['demo', '==', true]])) return { skipped: true };
  const gsoId = 'policy-google-search-only';
  const labA = await db().create('laboratories', { name: 'Lab Komputer 1 (DEMO)', code: 'LAB1-DEMO', location: 'Gedung A Lt. 2', capacity: 36, subnet: '192.168.10.0/24', gatewayId: null, defaultPolicyId: gsoId, activePolicyId: gsoId, activeSessionId: null, demo: true, createdBy: uid });
  const labB = await db().create('laboratories', { name: 'Lab Komputer 2 (DEMO)', code: 'LAB2-DEMO', location: 'Gedung B Lt. 1', capacity: 30, subnet: '192.168.20.0/24', gatewayId: null, defaultPolicyId: gsoId, activePolicyId: gsoId, activeSessionId: null, demo: true, createdBy: uid });
  const classes = [] as any[];
  for (const [name, grade, major] of [['X TKJ 1', 'X', 'Teknik Komputer & Jaringan'], ['XI RPL 2', 'XI', 'Rekayasa Perangkat Lunak'], ['XII MM 1', 'XII', 'Multimedia']]) {
    classes.push(await db().create('classes', { name: `${name} (DEMO)`, grade, major, homeroomTeacher: 'Wali Kelas Contoh', studentCount: 0, defaultLabId: labA.id, demo: true, createdBy: uid }));
  }
  const names = ['Ahmad Fauzi', 'Siti Aisyah', 'Budi Santoso', 'Dewi Lestari', 'Rizky Pratama', 'Nur Hidayah', 'Fajar Nugroho', 'Putri Ramadhani', 'Yusuf Maulana', 'Aulia Rahma', 'Dimas Saputra', 'Intan Permata'];
  let n = 0;
  for (const c of classes) {
    for (let i = 0; i < 4; i++) { n++; await db().create('students', { nis: `DEMO${String(n).padStart(4, '0')}`, name: `${names[(n - 1) % names.length]} (DEMO)`, classId: c.id, major: c.major, active: true, demo: true, createdBy: uid }); }
    await db().update('classes', c.id, { studentCount: 4 });
  }
  for (let i = 1; i <= 8; i++) {
    const lab = i <= 5 ? labA : labB;
    await db().create('devices', { name: `PC-LAB${i <= 5 ? 1 : 2}-${String(i).padStart(2, '0')}`, inventoryNo: `INV-DEMO-${100 + i}`, mac: null, ip: `${lab.subnet.split('.').slice(0, 3).join('.')}.${100 + i}`, os: 'Windows 11 Pro', browser: 'Google Chrome', labId: lab.id, classId: null, group: 'Baris ' + Math.ceil(i / 4), gatewayId: null, status: 'active', credentialStatus: 'none', lastSeenAt: null, appliedPolicyVersion: null, policyApplyStatus: 'NOT_CONFIGURED', demo: true, createdBy: uid });
  }
  const today = jakartaDayKey();
  const teacher = (await db().get('users', 'demo-guru')) ?? { id: uid, displayName: 'Guru' };
  for (const [name, subject, st, en, cls] of [['Praktikum Jaringan Dasar', 'Komputer & Jaringan Dasar', '08:00', '09:30', 0], ['Riset Materi Sejarah', 'Sejarah Indonesia', '10:00', '11:30', 1], ['Desain Grafis', 'Dasar Desain Grafis', '13:00', '14:30', 2]] as const) {
    await db().create('sessions', { name: `${name} (DEMO)`, subject, teacherId: teacher.id, teacherName: teacher.displayName, classId: classes[cls].id, labId: labA.id, date: today, startTime: st, endTime: en, startAt: jakartaToDate(today, st), endAt: jakartaToDate(today, en), computerCount: 5, policyId: gsoId, status: 'SCHEDULED', securityStatus: 'NOT_STARTED', autoStart: false, deploymentIds: [], demo: true, createdBy: uid });
  }
  // Log contoh — jelas berlabel DEMO, tidak berasal dari gateway nyata.
  const domains: [string, 'ALLOWED' | 'BLOCKED', string][] = [['www.google.com', 'ALLOWED', 'Google Search'], ['youtube.com', 'BLOCKED', 'Video dan Streaming'], ['www.tiktok.com', 'BLOCKED', 'Video dan Streaming'], ['instagram.com', 'BLOCKED', 'Media Sosial'], ['drive.google.com', 'BLOCKED', 'Layanan Google Selain Search'], ['roblox.com', 'BLOCKED', 'Permainan Online'], ['id.wikipedia.org', 'BLOCKED', 'Default deny']];
  let logs = 0;
  for (let d = 6; d >= 0; d--) {
    const day = jakartaDayKey(new Date(Date.now() - d * 86_400_000));
    const count = 12 + ((d * 7) % 9);
    for (let i = 0; i < count; i++) {
      const [domain, type, category] = domains[(i * 3 + d) % domains.length];
      const ts = jakartaToDate(day, `${String(8 + (i % 6)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`);
      if (ts.getTime() > Date.now()) continue;
      await db().create('accessLogs', { ts, type, deviceName: `PC-LAB1-0${(i % 5) + 1}`, labId: labA.id, domain, category, reason: type === 'BLOCKED' ? `DEMO — contoh pemblokiran (${category})` : 'DEMO — contoh akses diizinkan', policyName: 'GOOGLE SEARCH ONLY', dayKey: day, demo: true });
      const key = domain.includes('google.com') && type === 'ALLOWED' ? 'google' : domain.includes('youtube') ? 'youtube' : domain.includes('tiktok') ? 'tiktok' : 'other';
      await db().increment('dailyStats', `demo-${day}`, { total: 1, [type === 'BLOCKED' ? 'blocked' : 'allowed']: 1, [`sites.${key}.${type === 'BLOCKED' ? 'blocked' : 'allowed'}`]: 1 }, { dayKey: day, demo: true });
      logs++;
    }
  }
  await db().create('permissionRequests', { siteName: 'GeoGebra (DEMO)', url: 'https://www.geogebra.org', domain: 'geogebra.org', reason: 'Praktik grafik fungsi kuadrat (contoh DEMO)', subject: 'Matematika', classId: classes[0].id, labId: labA.id, date: today, startTime: '13:00', endTime: '14:30', validFrom: jakartaToDate(today, '13:00'), validUntil: jakartaToDate(today, '14:30'), status: 'PENDING', requestedBy: teacher.id, requestedByName: teacher.displayName, blockedBy: null, demo: true, createdBy: teacher.id });
  return { laboratories: 2, classes: 3, students: n, devices: 8, sessions: 3, accessLogs: logs };
}

export async function clearDemoData() {
  const out: Record<string, number> = {};
  for (const c of DEMO_COLS) {
    let total = 0, k = 0;
    do { k = await db().deleteWhere(c, [['demo', '==', true]], 400); total += k; } while (k > 0);
    out[c] = total;
  }
  out.dailyStats = await db().deleteWhere('dailyStats', [['demo', '==', true]], 400);
  return out;
}
