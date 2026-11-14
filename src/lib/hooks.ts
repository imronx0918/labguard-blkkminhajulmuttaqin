import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';
import { useToast } from '../components/Toast';

export interface Page<T> { items: T[]; nextCursor: string | null }

export function useList<T = any>(path: string, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: [path], queryFn: () => api<Page<T>>(path), enabled: opts.enabled ?? true, refetchInterval: opts.refetchInterval });
}
export function useGet<T = any>(path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, refetchInterval: opts.refetchInterval });
}
/** Pagination berbasis cursor (untuk tabel log besar). */
export function usePaged<T = any>(base: string, params: string, opts: { refetchInterval?: number } = {}) {
  return useInfiniteQuery({
    queryKey: [base, params],
    queryFn: ({ pageParam }) => api<Page<T>>(`${base}${params}${params ? '&' : '?'}limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: opts.refetchInterval,
  });
}

/** Mutasi dengan toast + invalidasi cache. */
export function useAction<V = any, R = any>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: string[]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast('success', typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(k) });
      opts.onSuccess?.(r);
    },
    onError: (e: any) => toast('error', 'Gagal', e.message),
  });
}

/** Data referensi untuk dropdown */
export function useLookups() {
  const labs = useList<any>('/laboratories?limit=200');
  const classes = useList<any>('/classes?limit=200');
  const policies = useList<any>('/policies');
  const labName = (id?: string | null) => labs.data?.items.find((l) => l.id === id)?.name ?? '—';
  const className = (id?: string | null) => classes.data?.items.find((c) => c.id === id)?.name ?? '—';
  const policyName = (id?: string | null) => policies.data?.items.find((p) => p.id === id)?.name ?? '—';
  return { labs: labs.data?.items ?? [], classes: classes.data?.items ?? [], policies: policies.data?.items ?? [], labName, className, policyName };
}
