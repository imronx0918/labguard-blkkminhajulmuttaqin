import type { Role } from './roles.js';
import type { PolicyType } from './defaults.js';

// Semua timestamp dikirim ke frontend sebagai ISO string (server mengonversi Firestore Timestamp).
export type ISODate = string;

export interface BaseDoc { id: string; createdAt?: ISODate; updatedAt?: ISODate; createdBy?: string }

export type SystemMode = 'DEMO' | 'LIVE';

export interface AppUser extends BaseDoc { email: string; displayName: string; role: Role; active: boolean; labIds?: string[]; lastLoginAt?: ISODate; demo?: boolean }
export interface Student extends BaseDoc { nis: string; name: string; classId: string; major: string; active: boolean; demo?: boolean }
export interface ClassRoom extends BaseDoc { name: string; grade: string; major: string; homeroomTeacher: string; studentCount: number; defaultLabId?: string; demo?: boolean }
export interface Laboratory extends BaseDoc { name: string; code: string; location: string; capacity: number; subnet: string; gatewayId?: string; defaultPolicyId?: string; activePolicyId?: string; activeSessionId?: string | null; demo?: boolean }

export type DeviceApplyStatus = 'UNKNOWN' | 'UP_TO_DATE' | 'OUTDATED' | 'FAILED' | 'NOT_CONFIGURED';
export interface Device extends BaseDoc {
  name: string; inventoryNo: string; mac?: string; ip?: string; os?: string; browser?: string;
  labId?: string; classId?: string; group?: string; gatewayId?: string;
  status: 'active' | 'disabled'; credentialStatus: 'none' | 'issued' | 'revoked';
  lastSeenAt?: ISODate | null; agentVersion?: string; appliedPolicyVersion?: string | null; policyApplyStatus: DeviceApplyStatus;
  resyncRequestedAt?: ISODate | null; online?: boolean; demo?: boolean;
}

export type GatewayStatus = 'UNPAIRED' | 'PAIRED' | 'REVOKED';
export interface ComponentStatus { state: 'OK' | 'ERROR' | 'DISABLED' | 'NOT_CONFIGURED' | 'UNKNOWN'; detail?: string }
export interface Gateway extends BaseDoc {
  name: string; location: string; labIds: string[]; localIp?: string; status: GatewayStatus; adapter: string;
  agentVersion?: string; desiredPolicyVersion: number; appliedPolicyVersion: number | null; desiredBundleHash?: string;
  lastHeartbeatAt?: ISODate | null; lastSyncAt?: ISODate | null; pairingExpiresAt?: ISODate | null;
  dns?: ComponentStatus; firewall?: ComponentStatus; filtering?: ComponentStatus;
  protections?: { key: string; label: string; active: boolean; note?: string }[];
  devicesHandled?: number; devicesActive?: number; pendingCommands?: GatewayCommand[]; online?: boolean; demo?: boolean;
}
export const GATEWAY_COMMANDS = ['APPLY_POLICY', 'RELOAD_FILTERING', 'CHECK_STATUS', 'ROLLBACK', 'SYNC_CONFIGURATION', 'BACKUP_CONFIGURATION'] as const;
export type GatewayCommandType = (typeof GATEWAY_COMMANDS)[number];
export interface GatewayCommand { id: string; type: GatewayCommandType; issuedAt: ISODate; issuedBy: string }

export interface WebsiteCategory extends BaseDoc { slug: string; name: string; description: string; core: boolean; enabled: boolean; domainCount?: number }
export interface BlockedDomain extends BaseDoc { domain: string; categoryId: string; includeSubdomains: boolean; note?: string; core: boolean }
export interface AllowedDomain extends BaseDoc {
  domain: string; note?: string; scope: 'global' | 'lab'; labIds?: string[]; temporary: boolean;
  validFrom?: ISODate | null; expiresAt?: ISODate | null; permissionRequestId?: string; coreOverride?: boolean; overrideAdminBlock?: boolean;
}

export interface PolicySchedule { days: number[]; start: string; end: string }
export interface PolicyProfile extends BaseDoc {
  name: string; description: string; type: PolicyType; builtin: boolean; active: boolean;
  googleSearch: boolean; safeSearch: boolean; includeGlobalAllowlist: boolean; ipEnforcement: boolean;
  blockedCategoryIds: string[]; allowedDomains: string[]; blockedDomains: string[]; allowedUrls: string[]; blockedUrls: string[];
  schedule?: PolicySchedule | null; targetClassIds: string[]; targetLabIds: string[]; revision: number;
}
export interface PolicyRule extends BaseDoc { policyId: string; kind: 'ALLOW_DOMAIN' | 'BLOCK_DOMAIN' | 'ALLOW_URL' | 'BLOCK_URL'; value: string; note?: string }

export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type SessionSecurity = 'NOT_STARTED' | 'PENDING_CONFIRMATION' | 'SECURED' | 'FAILED' | 'SIMULATED_DEMO' | 'NO_GATEWAY';
export interface LabSession extends BaseDoc {
  name: string; subject: string; teacherId: string; teacherName: string; classId: string; labId: string;
  date: string; startTime: string; endTime: string; startAt: ISODate; endAt: ISODate; computerCount: number; policyId: string;
  status: SessionStatus; securityStatus: SessionSecurity; autoStart: boolean; startedAt?: ISODate | null; endedAt?: ISODate | null;
  deploymentIds?: string[]; securityDetail?: string; demo?: boolean;
}
export interface SessionDevice extends BaseDoc { sessionId: string; deviceId: string; studentId?: string | null }

export type PermissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
export interface PermissionRequest extends BaseDoc {
  siteName: string; url: string; domain: string; reason: string; subject: string; classId: string; labId: string;
  date: string; startTime: string; endTime: string; validFrom: ISODate; validUntil: ISODate; status: PermissionStatus;
  requestedBy: string; requestedByName: string; reviewedBy?: string; reviewedByName?: string; reviewNote?: string; reviewedAt?: ISODate;
  allowedDomainId?: string; coreOverride?: boolean; overrideAdminBlock?: boolean; blockedBy?: string | null;
}

export const LOG_TYPES = ['ALLOWED', 'BLOCKED', 'POLICY_APPLIED', 'POLICY_FAILED', 'DEVICE_ONLINE', 'DEVICE_OFFLINE', 'GATEWAY_ERROR', 'BYPASS_ATTEMPT'] as const;
export type LogType = (typeof LOG_TYPES)[number];
export interface AccessLog extends BaseDoc {
  ts: ISODate; type: LogType; gatewayId?: string; deviceId?: string | null; deviceName?: string | null; clientIp?: string | null;
  labId?: string | null; classId?: string | null; sessionId?: string | null; domain?: string | null; path?: string | null;
  category?: string | null; reason?: string | null; policyId?: string | null; policyName?: string | null; policyVersion?: number | null; dayKey: string; demo?: boolean;
}

export type DeploymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SIMULATED_DEMO' | 'SUPERSEDED' | 'ROLLED_BACK' | 'NO_GATEWAY';
export interface PolicyDeployment extends BaseDoc {
  gatewayId: string | null; labIds: string[]; version: number; bundleHash: string; reason: string; status: DeploymentStatus;
  fetchedAt?: ISODate | null; confirmedAt?: ISODate | null; error?: string | null; checks?: DeploymentCheck[]; sessionId?: string | null; mode: SystemMode;
}
export interface DeploymentCheck { name: string; layer: 'DNS' | 'FIREWALL' | 'BROWSER' | 'SYSTEM'; target: string; expected: string; actual: string; passed: boolean }

export interface AuditLog extends BaseDoc { ts: ISODate; userId: string; userName: string; role?: string; action: string; target?: string; targetId?: string; details?: Record<string, unknown>; ip?: string | null; result: 'SUCCESS' | 'FAILURE' | 'DENIED' }

export type NotificationKind = 'GATEWAY_OFFLINE' | 'DEVICE_POLICY_OUTDATED' | 'SYNC_FAILED' | 'NEW_DEVICE' | 'BLOCKED_ATTEMPT' | 'PERMISSION_REQUEST' | 'POLICY_APPLIED' | 'CONFIG_ERROR' | 'INFO';
export interface AppNotification extends BaseDoc { kind: NotificationKind; title: string; message: string; severity: 'info' | 'success' | 'warning' | 'error'; link?: string; readBy: string[]; audience: Role[]; dedupeKey?: string }

export interface SetupStep { key: string; done: boolean; at?: ISODate | null; by?: string | null; note?: string }
export interface SystemSettings extends BaseDoc {
  mode: SystemMode;
  institution: { name: string; npsn: string; address: string; phone: string; email: string; headmaster: string };
  app: { name: string; tagline: string };
  timezone: string;
  gateway: { heartbeatIntervalSec: number; offlineAfterSec: number; maxClockSkewSec: number };
  security: { requireSuperAdminForCoreOverride: boolean; sessionTimeoutMin: number; allowTeacherCreateSession: boolean; blockQuic: boolean; blockDoT: boolean; blockVpnPorts: boolean; dnsSafeSearchRewrite: boolean };
  google: { searchHosts: string[]; resourceHosts: string[]; blockedPaths: string[] };
  logs: { retentionDays: number; storeFullUrl: boolean; storeAllowedEvents: boolean };
  notifications: Record<string, boolean>;
  setup: Record<string, SetupStep>;
  liveActivatedAt?: ISODate | null; liveActivatedBy?: string | null;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface DashboardData {
  mode: SystemMode;
  stats: { devicesTotal: number; devicesOnline: number; devicesOffline: number; devicesInUse: number; studentsActive: number; sessionsToday: number; blockedToday: number; gatewaysTotal: number; gatewaysOnline: number };
  gatewayStatus: 'ONLINE' | 'OFFLINE' | 'PARTIAL' | 'NOT_CONFIGURED';
  system: { dns: ComponentStatus; firewall: ComponentStatus; sync: ComponentStatus; lastSyncAt: ISODate | null; devicesOutdated: number };
  daily: { day: string; total: number; allowed: number; blocked: number }[];
  sites: { name: string; value: number }[];
  recent: AccessLog[];
  activeSessions: LabSession[];
}
