import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * A modal on the native `<dialog>` element: the browser traps focus, closes it on Escape and returns focus to
 * the button that opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Room for content that should not wrap, e.g. a URL to copy. */
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClose={onClose}
      className={`m-auto ${wide ? 'w-[min(36rem,calc(100vw-32px))]' : 'w-[min(28rem,calc(100vw-32px))]'} rounded-xl border border-hair bg-surface p-0 text-text shadow-pop backdrop:bg-black/40 ${className}`}
    >
      {open && (
        <div className="p-5">
          <h2 id="dialog-title" className="m-0 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** Label of the confirming button, e.g. "Delete". */
  confirm?: string;
  /** Styles the confirming button as destructive. Defaults to true. */
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** Provides `useConfirm()`: one confirmation dialog for the whole app. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={pending !== null} onClose={() => settle(false)} title={pending?.title ?? ''}>
        {pending?.message && <div className="mt-2 text-sec">{pending.message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => settle(false)}>
            Cancel
          </button>
          {/* The dialog focuses the first button, Cancel, so Enter never confirms a destructive action by accident. */}
          <button
            type="button"
            className={
              pending?.danger === false
                ? 'btn-primary'
                : 'btn border-transparent bg-bad text-white hover:bg-bad hover:opacity-90'
            }
            onClick={() => settle(true)}
          >
            {pending?.confirm ?? 'Confirm'}
          </button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Asks for confirmation in a dialog; resolves to true when confirmed. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm needs a ConfirmProvider');
  return ask;
}
