import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from './Icon.tsx';

export type ToastTone = 'ok' | 'bad' | 'neutral';
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

let items: ToastItem[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message in the corner. Errors stay until dismissed; others disappear after a few seconds. */
export function toast(text: string, tone: ToastTone = 'ok'): void {
  items = [...items.slice(-3), { id: next++, text, tone }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const TONE: Record<ToastTone, string> = {
  ok: 'border-hair bg-surface text-text',
  bad: 'border-bad-line bg-bad-bg text-bad-text',
  neutral: 'border-hair bg-surface text-sec',
};

function Item({ t }: { t: ToastItem }) {
  useEffect(() => {
    if (t.tone === 'bad') return;
    const timer = setTimeout(() => dismiss(t.id), 4000);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div
      role={t.tone === 'bad' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-pop ${TONE[t.tone]}`}
    >
      {t.tone === 'ok' && <Icon name="check" size={15} className="mt-px shrink-0 text-ok" />}
      <span className="min-w-0 flex-1">{t.text}</span>
      <button
        type="button"
        className="-mr-1 shrink-0 opacity-70 hover:opacity-100"
        onClick={() => dismiss(t.id)}
      >
        <Icon name="x" size={14} />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}

/** Renders the queued toasts; mounted once at the root. */
export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-32px))] flex-col gap-2">
      {list.map((t) => (
        <Item key={t.id} t={t} />
      ))}
    </div>
  );
}
