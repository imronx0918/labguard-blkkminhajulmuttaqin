import { createHash } from 'node:crypto';
import { db } from '../store/index.js';
import { compilePolicy, stableStringify, type CompiledPolicy, type CompileProfile } from '../../shared/policyCompiler.js';
import { browserPolicyMap } from '../../shared/browserPolicy.js';
import type { Gateway, PolicyDeployment, PolicyProfile, SystemSettings } from '../../shared/types.js';
import { getSettings } from './settings.js';
import { notify } from './notifications.js';
import { isoNow } from '../utils.js';

const h = (v: unknown) => createHash('sha256').update(stableStringify(v)).digest('hex');

export async function getBuiltinPolicy(type: string): Promise<PolicyProfile | null> {
  const r = await db().list('policies', { where: [['type', '==', type], ['builtin', '==', true]], limit: 1 });
  return (r.items[0] as PolicyProfile) ?? null;
}

/** Profil efektif lab: kebijakan sesi aktif → kebijakan default lab → GOOGLE SEARCH ONLY. */
export async function effectiveProfileForLab(labId: string): Promise<{ profile: PolicyProfile; sessionId: string | null; source: 'SESSION' | 'LAB_DEFAULT' | 'SYSTEM_DEFAULT' }> {
  const lab = await db().get('laboratories', labId);
  if (lab?.activeSessionId) {
    const s = await db().get('sessions', lab.activeSessionId);
    if (s && s.status === 'ACTIVE') {
      const p = await db().get('policies', s.policyId);
      if (p) return { profile: p as PolicyProfile, sessionId: s.id, source: 'SESSION' };
    }
  }
  if (lab?.defaultPolicyId) {
    const p = await db().get('policies', lab.defaultPolicyId);
    if (p && p.active) return { profile: p as PolicyProfile, sessionId: null, source: 'LAB_DEFAULT' };
  }
  const fallback = await getBuiltinPolicy('GOOGLE_SEARCH_ONLY');
  if (!fallback) throw new Error('Profil bawaan GOOGLE SEARCH ONLY belum di-seed');
  return { profile: fallback, sessionId: null, source: 'SYSTEM_DEFAULT' };
}

function toCompileProfile(p: PolicyProfile): CompileProfile {
  return {
    id: p.id, name: p.name, type: p.type, googleSearch: p.googleSearch, safeSearch: p.safeSearch !== false,
    includeGlobalAllowlist: p.includeGlobalAllowlist, ipEnforcement: !!p.ipEnforcement,
    blockedCategoryIds: p.blockedCategoryIds ?? [], allowedDomains: p.allowedDomains ?? [], blockedDomains: p.blockedDomains ?? [],
    allowedUrls: p.allowedUrls ?? [], blockedUrls: p.blockedUrls ?? [],
  };
}

export async function loadCompileContext(labId: string | null, settings: SystemSettings) {
  const [cats, blocked, allowed] = await Promise.all([
    db().list('websiteCategories'), db().list('blockedDomains'), db().list('allowedDomains'),
  ]);
  const now = Date.now();
  const globalAllowed = allowed.items.filter((a) => !a.temporary && a.scope === 'global').map((a) => a.domain);
  const exceptions = allowed.items
    .filter((a) => (a.temporary || a.scope === 'lab') && (!labId || !a.labIds?.length || a.labIds.includes(labId)))
    .filter((a) => !a.temporary || ((!a.validFrom || Date.parse(a.validFrom) <= now) && a.expiresAt && Date.parse(a.expiresAt) > now))
    .map((a) => ({ domain: a.domain, coreOverride: !!a.coreOverride, overrideAdminBlock: !!a.overrideAdminBlock, expiresAt: a.expiresAt ?? null, source: a.id }));
  return {
    categories: cats.items.map((c) => ({ id: c.id, slug: c.slug, name: c.name, core: !!c.core, enabled: c.enabled !== false })),
    blocked: blocked.items.map((b) => ({ domain: b.domain, categoryId: b.categoryId, includeSubdomains: b.includeSubdomains !== false, core: !!b.core })),
    globalAllowed, exceptions,
    settings: {
      googleSearchHosts: settings.google.searchHosts, googleResourceHosts: settings.google.resourceHosts, googleBlockedPaths: settings.google.blockedPaths,
      blockQuic: settings.security.blockQuic, blockDoT: settings.security.blockDoT, blockVpnPorts: settings.security.blockVpnPorts, dnsSafeSearchRewrite: settings.security.dnsSafeSearchRewrite,
    },
  };
}

export async function compileForProfile(profile: PolicyProfile, labId: string | null): Promise<CompiledPolicy> {
  const settings = await getSettings();
  const ctx = await loadCompileContext(labId, settings);
  return compilePolicy({ profile: toCompileProfile(profile), ...ctx });
}

export async function compileLab(labId: string) {
  const eff = await effectiveProfileForLab(labId);
  const compiled = await compileForProfile(eff.profile, labId);
  const browserVersion = h(browserPolicyMap(compiled)).slice(0, 12);
  return { ...eff, compiled, browserVersion };
}

export interface GatewayBundle {
  schema: 'labguard.bundle/v1'; gatewayId: string; version: number; generatedAt: string; hash: string;
  labs: { labId: string; labName: string; subnet: string; sessionId: string | null; source: string; policy: CompiledPolicy }[];
}

export async function buildBundleContent(gw: Gateway) {
  const labs = [];
  for (const labId of gw.labIds ?? []) {
    const lab = await db().get('laboratories', labId);
    if (!lab) continue;
    const c = await compileLab(labId);
    labs.push({ labId, labName: lab.name, subnet: lab.subnet ?? '', sessionId: c.sessionId, source: c.source, policy: c.compiled });
  }
  return { labs, hash: h(labs) };
}

export function isGatewayOnline(gw: { lastHeartbeatAt?: string | null; status?: string; [k: string]: any }, settings: SystemSettings): boolean {
  if (gw.status !== 'PAIRED' || !gw.lastHeartbeatAt) return false;
  return Date.now() - Date.parse(gw.lastHeartbeatAt) < settings.gateway.offlineAfterSec * 1000;
}

/**
 * Minta penerapan kebijakan untuk lab tertentu. Membuat dokumen policyDeployments per gateway.
 * Status awal PENDING (LIVE) atau SIMULATED_DEMO (DEMO). TIDAK PERNAH langsung CONFIRMED —
 * konfirmasi hanya datang dari POST /api/agent/apply-result.
 */
export async function requestDeployment(opts: { labIds: string[]; reason: string; actor: string; sessionId?: string | null; force?: boolean }): Promise<PolicyDeployment[]> {
  const settings = await getSettings();
  const out: PolicyDeployment[] = [];
  const gwIds = new Set<string>();
  const labsWithoutGw: string[] = [];
  for (const labId of opts.labIds) {
    const lab = await db().get('laboratories', labId);
    if (!lab) continue;
    if (lab.gatewayId) gwIds.add(lab.gatewayId); else labsWithoutGw.push(labId);
  }
  for (const gwId of gwIds) {
    const gw = (await db().get('gateways', gwId)) as Gateway | null;
    if (!gw || gw.status === 'REVOKED') { labsWithoutGw.push(...opts.labIds.filter(Boolean)); continue; }
    const { hash } = await buildBundleContent(gw);
    const changed = hash !== gw.desiredBundleHash;
    if (!changed && !opts.force) {
      const last = await db().list('policyDeployments', { where: [['gatewayId', '==', gwId]], orderBy: { field: 'createdAt', dir: 'desc' }, limit: 1 });
      if (last.items[0]) { out.push(last.items[0] as PolicyDeployment); continue; }
    }
    const version = changed || !gw.desiredPolicyVersion ? (gw.desiredPolicyVersion ?? 0) + 1 : gw.desiredPolicyVersion;
    // Deployment lama yang masih PENDING digantikan
    const pend = await db().list('policyDeployments', { where: [['gatewayId', '==', gwId], ['status', '==', 'PENDING']], limit: 50 });
    for (const p of pend.items) await db().update('policyDeployments', p.id, { status: 'SUPERSEDED' });
    await db().update('gateways', gwId, { desiredPolicyVersion: version, desiredBundleHash: hash });
    const dep = await db().create('policyDeployments', {
      gatewayId: gwId, labIds: gw.labIds, version, bundleHash: hash, reason: opts.reason, mode: settings.mode,
      status: settings.mode === 'LIVE' ? 'PENDING' : 'SIMULATED_DEMO', fetchedAt: null, confirmedAt: null, error: null,
      checks: [], sessionId: opts.sessionId ?? null, createdBy: opts.actor,
    });
    out.push(dep as PolicyDeployment);
    if (settings.mode === 'LIVE' && !isGatewayOnline(gw, settings)) {
      await notify({ kind: 'SYNC_FAILED', severity: 'warning', title: 'Gateway offline — kebijakan menunggu', message: `Gateway ${gw.name} offline. Kebijakan v${version} akan diambil saat gateway kembali online. Gateway mempertahankan kebijakan terakhir yang valid.`, link: '/gateways', dedupeKey: `pending-offline-${gwId}` });
    }
  }
  if (labsWithoutGw.length) {
    const dep = await db().create('policyDeployments', {
      gatewayId: null, labIds: [...new Set(labsWithoutGw)], version: 0, bundleHash: '', reason: opts.reason, mode: settings.mode,
      status: 'NO_GATEWAY', error: 'Laboratorium belum terhubung dengan gateway (BELUM DIKONFIGURASI)', checks: [], sessionId: opts.sessionId ?? null, createdBy: opts.actor,
    });
    out.push(dep as PolicyDeployment);
  }
  // Tandai perangkat di lab sebagai OUTDATED bila versi browser berubah
  for (const labId of opts.labIds) {
    const { browserVersion } = await compileLab(labId);
    const devs = await db().list('devices', { where: [['labId', '==', labId]], limit: 500 });
    for (const d of devs.items) {
      if (d.credentialStatus === 'issued' && d.appliedPolicyVersion !== browserVersion && d.policyApplyStatus !== 'OUTDATED')
        await db().update('devices', d.id, { policyApplyStatus: 'OUTDATED' });
    }
  }
  return out;
}

/** Cari lab yang terdampak perubahan global (kategori/daftar situs): semua lab. */
export async function allLabIds(): Promise<string[]> {
  return (await db().list('laboratories')).items.map((l) => l.id);
}

/** Lab yang memakai profil tertentu (sebagai default atau melalui sesi aktif). */
export async function labsUsingPolicy(policyId: string): Promise<string[]> {
  const labs = (await db().list('laboratories')).items;
  const out: string[] = [];
  for (const l of labs) {
    const eff = await effectiveProfileForLab(l.id);
    if (eff.profile.id === policyId) out.push(l.id);
  }
  return out;
}

export async function redeployAll(reason: string, actor: string) {
  const labs = await allLabIds();
  return labs.length ? requestDeployment({ labIds: labs, reason, actor }) : [];
}

export { isoNow };
