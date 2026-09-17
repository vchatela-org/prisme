import { ThemeProvider } from '@prisme/ui';
import { parseThemePreference, THEME_COOKIE } from '@prisme/ui/server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import '../styles/globals.css';

export const metadata = {
  title: 'prisme',
  description: 'The decision layer between thinking and doing.',
};

/**
 * The root layout: the stylesheet, the theme, and nothing else.
 *
 * The theme is read from a cookie **here, on the server**, and stamped onto
 * `<html>` before anything paints. The alternative — a blocking inline script
 * that reads `localStorage` — is what most applications do, and it is exactly
 * what the content security policy W14 is bringing refuses. A reader who has
 * not chosen anything gets `data-theme` unset and is served by the
 * `prefers-color-scheme` media query in the generated stylesheet, which needs
 * no JavaScript at all.
 *
 * `suppressHydrationWarning` on `<html>` covers the one attribute the client
 * may correct after a change made in another tab.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const preference = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={preference === 'system' ? undefined : preference}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider initial={preference}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
