// Evaluator filter URL yang meniru semantik URLBlocklist/URLAllowlist Chrome Enterprise
// (format: [scheme://][.]host[:port][/path][@query]). Digunakan untuk pengujian otomatis
// dan diagnostik. Ini adalah APROKSIMASI — verifikasi akhir tetap di chrome://policy
// dan browser sungguhan (lihat docs/browser-policy-setup.md).

interface ParsedFilter {
  raw: string;
  scheme?: string;
  exactHost: boolean;
  host: string; // '' = wildcard
  port?: string;
  path: string;
  query: string[];
}

export function parseFilter(raw: string): ParsedFilter | null {
  if (raw === '*') return { raw, exactHost: false, host: '', path: '', query: [] };
  const m = raw.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\.?)([^/:@]+)(?::(\d+|\*))?(\/[^@]*)?(?:@(.*))?$/i);
  if (!m) return null;
  return {
    raw,
    scheme: m[1]?.toLowerCase(),
    exactHost: m[2] === '.',
    host: m[3] === '*' ? '' : m[3].toLowerCase(),
    port: m[4],
    path: m[5] ?? '',
    query: m[6] ? m[6].split('&').filter(Boolean) : [],
  };
}

function matches(f: ParsedFilter, u: URL): boolean {
  const scheme = u.protocol.replace(':', '');
  if (f.scheme && f.scheme !== scheme) return false;
  const host = u.hostname.toLowerCase();
  if (f.host) {
    if (f.exactHost) {
      if (host !== f.host) return false;
    } else if (host !== f.host && !host.endsWith('.' + f.host)) return false;
  }
  if (f.port && f.port !== '*') {
    const port = u.port || (scheme === 'https' ? '443' : scheme === 'http' ? '80' : '');
    if (port !== f.port) return false;
  }
  if (f.path && !u.pathname.startsWith(f.path)) return false;
  for (const q of f.query) {
    const [k, v] = q.split('=');
    const got = u.searchParams.getAll(k);
    if (!got.length) return false;
    if (v !== undefined && v !== '*' && !got.includes(v)) return false;
  }
  return true;
}

function specificity(f: ParsedFilter): number[] {
  return [f.host.length, f.exactHost ? 1 : 0, f.path.length, f.query.length, f.scheme ? 1 : 0, f.port ? 1 : 0];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export interface UrlDecision {
  decision: 'ALLOWED' | 'BLOCKED';
  matchedFilter: string | null;
  list: 'allowlist' | 'blocklist' | 'none';
}

export function evaluateUrl(url: string, blocklist: string[], allowlist: string[]): UrlDecision {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { decision: 'BLOCKED', matchedFilter: null, list: 'none' };
  }
  let best: { f: ParsedFilter; allow: boolean; s: number[] } | null = null;
  const consider = (raw: string, allow: boolean) => {
    const f = parseFilter(raw);
    if (!f || !matches(f, u)) return;
    const s = specificity(f);
    if (!best) return void (best = { f, allow, s });
    const c = cmp(s, best.s);
    if (c > 0 || (c === 0 && allow && !best.allow)) best = { f, allow, s };
  };
  blocklist.forEach((r) => consider(r, false));
  allowlist.forEach((r) => consider(r, true));
  const b = best as { f: ParsedFilter; allow: boolean } | null;
  if (!b) return { decision: 'ALLOWED', matchedFilter: null, list: 'none' };
  return { decision: b.allow ? 'ALLOWED' : 'BLOCKED', matchedFilter: b.f.raw, list: b.allow ? 'allowlist' : 'blocklist' };
}
