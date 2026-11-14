// Klien API: semua data berasal dari backend (Firestore via Admin SDK). Tidak ada secret di frontend.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { path: string; message: string }[]) { super(message); }
}

let tokenProvider: (() => Promise<string | null>) | null = null;
let onUnauthorized: (() => void) | null = null;
export function setTokenProvider(fn: () => Promise<string | null>) { tokenProvider = fn; }
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const token = tokenProvider ? await tokenProvider() : null;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const e = (data as any)?.error;
    const detail = e?.details?.length ? ': ' + e.details.map((d: any) => `${d.path ? d.path + ' — ' : ''}${d.message}`).join('; ') : '';
    throw new ApiError(res.status, (e?.message ?? `Permintaan gagal (${res.status})`) + detail, e?.code, e?.details);
  }
  return data as T;
}

/** Unduh file dari endpoint terautentikasi */
export async function download(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
