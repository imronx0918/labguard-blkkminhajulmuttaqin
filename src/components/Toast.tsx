import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'warning' | 'info';
interface T { id: number; kind: Kind; title: string; message?: string }
const Ctx = createContext<(kind: Kind, title: string, message?: string) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: Kind, title: string, message?: string) => {
    const id = ++seq;
    setItems((x) => [...x, { id, kind, title, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  const icon = { success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, error: <XCircle className="h-5 w-5 text-red-600" />, warning: <AlertTriangle className="h-5 w-5 text-amber-600" />, info: <Info className="h-5 w-5 text-navy-500" /> };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 no-print" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="card flex items-start gap-3 p-3.5 animate-[fadeIn_.2s_ease]">
            {icon[t.kind]}
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{t.title}</p>{t.message && <p className="mt-0.5 break-words text-xs text-slate-500">{t.message}</p>}</div>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="text-slate-400 hover:text-slate-600" aria-label="Tutup"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
