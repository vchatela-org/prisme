/**
 * The theme preference, without a `'use client'` boundary.
 *
 * These three things are needed on **both** sides: the server reads the cookie
 * while rendering the root layout, and the provider writes it in the browser.
 * They live in their own module because a value exported from a `'use client'`
 * file cannot be called from a server component — Next refuses with "attempted
 * to call it from the server", which is a runtime error the type checker and
 * the build are both perfectly happy with. It only shows up when the page is
 * actually requested, which is why the gallery is run and not merely built.
 */

/** `system` follows the operating system; the other two override it. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The cookie the server reads to render the right theme on the first paint. */
export const THEME_COOKIE = 'prisme-theme';

/** Parses the cookie value. Anything unexpected is `system`. */
export function parseThemePreference(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
