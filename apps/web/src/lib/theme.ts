import { THEMES, type Theme } from '@heartline/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { notify, save, saved, subscribe } from './store.ts';

/*
 * Appearance (dark or light) and colour theme. Both are saved per browser; the colour falls back to the
 * site's default from status.yaml. public/theme-init.js applies the saved values before the first paint.
 */

const root = () => document.documentElement;
const isDark = () => root().classList.contains('dark');
const accentNow = () => (root().dataset.accent as Theme | undefined) ?? 'green';

export function useTheme(): {
  dark: boolean;
  accent: Theme;
  setDark: (dark: boolean) => void;
  setAccent: (accent: Theme) => void;
} {
  const dark = useSyncExternalStore(subscribe, isDark, () => true);
  const accent = useSyncExternalStore(subscribe, accentNow, () => 'green' as Theme);
  const setDark = useCallback((next: boolean) => {
    root().classList.toggle('dark', next);
    save('theme', next ? 'dark' : 'light');
  }, []);
  const setAccent = useCallback((next: Theme) => {
    root().dataset.accent = next;
    save('accent', next);
  }, []);
  return { dark, accent, setDark, setAccent };
}

/** Applies the site's default colour unless this browser picked one. */
export function useSiteAccent(siteDefault: Theme | undefined) {
  useEffect(() => {
    if (!siteDefault) return;
    // theme-init.js paints this before the next visit's bootstrap request returns.
    save('site-accent', siteDefault);
    const own = saved('accent');
    if (own && (THEMES as readonly string[]).includes(own)) return;
    root().dataset.accent = siteDefault;
    notify();
  }, [siteDefault]);
}
