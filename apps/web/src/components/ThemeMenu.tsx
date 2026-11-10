import { THEMES, type Theme } from '@heartline/shared';
import { useTheme } from '../lib/theme.ts';
import { Icon } from './Icon.tsx';
import { usePopover } from './Popover.tsx';
import { Segmented } from './Segmented.tsx';

const NAMES: Record<Theme, string> = {
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  amber: 'Amber',
  rose: 'Rose',
};
/** Swatch hue per theme, matching `--h` in styles.css. */
const HUE: Record<Theme, number> = { green: 155, blue: 255, violet: 295, amber: 75, rose: 15 };

/** Theme button with a popover for the colour and dark or light appearance. */
export function ThemeMenu({ placement = 'below' }: { placement?: 'below' | 'above' }) {
  const { dark, accent, setDark, setAccent } = useTheme();
  const { ref: popRef, ...pop } = usePopover();
  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        className="icon-btn"
        aria-label="Theme"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        <Icon name="palette" size={16} />
      </button>
      {pop.open && (
        <div
          role="dialog"
          aria-label="Theme"
          className={`popover right-0 w-52 p-2 ${placement === 'above' ? 'bottom-10' : 'top-10'}`}
        >
          <div className="px-2 pb-1 text-[12px] font-medium text-muted">Colour</div>
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={accent === t}
              onClick={() => setAccent(t)}
              className={`menu-item ${accent === t ? 'bg-fill font-medium' : ''}`}
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-[4px]"
                style={{ background: `oklch(62% 0.15 ${HUE[t]})` }}
              />
              <span className="flex-1">{NAMES[t]}</span>
              {accent === t && <Icon name="check" size={14} />}
            </button>
          ))}
          <div className="mt-2 border-t border-hair pt-2">
            <Segmented
              label="Appearance"
              value={dark ? 'dark' : 'light'}
              onChange={(v) => setDark(v === 'dark')}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
