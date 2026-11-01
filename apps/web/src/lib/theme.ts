import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const isDark = () => document.documentElement.classList.contains('dark');

export function useTheme(): { dark: boolean; toggle: () => void } {
  const dark = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isDark,
    () => true,
  );
  const toggle = useCallback(() => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
    for (const l of listeners) l();
  }, []);
  return { dark, toggle };
}
