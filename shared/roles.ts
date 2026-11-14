// Matriks hak akses berbasis peran. Diperiksa di BACKEND (middleware requirePermission)
// dan dipakai frontend hanya untuk menyembunyikan menu (bukan sebagai pengaman).
export const ROLES = ['super_admin', 'lab_admin', 'teacher', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  lab_admin: 'Admin Laboratorium',
  teacher: 'Guru',
  viewer: 'Viewer / Pengawas',
};

export const PERMISSIONS = [
  'dashboard.view',
  'devices.view', 'devices.manage',
  'students.view', 'students.manage',
  'classes.view', 'classes.manage',
  'labs.view', 'labs.manage',
  'sessions.view', 'sessions.create', 'sessions.run', 'sessions.manageAll',
  'policies.view', 'policies.manage', 'policies.core', 'policies.rollback',
  'sites.view', 'sites.manage', 'sites.core',
  'permissionRequests.create', 'permissionRequests.review', 'permissionRequests.coreOverride',
  'logs.view', 'audit.view',
  'gateways.view', 'gateways.test', 'gateways.manage',
  'reports.view',
  'users.view', 'users.manage',
  'settings.view', 'settings.manage', 'system.mode', 'backup.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const LAB_ADMIN: Permission[] = [
  'dashboard.view', 'devices.view', 'devices.manage', 'students.view', 'students.manage',
  'classes.view', 'classes.manage', 'labs.view',
  'sessions.view', 'sessions.create', 'sessions.run', 'sessions.manageAll',
  'policies.view', 'policies.manage', 'sites.view', 'sites.manage',
  'permissionRequests.create', 'permissionRequests.review',
  'logs.view', 'gateways.view', 'gateways.test', 'reports.view', 'users.view', 'settings.view', 'audit.view',
];
const TEACHER: Permission[] = [
  'dashboard.view', 'devices.view', 'classes.view', 'labs.view', 'students.view',
  'sessions.view', 'sessions.create', 'sessions.run', 'policies.view', 'sites.view',
  'permissionRequests.create',
];
const VIEWER: Permission[] = ['dashboard.view', 'devices.view', 'labs.view', 'classes.view', 'sessions.view', 'reports.view', 'logs.view'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(PERMISSIONS),
  lab_admin: new Set(LAB_ADMIN),
  teacher: new Set(TEACHER),
  viewer: new Set(VIEWER),
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}
