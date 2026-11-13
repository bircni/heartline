import { THEMES, type Theme } from '@heartline/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { forget, save, saved, subscribe } from './store.ts';

/*
 * Appearance (dark or light) and colour theme. Both are saved per browser; the colour falls back to the
 * site's default from status.yaml. public/theme-init.js applies the saved values before the first paint.
 */

const root = () => document.documentElement;
const accentNow = () => (root().dataset.accent as Theme | undefined) ?? 'green';

/** Dark, light, or whatever the operating system uses (the default). */
export type Appearance = 'dark' | 'light' | 'system';

const lightQuery = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

function appearanceNow(): Appearance {
  const v = saved('theme');
  return v === 'dark' || v === 'light' ? v : 'system';
}

/** Dark unless the choice, or with `system` the operating system, says light. */
function applyAppearance(mode: Appearance) {
  const light = mode === 'light' || (mode === 'system' && Boolean(lightQuery()?.matches));
  root().classList.toggle('dark', !light);
}

// Follow the operating system while the appearance is `system`, e.g. when it switches at sunset.
lightQuery()?.addEventListener?.('change', () => {
  if (appearanceNow() === 'system') applyAppearance('system');
});

export function useTheme(): {
  appearance: Appearance;
  accent: Theme;
  setAppearance: (mode: Appearance) => void;
  setAccent: (accent: Theme) => void;
} {
  const appearance = useSyncExternalStore(subscribe, appearanceNow, () => 'system' as Appearance);
  const accent = useSyncExternalStore(subscribe, accentNow, () => 'green' as Theme);
  const setAppearance = useCallback((next: Appearance) => {
    applyAppearance(next);
    if (next === 'system') forget('theme');
    else save('theme', next);
  }, []);
  const setAccent = useCallback((next: Theme) => {
    root().dataset.accent = next;
    save('accent', next);
  }, []);
  return { appearance, accent, setAppearance, setAccent };
}

/** Applies the site's default colour unless this browser picked one. */
export function useSiteAccent(siteDefault: Theme | undefined) {
  useEffect(() => {
    if (!siteDefault) return;
    const own = saved('accent');
    if (!own || !(THEMES as readonly string[]).includes(own)) root().dataset.accent = siteDefault;
    // theme-init.js paints this before the next visit's bootstrap request returns; saving also tells
    // subscribers that the accent may have changed.
    save('site-accent', siteDefault);
  }, [siteDefault]);
}
