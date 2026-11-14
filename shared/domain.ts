// Utilitas normalisasi & validasi domain/URL. Dipakai frontend, backend, compiler.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeDomain(input: string): string {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  d = d.replace(/:\d+$/, '');
  d = d.replace(/^\*\./, '').replace(/^\./, '').replace(/\.$/, '');
  return d;
}

export function isValidDomain(d: string): boolean {
  if (!d || d.length > 253) return false;
  const parts = d.split('.');
  if (parts.length < 2) return false;
  if (/^\d+$/.test(parts[parts.length - 1])) return false; // bukan IP
  return parts.every((p) => LABEL.test(p));
}

export function isIpAddress(h: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
}

/** true bila host sama dengan domain atau merupakan subdomain darinya */
export function domainMatches(host: string, domain: string, includeSubdomains = true): boolean {
  host = normalizeDomain(host);
  domain = normalizeDomain(domain);
  if (host === domain) return true;
  return includeSubdomains && host.endsWith('.' + domain);
}

/** Validasi pola filter URL Chrome: [scheme://][.]host[:port][/path][@query] */
export function isValidUrlFilter(f: string): boolean {
  if (!f || f.length > 500 || /\s/.test(f)) return false;
  if (f === '*') return true;
  const m = f.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\.?)([^/:@]+)(?::(\d+|\*))?(\/[^@]*)?(?:@(.*))?$/i);
  if (!m) return false;
  const host = m[3].toLowerCase();
  if (host === '*') return true;
  return isValidDomain(host.replace(/^\*\./, '')) || isIpAddress(host) || host === 'localhost';
}

export function extractHostFromUrl(url: string): string | null {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}
