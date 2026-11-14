// Uji policy compiler. Lapisan URL (browser) dan DOMAIN (DNS) diuji TERPISAH karena mekanismenya berbeda.
import { describe, expect, it } from 'vitest';
import { compilePolicy, evaluateDomain, type CompileInput } from '../shared/policyCompiler';
import { evaluateUrl } from '../shared/urlFilter';
import { SEED_CATEGORIES, SEED_POLICIES } from '../shared/defaults';
import { linuxPolicyJson, windowsRegFile, windowsPowerShellInstaller } from '../shared/browserPolicy';

const categories = SEED_CATEGORIES.map((c) => ({ id: `cat-${c.slug}`, slug: c.slug, name: c.name, core: c.core, enabled: true }));
const blocked = SEED_CATEGORIES.flatMap((c) => c.domains.map((d) => ({ domain: d, categoryId: `cat-${c.slug}`, includeSubdomains: true, core: c.core })));
const gso = SEED_POLICIES.find((p) => p.key === 'google-search-only')!;
const profile = { id: 'p1', name: gso.name, type: gso.type, googleSearch: true, safeSearch: true, includeGlobalAllowlist: false, ipEnforcement: false, blockedCategoryIds: gso.blockedCategorySlugs.map((s) => `cat-${s}`), allowedDomains: [], blockedDomains: [], allowedUrls: [], blockedUrls: [] };
const base: CompileInput = { profile, categories, blocked, globalAllowed: ['wikipedia.org'], exceptions: [] };
const c = compilePolicy(base);
const url = (u: string) => evaluateUrl(u, c.browser.URLBlocklist, c.browser.URLAllowlist).decision;
const dns = (h: string) => evaluateDomain(c, h).decision;

describe('GOOGLE SEARCH ONLY — lapisan URL (Chrome URLBlocklist/URLAllowlist)', () => {
  it('TEST 1: halaman Google Search dapat dibuka', () => { expect(url('https://www.google.com/')).toBe('ALLOWED'); expect(url('https://www.google.co.id/')).toBe('ALLOWED'); expect(url('https://google.com/')).toBe('ALLOWED'); });
  it('TEST 2: pencarian Google dapat dilakukan', () => { expect(url('https://www.google.com/search?q=fotosintesis')).toBe('ALLOWED'); expect(url('https://www.google.co.id/search?q=sejarah')).toBe('ALLOWED'); });
  it('TEST 3: klik hasil menuju situs tidak diizinkan diblokir', () => { expect(url('https://www.google.com/url?q=https://contoh.com')).toBe('ALLOWED'); expect(url('https://contoh.com/artikel')).toBe('BLOCKED'); expect(url('https://id.wikipedia.org/wiki/Fotosintesis')).toBe('BLOCKED'); });
  it('TEST 4: youtube.com diblokir', () => { expect(url('https://www.youtube.com/')).toBe('BLOCKED'); expect(url('https://m.youtube.com/watch?v=x')).toBe('BLOCKED'); });
  it('TEST 5: youtu.be diblokir', () => expect(url('https://youtu.be/abc')).toBe('BLOCKED'));
  it('TEST 6: tiktok.com diblokir', () => { expect(url('https://www.tiktok.com/@x')).toBe('BLOCKED'); expect(url('https://tiktokcdn.com/x')).toBe('BLOCKED'); });
  it('TEST 7: Google Drive & layanan Google lain diblokir', () => {
    for (const u of ['https://drive.google.com/', 'https://mail.google.com/', 'https://photos.google.com/', 'https://gemini.google.com/app', 'https://docs.google.com/document', 'https://www.google.com/maps', 'https://www.google.com/travel']) expect(url(u), u).toBe('BLOCKED');
  });
  it('tidak mengizinkan seluruh domain Google (tidak ada wildcard google.com)', () => {
    expect(c.browser.URLAllowlist).not.toContain('google.com');
    expect(c.browser.URLAllowlist.filter((x) => x.includes('google')).every((x) => x.startsWith('.'))).toBe(true);
    expect(c.browser.URLBlocklist[0]).toBe('*');
    expect(c.browser.ForceGoogleSafeSearch).toBe(true);
  });
});

describe('GOOGLE SEARCH ONLY — lapisan DOMAIN (DNS)', () => {
  it('google.com di-resolve (dengan SafeSearch)', () => { expect(dns('www.google.com')).toBe('ALLOWED'); expect(c.dns.safeSearchHosts).toContain('www.google.com'); });
  it('youtube/youtu.be/CDN diblokir', () => { for (const h of ['youtube.com', 'www.youtube.com', 'youtu.be', 'i.ytimg.com', 'rr1.googlevideo.com', 'youtube-nocookie.com']) expect(dns(h), h).toBe('BLOCKED'); });
  it('tiktok + CDN diblokir', () => { for (const h of ['tiktok.com', 'v16.tiktokcdn.com', 'api.tiktokv.com', 'byteoversea.com', 'p16.ibytedtos.com']) expect(dns(h), h).toBe('BLOCKED'); });
  it('drive.google.com diblokir (lebih spesifik dari google.com)', () => expect(dns('drive.google.com')).toBe('BLOCKED'));
  it('default deny', () => expect(evaluateDomain(c, 'contoh.com').layer).toBe('DEFAULT'));
  it('DNS TIDAK dapat membedakan path: /maps diizinkan di DNS tetapi diblokir browser', () => { expect(dns('www.google.com')).toBe('ALLOWED'); expect(url('https://www.google.com/maps')).toBe('BLOCKED'); });
});

describe('Prioritas aturan & pengecualian', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  it('pengecualian membuka situs default-deny', () => {
    const x = compilePolicy({ ...base, exceptions: [{ domain: 'geogebra.org', expiresAt: future, source: 'pr1' }] });
    expect(evaluateDomain(x, 'www.geogebra.org').decision).toBe('ALLOWED');
    expect(evaluateUrl('https://www.geogebra.org/calculator', x.browser.URLBlocklist, x.browser.URLAllowlist).decision).toBe('ALLOWED');
  });
  it('pengecualian TIDAK dapat mengalahkan blokir administrator tanpa override', () => {
    const x = compilePolicy({ ...base, exceptions: [{ domain: 'youtube.com', expiresAt: future, source: 'pr1' }] });
    expect(evaluateDomain(x, 'youtube.com').decision).toBe('BLOCKED');
    expect(x.warnings.join()).toMatch(/administrator/);
  });
  it('pengecualian TIDAK dapat mengalahkan kebijakan inti tanpa coreOverride (Super Admin)', () => {
    const x = compilePolicy({ ...base, exceptions: [{ domain: 'nordvpn.com', expiresAt: future, overrideAdminBlock: true, source: 'pr1' }] });
    expect(evaluateDomain(x, 'nordvpn.com').decision).toBe('BLOCKED');
    const y = compilePolicy({ ...base, exceptions: [{ domain: 'nordvpn.com', expiresAt: future, coreOverride: true, source: 'pr1' }] });
    expect(evaluateDomain(y, 'nordvpn.com').decision).toBe('ALLOWED');
  });
  it('TEST 9: pengecualian kedaluwarsa tidak dikompilasi', () => {
    const x = compilePolicy({ ...base, exceptions: [{ domain: 'geogebra.org', expiresAt: new Date(Date.now() - 1000).toISOString(), source: 'pr1' }] });
    expect(evaluateDomain(x, 'geogebra.org').decision).toBe('BLOCKED');
  });
  it('blokir profil (sesi) tidak dapat dibuka oleh profil allow untuk domain inti', () => {
    const x = compilePolicy({ ...base, profile: { ...profile, allowedDomains: ['nordvpn.com'] } });
    expect(evaluateDomain(x, 'nordvpn.com').decision).toBe('BLOCKED');
  });
  it('FULL LOCK: semua ditolak termasuk Google', () => {
    const x = compilePolicy({ ...base, profile: { ...profile, type: 'FULL_LOCK', googleSearch: false } });
    expect(evaluateDomain(x, 'www.google.com').decision).toBe('BLOCKED');
    expect(x.firewall.fullLock).toBe(true);
    expect(evaluateUrl('https://www.google.com/', x.browser.URLBlocklist, x.browser.URLAllowlist).decision).toBe('BLOCKED');
  });
  it('LEARNING MODE menyertakan daftar izin global', () => {
    const x = compilePolicy({ ...base, profile: { ...profile, type: 'LEARNING', includeGlobalAllowlist: true } });
    expect(evaluateDomain(x, 'id.wikipedia.org').decision).toBe('ALLOWED');
  });
});

describe('Generator kebijakan browser', () => {
  it('Linux JSON valid', () => { const j = JSON.parse(linuxPolicyJson(c)); expect(j.URLBlocklist[0]).toBe('*'); expect(j.ForceGoogleSafeSearch).toBe(true); expect(j.IncognitoModeAvailability).toBe(1); });
  it('Windows .reg berisi Chrome & Edge', () => { const r = windowsRegFile(c, 'abc'); expect(r).toContain('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\URLBlocklist]'); expect(r).toContain('Microsoft\\Edge'); expect(r).toContain('"1"="*"'); expect(r).toContain('"ForceGoogleSafeSearch"=dword:00000001'); });
  it('PowerShell installer membuat backup & tanpa token bila tidak diberikan', () => { const s = windowsPowerShellInstaller(c, 'abc', { baseUrl: 'https://x' }); expect(s).toContain('reg.exe export'); expect(s).not.toContain('device.json"'); });
});
