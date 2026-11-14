import { db } from '../store/index.js';
import type { SystemSettings } from '../../shared/types.js';
import { DEFAULT_GOOGLE_BLOCKED_PATHS, DEFAULT_GOOGLE_RESOURCE_HOSTS, DEFAULT_GOOGLE_SEARCH_HOSTS, TIMEZONE } from '../../shared/defaults.js';

export const SETUP_STEPS: { key: string; label: string; auto: boolean }[] = [
  { key: 'firebase', label: 'Konfigurasi Firebase', auto: true },
  { key: 'superAdmin', label: 'Registrasi akun Super Admin', auto: true },
  { key: 'institution', label: 'Pengaturan profil lembaga', auto: true },
  { key: 'laboratory', label: 'Pembuatan laboratorium', auto: true },
  { key: 'gatewayRegistered', label: 'Registrasi gateway', auto: true },
  { key: 'gatewayInstalled', label: 'Pemasangan Gateway Agent (pairing + heartbeat)', auto: true },
  { key: 'networkCheck', label: 'Pemeriksaan jaringan (penerapan kebijakan terkonfirmasi)', auto: true },
  { key: 'deviceRegistered', label: 'Registrasi perangkat', auto: true },
  { key: 'chromePolicy', label: 'Instalasi Chrome Policy (perangkat melapor versi kebijakan)', auto: true },
  { key: 'testGoogleSearch', label: 'Pengujian Google Search (dapat dibuka)', auto: false },
  { key: 'testTiktok', label: 'Pengujian pemblokiran TikTok', auto: false },
  { key: 'testYoutube', label: 'Pengujian pemblokiran YouTube', auto: false },
  { key: 'liveMode', label: 'Aktivasi LIVE MODE', auto: false },
];

export function defaultSettings(): Omit<SystemSettings, 'id'> {
  return {
    mode: 'DEMO',
    institution: { name: '', npsn: '', address: '', phone: '', email: '', headmaster: '' },
    app: { name: 'LABGUARD EDU', tagline: 'Sistem Manajemen & Pengendalian Akses Internet Laboratorium' },
    timezone: TIMEZONE,
    gateway: { heartbeatIntervalSec: 30, offlineAfterSec: 120, maxClockSkewSec: 300 },
    security: { requireSuperAdminForCoreOverride: true, sessionTimeoutMin: 480, allowTeacherCreateSession: true, blockQuic: true, blockDoT: true, blockVpnPorts: true, dnsSafeSearchRewrite: true },
    google: { searchHosts: DEFAULT_GOOGLE_SEARCH_HOSTS, resourceHosts: DEFAULT_GOOGLE_RESOURCE_HOSTS, blockedPaths: DEFAULT_GOOGLE_BLOCKED_PATHS },
    logs: { retentionDays: 90, storeFullUrl: false, storeAllowedEvents: true },
    notifications: { GATEWAY_OFFLINE: true, DEVICE_POLICY_OUTDATED: true, SYNC_FAILED: true, NEW_DEVICE: true, BLOCKED_ATTEMPT: true, PERMISSION_REQUEST: true, POLICY_APPLIED: true, CONFIG_ERROR: true },
    setup: Object.fromEntries(SETUP_STEPS.map((s) => [s.key, { key: s.key, done: false, at: null, by: null }])),
    liveActivatedAt: null, liveActivatedBy: null,
  };
}

let cache: { v: SystemSettings; at: number } | null = null;

export async function getSettings(fresh = false): Promise<SystemSettings> {
  if (!fresh && cache && Date.now() - cache.at < 5000) return cache.v;
  let s = (await db().get('systemSettings', 'main')) as SystemSettings | null;
  if (!s) s = (await db().set('systemSettings', 'main', defaultSettings())) as SystemSettings;
  const d = defaultSettings();
  // gabungkan default untuk field baru
  const merged = { ...d, ...s, gateway: { ...d.gateway, ...s.gateway }, security: { ...d.security, ...s.security }, google: { ...d.google, ...s.google }, logs: { ...d.logs, ...s.logs }, notifications: { ...d.notifications, ...s.notifications }, setup: { ...d.setup, ...s.setup } } as SystemSettings;
  cache = { v: merged, at: Date.now() };
  return merged;
}

export async function updateSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  await getSettings(true);
  await db().update('systemSettings', 'main', patch as Record<string, any>);
  cache = null;
  return getSettings(true);
}

export async function markSetup(key: string, done: boolean, by: string | null, note?: string) {
  const s = await getSettings(true);
  if (s.setup[key]?.done === done && !note) return;
  await updateSettings({ setup: { ...s.setup, [key]: { key, done, at: done ? new Date().toISOString() : null, by, note } } });
}

export function invalidateSettingsCache() { cache = null; }
