import { useSyncExternalStore } from 'react';

/*
 * Per-browser preferences in localStorage, readable from React. Every write notifies all subscribers, so two
 * components showing the same preference stay in step. Storage can be unavailable (private mode); reads then
 * return null and writes are dropped.
 */

const listeners = new Set<() => void>();

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

export function saved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  notify();
}

export function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
  notify();
}

/** A stored choice among `options`, `fallback` when unset or unknown. */
export function useStoredChoice<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const read = () => {
    const v = saved(key);
    return v !== null && (options as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  return [value, (next: T) => save(key, next)];
}
