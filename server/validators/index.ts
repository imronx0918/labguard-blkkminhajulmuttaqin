import { z } from 'zod';
import { isValidDomain, isValidUrlFilter, normalizeDomain } from '../../shared/domain.js';
import { ROLES } from '../../shared/roles.js';
import { GATEWAY_COMMANDS, LOG_TYPES } from '../../shared/types.js';

// Sanitasi: trim, hapus karakter kontrol & tag HTML sederhana
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>]/g, '').trim();
export const str = (max = 200) => z.string().max(max).transform(clean);
export const reqStr = (max = 200) => z.string().min(1, 'Wajib diisi').max(max).transform(clean).refine((s) => s.length > 0, 'Wajib diisi');
export const optStr = (max = 200) => z.string().max(max).transform(clean).optional().nullable();
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'ID tidak valid');
export const optId = z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
export const domain = z.string().max(253).transform(normalizeDomain).refine(isValidDomain, 'Domain tidak valid');
export const urlFilter = z.string().max(500).trim().refine(isValidUrlFilter, 'Pola URL tidak valid (format: [scheme://][.]host[/path])');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:mm');
const ipv4 = z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'IP tidak valid');
const cidr = z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, 'Subnet harus format CIDR, mis. 192.168.10.0/24');

export const studentSchema = z.object({ nis: reqStr(30), name: reqStr(120), classId: id, major: str(80).default(''), active: z.boolean().default(true) });
export const classSchema = z.object({ name: reqStr(60), grade: reqStr(20), major: str(80).default(''), homeroomTeacher: str(120).default(''), defaultLabId: optId });
export const labSchema = z.object({ name: reqStr(80), code: reqStr(20), location: str(120).default(''), capacity: z.coerce.number().int().min(0).max(1000).default(0), subnet: z.union([cidr, z.literal('')]).default(''), gatewayId: optId, defaultPolicyId: optId });
export const deviceSchema = z.object({
  name: reqStr(60), inventoryNo: str(60).default(''), mac: z.union([z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, 'MAC tidak valid'), z.literal('')]).optional().transform((v) => v || null),
  ip: z.union([ipv4, z.literal('')]).optional().transform((v) => v || null), os: str(80).optional(), browser: str(80).optional(),
  labId: optId, classId: optId, group: str(60).optional(), gatewayId: optId,
});
export const userCreateSchema = z.object({ email: z.string().email().max(200), displayName: reqStr(120), role: z.enum(ROLES), labIds: z.array(id).max(50).default([]), password: z.string().min(8).max(128).optional() });
export const userUpdateSchema = z.object({ displayName: reqStr(120).optional(), role: z.enum(ROLES).optional(), active: z.boolean().optional(), labIds: z.array(id).max(50).optional() });

export const categorySchema = z.object({ name: reqStr(80), slug: z.string().regex(/^[a-z0-9-]{2,40}$/), description: str(300).default(''), core: z.boolean().default(false), enabled: z.boolean().default(true) });
export const blockedDomainSchema = z.object({ domain, categoryId: id, includeSubdomains: z.boolean().default(true), note: str(200).optional() });
export const blockedBulkSchema = z.object({ categoryId: id, domains: z.array(z.string().max(253)).min(1).max(500) });
export const allowedDomainSchema = z.object({ domain, note: str(200).optional(), scope: z.enum(['global', 'lab']).default('global'), labIds: z.array(id).max(50).default([]) });

const schedule = z.object({ days: z.array(z.number().int().min(0).max(6)).max(7), start: time, end: time }).nullable().optional();
export const policySchema = z.object({
  name: reqStr(80), description: str(400).default(''), active: z.boolean().default(true), googleSearch: z.boolean().default(true), safeSearch: z.boolean().default(true),
  includeGlobalAllowlist: z.boolean().default(false), ipEnforcement: z.boolean().default(false),
  blockedCategoryIds: z.array(id).max(50).default([]), allowedDomains: z.array(domain).max(500).default([]), blockedDomains: z.array(domain).max(1000).default([]),
  allowedUrls: z.array(urlFilter).max(500).default([]), blockedUrls: z.array(urlFilter).max(1000).default([]),
  schedule, targetClassIds: z.array(id).max(100).default([]), targetLabIds: z.array(id).max(100).default([]),
});

export const sessionSchema = z.object({
  name: reqStr(120), subject: reqStr(80), teacherId: id.optional(), classId: id, labId: id, date, startTime: time, endTime: time,
  computerCount: z.coerce.number().int().min(0).max(1000).default(0), policyId: id, autoStart: z.boolean().default(false),
}).refine((s) => s.startTime < s.endTime, { message: 'Jam selesai harus setelah jam mulai', path: ['endTime'] });

export const permissionRequestSchema = z.object({
  siteName: reqStr(120), url: z.string().max(500).trim().min(4), reason: reqStr(1000), subject: reqStr(80), classId: id, labId: id,
  date, startTime: time, endTime: time,
}).refine((s) => s.startTime < s.endTime, { message: 'Jam selesai harus setelah jam mulai', path: ['endTime'] });
export const approveSchema = z.object({ note: str(500).optional(), date: date.optional(), startTime: time.optional(), endTime: time.optional(), overrideAdminBlock: z.boolean().default(false), coreOverride: z.boolean().default(false) });
export const rejectSchema = z.object({ note: reqStr(500) });

export const gatewaySchema = z.object({ name: reqStr(80), location: str(120).default(''), labIds: z.array(id).max(50).default([]), adapter: z.enum(['linux-nftables-dnsmasq', 'mikrotik-routeros-rest']).default('linux-nftables-dnsmasq') });
export const gatewayCommandSchema = z.object({ type: z.enum(GATEWAY_COMMANDS) });

// ----- Agent (gateway) payloads
export const pairSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/), hostname: str(120), agentVersion: str(30), localIp: z.union([ipv4, z.literal('')]).optional() });
const comp = z.object({ state: z.enum(['OK', 'ERROR', 'DISABLED', 'NOT_CONFIGURED', 'UNKNOWN']), detail: str(300).optional() });
export const heartbeatSchema = z.object({
  agentVersion: str(30), localIp: z.union([ipv4, z.literal('')]).optional(), appliedPolicyVersion: z.number().int().nullable(),
  appliedBundleHash: z.string().max(80).nullable().optional(), dns: comp, firewall: comp, filtering: comp,
  protections: z.array(z.object({ key: str(40), label: str(120), active: z.boolean(), note: str(300).optional() })).max(30).default([]),
  clients: z.array(z.object({ ip: ipv4, mac: z.string().max(20).optional() })).max(1000).default([]),
  uptimeSec: z.number().int().min(0).optional(), completedCommandIds: z.array(z.string().max(64)).max(50).default([]),
});
export const eventsSchema = z.object({
  events: z.array(z.object({
    ts: z.string().datetime({ offset: true }), type: z.enum(LOG_TYPES), clientIp: z.union([ipv4, z.literal('')]).optional(),
    domain: z.string().max(253).optional().nullable(), category: str(80).optional().nullable(), reason: str(200).optional().nullable(),
    labId: optId, policyVersion: z.number().int().nullable().optional(),
  })).max(500),
});
const check = z.object({ name: str(120), layer: z.enum(['DNS', 'FIREWALL', 'BROWSER', 'SYSTEM']), target: str(200), expected: str(40), actual: str(40), passed: z.boolean() });
export const applyResultSchema = z.object({
  deploymentId: id.optional().nullable(), version: z.number().int(), bundleHash: z.string().max(80), success: z.boolean(), rolledBack: z.boolean().default(false),
  error: str(2000).optional().nullable(), checks: z.array(check).max(100).default([]), durationMs: z.number().int().min(0).optional(),
});
export const deviceCheckinSchema = z.object({ appliedPolicyVersion: z.string().max(64).optional().nullable(), status: z.enum(['UP_TO_DATE', 'FAILED']).default('UP_TO_DATE'), error: z.string().max(500).optional().nullable(), os: str(120).optional(), browser: str(80).optional(), agentVersion: str(30).optional(), hostname: str(120).optional() });

export const settingsSchema = z.object({
  institution: z.object({ name: str(160), npsn: str(20), address: str(300), phone: str(40), email: z.union([z.string().email(), z.literal('')]), headmaster: str(120) }).partial().optional(),
  app: z.object({ name: reqStr(60), tagline: str(160) }).partial().optional(),
  timezone: z.literal('Asia/Jakarta').optional(),
  gateway: z.object({ heartbeatIntervalSec: z.number().int().min(10).max(600), offlineAfterSec: z.number().int().min(30).max(3600), maxClockSkewSec: z.number().int().min(30).max(900) }).partial().optional(),
  security: z.object({ requireSuperAdminForCoreOverride: z.literal(true), sessionTimeoutMin: z.number().int().min(15).max(1440), allowTeacherCreateSession: z.boolean(), blockQuic: z.boolean(), blockDoT: z.boolean(), blockVpnPorts: z.boolean(), dnsSafeSearchRewrite: z.boolean() }).partial().optional(),
  google: z.object({ searchHosts: z.array(domain).min(1).max(10), resourceHosts: z.array(domain).max(50), blockedPaths: z.array(z.string().regex(/^\/[A-Za-z0-9/_-]{0,100}$/)).max(50) }).partial().optional(),
  logs: z.object({ retentionDays: z.number().int().min(7).max(730), storeFullUrl: z.boolean(), storeAllowedEvents: z.boolean() }).partial().optional(),
  notifications: z.record(z.boolean()).optional(),
});

export const pageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(128).optional() });
