import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, Loader2, X, RefreshCw } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
const variants: Record<Variant, string> = {
  primary: 'bg-navy-700 text-white hover:bg-navy-800 shadow-sm',
  secondary: 'bg-soft-100 text-navy-800 hover:bg-soft-200',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', variants[variant], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);

export function Card({ children, className, title, subtitle, actions }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <div><h3 className="text-sm font-bold text-slate-800">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'navy' | 'violet';
const tones: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20', amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  blue: 'bg-soft-50 text-navy-600 ring-navy-500/20', slate: 'bg-slate-100 text-slate-600 ring-slate-500/20', navy: 'bg-navy-700 text-white ring-navy-700', violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};
export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  ALLOWED: 'green', BLOCKED: 'red', POLICY_APPLIED: 'green', POLICY_FAILED: 'red', DEVICE_ONLINE: 'blue', DEVICE_OFFLINE: 'slate', GATEWAY_ERROR: 'red', BYPASS_ATTEMPT: 'violet',
  OK: 'green', ERROR: 'red', DISABLED: 'slate', NOT_CONFIGURED: 'amber', UNKNOWN: 'slate',
  ONLINE: 'green', OFFLINE: 'red', PARTIAL: 'amber', PAIRED: 'green', UNPAIRED: 'amber', REVOKED: 'red',
  SCHEDULED: 'blue', ACTIVE: 'green', ENDED: 'slate', CANCELLED: 'slate',
  SECURED: 'green', PENDING_CONFIRMATION: 'amber', FAILED: 'red', SIMULATED_DEMO: 'violet', NO_GATEWAY: 'amber', NOT_STARTED: 'slate',
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', EXPIRED: 'slate', CONFIRMED: 'green', SUPERSEDED: 'slate', ROLLED_BACK: 'red',
  UP_TO_DATE: 'green', OUTDATED: 'amber', SUCCESS: 'green', FAILURE: 'red', DENIED: 'red', active: 'green', disabled: 'slate', issued: 'green', none: 'amber', revoked: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  SECURED: 'Aman (terkonfirmasi)', PENDING_CONFIRMATION: 'Menunggu konfirmasi gateway', SIMULATED_DEMO: 'DEMO — disimulasikan', NO_GATEWAY: 'Belum ada gateway', NOT_STARTED: 'Belum dimulai',
  NOT_CONFIGURED: 'Belum dikonfigurasi', UP_TO_DATE: 'Terbaru', OUTDATED: 'Belum terbaru', SCHEDULED: 'Terjadwal', ACTIVE: 'Berlangsung', ENDED: 'Selesai', CANCELLED: 'Dibatalkan',
  PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak', REVOKED: 'Dicabut', EXPIRED: 'Kedaluwarsa', CONFIRMED: 'Terkonfirmasi', SUPERSEDED: 'Digantikan', ROLLED_BACK: 'Rollback',
  UNPAIRED: 'Belum dipasangkan', PAIRED: 'Terpasang', active: 'Aktif', disabled: 'Nonaktif', issued: 'Diterbitkan', none: 'Belum ada', revoked: 'Dicabut', UNKNOWN: 'Tidak diketahui', DISABLED: 'Nonaktif',
};
export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <Badge>—</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? 'slate'}>{label ?? STATUS_LABEL[status] ?? status}</Badge>;
}
export function Dot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {on && pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cx('relative inline-flex h-2.5 w-2.5 rounded-full', on ? 'bg-emerald-500' : 'bg-slate-300')} />
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && <div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-navy-700 text-white shadow-sm sm:flex">{icon}</div>}
        <div><h1 className="text-xl font-extrabold tracking-tight text-navy-900 sm:text-2xl">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}</div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} {...p} className={cx('input', p.className)} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((p, ref) => <textarea ref={ref} {...p} className={cx('input min-h-[80px]', p.className)} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>((p, ref) => <select ref={ref} {...p} className={cx('input pr-8', p.className)} />);

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-navy-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span><span className="text-sm font-medium text-slate-700">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', w)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-navy-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup"><X className="h-5 w-5" /></button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Ya, lanjutkan', danger, loading, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      <div className="flex gap-3">
        {danger && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50"><AlertTriangle className="h-5 w-5 text-red-600" /></div>}
        <div className="text-sm text-slate-600">{message}{children}</div>
      </div>
    </Modal>
  );
}

export function Loading({ label = 'Memuat data…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-navy-500" />{label}</div>;
}
export function Empty({ title = 'Belum ada data', message, action, icon }: { title?: string; message?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-soft-50 text-navy-400">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500"><AlertTriangle className="h-6 w-6" /></div>
      <p className="text-sm font-semibold text-slate-700">Gagal memuat data</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{(error as Error)?.message ?? String(error)}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-4" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>Coba lagi</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={cx('-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition', value === t.key ? 'border-navy-600 text-navy-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/70"><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <Empty />}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Cari…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => v !== value && onChange(v), 300); return () => clearTimeout(t); }, [v]); // eslint-disable-line
  return <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="sm:w-64" type="search" />;
}

export function KeyVal({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 py-2 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>;
}

export function DemoTag() {
  return <Badge tone="violet">DEMO</Badge>;
}
