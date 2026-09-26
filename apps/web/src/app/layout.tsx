import { AreaColorProvider, CspNonceProvider, ThemeProvider } from '@prisme/ui';
import { parseThemePreference, THEME_COOKIE } from '@prisme/ui/server';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { instanceAreaColors } from '../lib/area-pins';
import '../styles/globals.css';

export const metadata = {
  title: 'prisme',
  description: 'The decision layer between thinking and doing.',
};

/**
 * The root layout: the stylesheet, the theme, and the area-colour pinning.
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
 *
 * ## Why the pinning is mounted here
 *
 * `AreaColorProvider` carries an instance's area → palette slot map down the
 * tree, so no call site has to pass it and no two call sites can disagree.
 * Since W07 it has existed in `packages/ui` and **nothing but the gallery
 * mounted it**, which is why area colour collides on every other screen: the
 * palette has eight slots, most area sets hash two of them together, and the
 * map that resolves the collision was never in the tree. W09 recorded it, W10
 * and W11 confirmed it, and this is the one mount it needed.
 *
 * It sits **outside** the route groups' own providers on purpose. The gallery
 * mounts a provider of its own with the invented fixture keys, and an inner
 * provider wins — which is what keeps the gallery showing its fixture colours
 * while every other screen gets the instance's.
 *
 * The map is the instance's own: a colour chosen on the Settings screen, else
 * the `AREA_COLOR_PINS` entry, else the key's hash (`instanceAreaColors`).
 *
 * ## The nonce, and why it is read here
 *
 * `CspNonceProvider` carries the **per-request CSP nonce** so that the
 * `<style>` elements a dependency appends at runtime — Radix's select viewport,
 * the scroll lock underneath a popup — are authorised instead of refused. The
 * middleware mints that nonce and puts it on the *forwarded request* as
 * `x-nonce`, which is the one channel a server component can read it from: the
 * browser is never told it and a client component cannot see a response header.
 *
 * It is mounted here, once, for every route — a screen that forgot it would be
 * a screen whose popups log violations, which is the failure this exists to
 * make impossible. See `@prisme/ui`'s `lib/csp-nonce.tsx`.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const preference = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const areaColors = await instanceAreaColors();

  return (
    <html
      lang="en"
      data-theme={preference === 'system' ? undefined : preference}
      suppressHydrationWarning
    >
      <body>
        <CspNonceProvider nonce={nonce}>
          <AreaColorProvider overrides={areaColors}>
            <ThemeProvider initial={preference}>{children}</ThemeProvider>
          </AreaColorProvider>
        </CspNonceProvider>
      </body>
    </html>
  );
}
