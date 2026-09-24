'use client';

import { setNonce } from 'get-nonce';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * The page's CSP nonce, for the stylesheets a *dependency* injects at runtime.
 *
 * W07 moved prisme's own colour off `style` attributes and the twelve Radix
 * violations that remained were closed with `pnpm patch`es. Two survived
 * because they are a different thing: Radix's `Select` and the scroll lock
 * underneath it **append `<style>` elements to the document** when a popup
 * opens, and a `<style>` element is what `style-src 'self' 'nonce-…'` exists to
 * authorise. A nonce is exactly the mechanism for this, both libraries already
 * have one —
 *
 *   - `@radix-ui/react-select`'s viewport takes a `nonce` prop and puts it on
 *     its `<style>` element, and prisme never passed one;
 *   - `react-remove-scroll-bar` builds its tag through `react-style-singleton`,
 *     which reads the nonce from `get-nonce` — the module whose whole purpose
 *     is to be told, once, what the page's nonce is.
 *
 * Neither is a patch and neither widens the policy. What was missing was the
 * **value**: a nonce is minted per request by the middleware, the browser is
 * never told it, and a client component cannot read a response header. The
 * middleware already puts it on the *forwarded request* as `x-nonce` (that is
 * how Next applies it to its own scripts), so the server layout reads it there
 * and mounts this provider around the tree.
 *
 * ### Why the nonce has to be set before anything renders, not in an effect
 *
 * `setNonce` is read at the moment a dependency builds its tag, and Radix
 * mounts its scroll-lock sheet while a popup is *opening*. An effect would
 * usually win that race and would be a bug when it did not, so the call happens
 * during render — it is idempotent, it writes one module-level variable, and
 * the value cannot change within a document's life. It is guarded to the client
 * because a server render has no stylesheets to authorise and because a
 * module-level nonce in a server process would be one request's value visible
 * to the next.
 *
 * ### What this does not do
 *
 * It does not authorise a `style` **attribute** — a nonce never can, which is
 * why `no-inline-style.test.tsx` still refuses them one by one. It authorises
 * `<style>` elements, and only the ones that carry the value it hands out.
 */
const NonceContext = createContext<string | undefined>(undefined);

/** The page's nonce, or `undefined` when nothing supplied one. */
export function useCspNonce(): string | undefined {
  return useContext(NonceContext);
}

export interface CspNonceProviderProps {
  /** The per-request nonce from `x-nonce`, or `undefined` if none was sent. */
  readonly nonce: string | undefined;
  readonly children: ReactNode;
}

export function CspNonceProvider({ nonce, children }: CspNonceProviderProps) {
  if (typeof window !== 'undefined' && nonce !== undefined && nonce !== '') {
    setNonce(nonce);
  }

  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
}
