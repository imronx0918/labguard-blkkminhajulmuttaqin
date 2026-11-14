// =====================================================================================
// POLICY COMPILER — mengubah profil kebijakan + daftar situs + pengecualian menjadi
// bundle konfigurasi yang TERPISAH per lapisan:
//   1. DNS   (domain-level; tidak dapat memfilter path URL)
//   2. FIREWALL (nftables: anti-bypass DNS/DoT/DoH/VPN, full lock, opsional IP allowlist)
//   3. BROWSER (Chrome/Edge Enterprise: URLBlocklist/URLAllowlist berbasis path, SafeSearch)
//
// Prioritas aturan (tertinggi → terendah):
//   CORE (keamanan inti)  > ADMIN (daftar blokir kategori global)  > SESSION (profil)  > EXCEPTION (izin sementara)
// Pengecualian sementara HANYA membuka akses yang ditolak oleh default-deny / lapisan sesi.
// Pengecualian dapat melewati lapisan ADMIN hanya bila overrideAdminBlock=true (disetujui admin),
// dan melewati CORE hanya bila coreOverride=true (WAJIB disetujui Super Admin — divalidasi backend).
// =====================================================================================
import { domainMatches, normalizeDomain, isValidDomain, isValidUrlFilter } from './domain.js';
import {
  DEFAULT_DOH_RESOLVER_IPS, DEFAULT_GOOGLE_BLOCKED_PATHS, DEFAULT_GOOGLE_RESOURCE_HOSTS, DEFAULT_GOOGLE_SEARCH_HOSTS,
  FORCE_SAFESEARCH_IPV4, FORCE_SAFESEARCH_IPV6,
} from './defaults.js';
import type { PolicyType } from './defaults.js';

export type RuleLayer = 'CORE' | 'ADMIN' | 'SESSION' | 'EXCEPTION' | 'DEFAULT';

export interface CompileCategory { id: string; slug: string; name: string; core: boolean; enabled: boolean }
export interface CompileBlocked { domain: string; categoryId: string; includeSubdomains: boolean; core: boolean }
export interface CompileException { domain: string; coreOverride?: boolean; overrideAdminBlock?: boolean; expiresAt?: string | null; source: string }
export interface CompileProfile {
  id: string; name: string; type: PolicyType; googleSearch: boolean; safeSearch: boolean; includeGlobalAllowlist: boolean; ipEnforcement: boolean;
  blockedCategoryIds: string[]; allowedDomains: string[]; blockedDomains: string[]; allowedUrls: string[]; blockedUrls: string[];
}
export interface CompileSettings {
  googleSearchHosts?: string[]; googleResourceHosts?: string[]; googleBlockedPaths?: string[];
  blockQuic?: boolean; blockDoT?: boolean; blockVpnPorts?: boolean; dnsSafeSearchRewrite?: boolean; dohResolverIps?: string[];
}
export interface CompileInput {
  profile: CompileProfile; categories: CompileCategory[]; blocked: CompileBlocked[];
  globalAllowed: string[]; exceptions: CompileException[]; settings?: CompileSettings;
}

export interface DnsBlockEntry { domain: string; layer: RuleLayer; category: string }
export interface CompiledPolicy {
  schema: 'labguard.policy/v1';
  profileId: string; profileName: string; profileType: PolicyType;
  dns: {
    defaultDeny: boolean;           // true: hanya domain di allow yang di-resolve
    allow: string[];                 // domain (termasuk subdomain) yang di-resolve
    block: DnsBlockEntry[];          // domain diblokir (NXDOMAIN), lebih spesifik menang
    safeSearchHosts: string[];       // host yang dipetakan ke forcesafesearch.google.com
    safeSearchIpv4: string; safeSearchIpv6: string;
  };
  firewall: {
    fullLock: boolean; blockDoT: boolean; blockDoH: boolean; dohResolverIps: string[];
    blockVpnPorts: boolean; blockQuic: boolean; ipEnforcement: boolean; forceLocalDns: boolean;
  };
  browser: {
    URLBlocklist: string[]; URLAllowlist: string[]; ForceGoogleSafeSearch: boolean; ForceYouTubeRestrict: number;
    IncognitoModeAvailability: number; BrowserGuestModeEnabled: boolean; BrowserAddPersonEnabled: boolean;
    DeveloperToolsAvailability: number; ExtensionInstallBlocklist: string[]; DnsOverHttpsMode: string;
    ProxyMode: string; HomepageLocation: string; HomepageIsNewTabPage: boolean; RestoreOnStartup: number; RestoreOnStartupURLs: string[];
    DefaultSearchProviderEnabled: boolean; DefaultSearchProviderName: string; DefaultSearchProviderSearchURL: string;
    BrowserSignin: number; SyncDisabled: boolean; PasswordManagerEnabled: boolean; QuicAllowed: boolean; AllowDinosaurEasterEgg: boolean;
  };
  layers: { core: number; admin: number; session: number; exception: number };
  exceptions: { domain: string; expiresAt: string | null; layerOverridden: RuleLayer | null }[];
  warnings: string[];
}

const uniq = <T,>(a: T[]) => Array.from(new Set(a));

export function compilePolicy(input: CompileInput): CompiledPolicy {
  const { profile, categories, settings = {} } = input;
  const warnings: string[] = [];
  const searchHosts = (settings.googleSearchHosts?.length ? settings.googleSearchHosts : DEFAULT_GOOGLE_SEARCH_HOSTS).map(normalizeDomain);
  const resourceHosts = (settings.googleResourceHosts ?? DEFAULT_GOOGLE_RESOURCE_HOSTS).map(normalizeDomain);
  const blockedPaths = settings.googleBlockedPaths ?? DEFAULT_GOOGLE_BLOCKED_PATHS;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const fullLock = profile.type === 'FULL_LOCK';

  // ---- Lapisan blokir: CORE + ADMIN (kategori yang dipilih profil) + SESSION (domain blokir profil)
  const block: DnsBlockEntry[] = [];
  const coreCats = categories.filter((c) => c.core && c.enabled);
  const selectedCats = new Set(profile.blockedCategoryIds);
  for (const b of input.blocked) {
    const cat = catById.get(b.categoryId);
    if (!cat || !cat.enabled) continue;
    const isCore = cat.core || b.core;
    if (isCore) block.push({ domain: normalizeDomain(b.domain), layer: 'CORE', category: cat.name });
    else if (selectedCats.has(cat.id)) block.push({ domain: normalizeDomain(b.domain), layer: 'ADMIN', category: cat.name });
  }
  for (const d of profile.blockedDomains) block.push({ domain: normalizeDomain(d), layer: 'SESSION', category: 'Kustom profil' });

  // ---- Lapisan izin
  const allow = new Set<string>();
  if (profile.googleSearch && !fullLock) {
    searchHosts.forEach((h) => allow.add(h));
    resourceHosts.forEach((h) => allow.add(h));
  }
  if (!fullLock) {
    profile.allowedDomains.map(normalizeDomain).forEach((d) => allow.add(d));
    if (profile.includeGlobalAllowlist) input.globalAllowed.map(normalizeDomain).forEach((d) => allow.add(d));
  }

  // ---- Pengecualian sementara (berlaku juga saat FULL_LOCK bila disetujui untuk lab ini)
  const now = Date.now();
  const exceptionsOut: CompiledPolicy['exceptions'] = [];
  const blockFinal = [...block];
  for (const ex of input.exceptions) {
    if (ex.expiresAt && Date.parse(ex.expiresAt) <= now) continue; // kedaluwarsa: tidak dikompilasi
    const d = normalizeDomain(ex.domain);
    if (!isValidDomain(d)) { warnings.push(`Pengecualian tidak valid diabaikan: ${ex.domain}`); continue; }
    const conflicts = blockFinal.filter((b) => domainMatches(d, b.domain) || domainMatches(b.domain, d));
    const coreConflict = conflicts.find((c) => c.layer === 'CORE');
    const adminConflict = conflicts.find((c) => c.layer === 'ADMIN');
    if (coreConflict && !ex.coreOverride) { warnings.push(`Pengecualian ${d} ditolak: bertentangan dengan kebijakan keamanan inti (${coreConflict.category}).`); continue; }
    if (adminConflict && !ex.overrideAdminBlock && !ex.coreOverride) { warnings.push(`Pengecualian ${d} ditolak: diblokir kebijakan administrator (${adminConflict.category}).`); continue; }
    // Hapus entri blokir yang dikalahkan oleh pengecualian (hanya domain yang sama/subdomain dari pengecualian)
    for (let i = blockFinal.length - 1; i >= 0; i--) {
      const b = blockFinal[i];
      if (domainMatches(b.domain, d)) {
        if (b.layer === 'CORE' && !ex.coreOverride) continue;
        if (b.layer === 'ADMIN' && !ex.overrideAdminBlock && !ex.coreOverride) continue;
        blockFinal.splice(i, 1);
      }
    }
    allow.add(d);
    exceptionsOut.push({ domain: d, expiresAt: ex.expiresAt ?? null, layerOverridden: coreConflict ? 'CORE' : adminConflict ? 'ADMIN' : null });
  }

  // Domain yang diizinkan sesi tetapi diblokir ADMIN/CORE: blokir tetap menang (dicatat sebagai peringatan)
  for (const a of allow) {
    const hit = blockFinal.find((b) => (b.layer === 'CORE' || b.layer === 'ADMIN') && domainMatches(a, b.domain));
    if (hit && !exceptionsOut.some((e) => e.domain === a)) warnings.push(`${a} diizinkan profil tetapi tetap diblokir lapisan ${hit.layer} (${hit.category}).`);
  }

  // ---- BROWSER (URL-level, terpisah dari DNS)
  const urlAllow: string[] = [];
  const urlBlock: string[] = ['*', 'javascript://*', 'file://*', 'chrome://extensions', 'chrome://settings/clearBrowserData'];
  if (profile.googleSearch && !fullLock) {
    for (const h of searchHosts) {
      urlAllow.push(`.${h}`); // host persis (tanpa subdomain) — mail./drive./docs. TIDAK ikut
      for (const p of blockedPaths) urlBlock.push(`.${h}${p}`); // path non-pencarian diblokir (lebih spesifik → menang)
    }
  }
  if (!fullLock) {
    for (const a of allow) {
      if (searchHosts.includes(a) || resourceHosts.includes(a)) continue;
      const hit = blockFinal.find((b) => domainMatches(a, b.domain));
      if (hit) continue;
      urlAllow.push(a);
    }
    for (const u of profile.allowedUrls) if (isValidUrlFilter(u)) urlAllow.push(u); else warnings.push(`URL izin tidak valid: ${u}`);
  }
  for (const u of profile.blockedUrls) if (isValidUrlFilter(u)) urlBlock.push(u); else warnings.push(`URL blokir tidak valid: ${u}`);
  for (const b of blockFinal) urlBlock.push(b.domain); // tanpa titik → domain + subdomain
  urlAllow.push('chrome://policy', 'chrome://management');

  const startUrl = profile.googleSearch && !fullLock ? `https://${searchHosts[0]}/` : 'about:blank';

  return {
    schema: 'labguard.policy/v1',
    profileId: profile.id, profileName: profile.name, profileType: profile.type,
    dns: {
      defaultDeny: true,
      allow: fullLock ? [] : uniq([...allow]).sort(),
      block: dedupeBlocks(blockFinal),
      safeSearchHosts: profile.safeSearch && settings.dnsSafeSearchRewrite !== false && profile.googleSearch && !fullLock ? searchHosts : [],
      safeSearchIpv4: FORCE_SAFESEARCH_IPV4, safeSearchIpv6: FORCE_SAFESEARCH_IPV6,
    },
    firewall: {
      fullLock, blockDoT: settings.blockDoT !== false, blockDoH: true, dohResolverIps: settings.dohResolverIps ?? DEFAULT_DOH_RESOLVER_IPS,
      blockVpnPorts: settings.blockVpnPorts !== false, blockQuic: settings.blockQuic !== false, ipEnforcement: profile.ipEnforcement || fullLock, forceLocalDns: true,
    },
    browser: {
      URLBlocklist: uniq(urlBlock), URLAllowlist: uniq(urlAllow),
      ForceGoogleSafeSearch: profile.safeSearch, ForceYouTubeRestrict: 2, IncognitoModeAvailability: 1,
      BrowserGuestModeEnabled: false, BrowserAddPersonEnabled: false, DeveloperToolsAvailability: 2,
      ExtensionInstallBlocklist: ['*'], DnsOverHttpsMode: 'off', ProxyMode: 'direct',
      HomepageLocation: startUrl, HomepageIsNewTabPage: false, RestoreOnStartup: 4, RestoreOnStartupURLs: [startUrl],
      DefaultSearchProviderEnabled: true, DefaultSearchProviderName: 'Google',
      DefaultSearchProviderSearchURL: `https://${searchHosts[0]}/search?q={searchTerms}`,
      BrowserSignin: 0, SyncDisabled: true, PasswordManagerEnabled: false, QuicAllowed: false, AllowDinosaurEasterEgg: false,
    },
    layers: {
      core: blockFinal.filter((b) => b.layer === 'CORE').length, admin: blockFinal.filter((b) => b.layer === 'ADMIN').length,
      session: blockFinal.filter((b) => b.layer === 'SESSION').length, exception: exceptionsOut.length,
    },
    exceptions: exceptionsOut,
    warnings: uniq(warnings),
  };
}

function dedupeBlocks(list: DnsBlockEntry[]): DnsBlockEntry[] {
  const rank: Record<RuleLayer, number> = { CORE: 0, ADMIN: 1, SESSION: 2, EXCEPTION: 3, DEFAULT: 4 };
  const m = new Map<string, DnsBlockEntry>();
  for (const b of list) {
    const cur = m.get(b.domain);
    if (!cur || rank[b.layer] < rank[cur.layer]) m.set(b.domain, b);
  }
  return [...m.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

// ------------------------------------------------------------------ DNS evaluation
export interface DnsDecision { decision: 'ALLOWED' | 'BLOCKED'; layer: RuleLayer; reason: string; category?: string; safeSearch?: boolean }

/** Meniru resolusi dnsmasq: aturan dengan domain paling spesifik (terpanjang) menang. */
export function evaluateDomain(p: CompiledPolicy, hostInput: string): DnsDecision {
  const host = normalizeDomain(hostInput);
  let bestBlock: DnsBlockEntry | null = null;
  for (const b of p.dns.block) if (domainMatches(host, b.domain) && (!bestBlock || b.domain.length > bestBlock.domain.length)) bestBlock = b;
  let bestAllow: string | null = null;
  for (const a of p.dns.allow) if (domainMatches(host, a) && (!bestAllow || a.length > bestAllow.length)) bestAllow = a;
  if (bestBlock && (!bestAllow || bestBlock.domain.length >= bestAllow.length))
    return { decision: 'BLOCKED', layer: bestBlock.layer, reason: `Diblokir (${bestBlock.category})`, category: bestBlock.category };
  if (bestAllow) return { decision: 'ALLOWED', layer: p.exceptions.some((e) => e.domain === bestAllow) ? 'EXCEPTION' : 'SESSION', reason: `Diizinkan (${bestAllow})`, safeSearch: p.dns.safeSearchHosts.includes(host) };
  return { decision: 'BLOCKED', layer: 'DEFAULT', reason: p.firewall.fullLock ? 'Full Internet Lock' : 'Default deny: tidak ada dalam daftar izin' };
}

// ------------------------------------------------------------------ Bundle hashing (stabil)
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
