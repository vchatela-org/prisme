'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING } from '../lib/focus.js';
import { THEME_COOKIE, type ThemePreference } from './theme-preference.js';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/**
 * The theme, without a flash and without an inline script.
 *
 * The usual fix for "the page paints light and then turns dark" is a blocking
 * inline `<script>` in the head. prisme does not do that: W14 puts a strict
 * content security policy on this application, and an inline script is exactly
 * what such a policy exists to refuse — it would have to be carved out with a
 * nonce or a hash, and a carve-out in the CSP for the design system is a poor
 * trade for one frame of colour.
 *
 * Instead the preference is a **cookie**, the server stamps `data-theme` on
 * `<html>` while rendering, and the OS preference works with no JavaScript at
 * all through the media query in the generated stylesheet. This component only
 * has to keep the attribute and the cookie in step after a change.
 */
export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: ReactNode;
  initial?: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initial);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);

    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.dataset['theme'] = next;

    // A year, path-wide, and `SameSite=Lax`: it is a display preference, it is
    // not a credential, and it must not ride along on a cross-site request.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  // Reconciles the attribute if the server and the client ever disagree —
  // a cookie written in another tab, for instance.
  useEffect(() => {
    const root = document.documentElement;
    const current = root.dataset['theme'];
    if (preference === 'system' && current) root.removeAttribute('data-theme');
    else if (preference !== 'system' && current !== preference) root.dataset['theme'] = preference;
  }, [preference]);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
  { value: 'system', label: 'System', icon: <Monitor className="size-3.5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
];

/**
 * Three states rather than a switch: "system" is a real choice, and a two-way
 * toggle silently overrides an operating system set to change at sunset.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex rounded-md border border-border-strong p-0.5', className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          onClick={() => {
            setPreference(option.value);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-ink-secondary',
            'hover:text-ink',
            preference === option.value &&
              'bg-accent-solid text-ink-on-accent hover:text-ink-on-accent',
            FOCUS_RING,
          )}
        >
          {option.icon}
          <span className="sr-only sm:not-sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
