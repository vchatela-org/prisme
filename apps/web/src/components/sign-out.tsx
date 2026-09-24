'use client';

import { Button, useToast } from '@prisme/ui';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { LogoutResult } from '@/lib/oidc';

/**
 * Signing out, which until now nothing in the application could do.
 *
 * `POST /auth/logout` exists, is origin-checked, and was verified end to end
 * against a real provider (ADR-0026's follow-up entry), but **no screen called
 * it**: the only way to end a session was to clear cookies by hand. A control
 * that ends the session is an obligation ADR-0026 lists, and it is what makes
 * the login flow usable — a session that cannot be ended is a session somebody
 * shares a laptop with.
 *
 * ### A `fetch`, and not a form — measured, not preferred
 *
 * `<form method="post" action="/auth/logout">` is the obvious control and it is
 * refused: the web tier sends `Referrer-Policy: no-referrer`, and on a form
 * submission from such a document a browser sends **`Origin: null`** — a value
 * the origin check refuses on purpose, because `null` is also what a sandboxed
 * cross-site frame sends. A `fetch` from the same page carries the real origin
 * and passes. Both were driven in a browser before this file was written.
 *
 * ### Where it goes afterwards, and why the route is asked
 *
 * Clearing prisme's cookie is not the whole of signing out: the identity
 * provider usually holds a session of its own, and leaving it is what makes the
 * next visit sign back in without a prompt. Ending that one means *navigating*
 * the browser to the provider's end-session endpoint, and a page cannot build
 * that URL — it is server configuration. A `fetch` cannot read it either: the
 * browser refuses to follow the route's cross-origin redirect at all, so a
 * script that merely followed redirects would end nothing.
 *
 * So the route is asked, in the one shape a script can read — JSON — and hands
 * back the destination (`apps/web/src/app/auth/logout/route.ts`). It is the
 * single place that decides what "signed out" means; this control only goes
 * where it is told.
 *
 * With no `OIDC_END_SESSION_ENDPOINT` configured the answer is `null`, and the
 * login route is where the reader lands. That configuration is supported and
 * says so in one sentence on the route's own answer — the provider may still
 * hold a session and may sign them straight back in, which is the provider's
 * session rather than prisme's, and prisme does not pretend otherwise.
 */
export function SignOut() {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function signOut(): Promise<void> {
    setBusy(true);

    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const parsed = LogoutResult.safeParse(await response.json().catch(() => null));

      if (!response.ok || !parsed.success) {
        // No detail, and nothing echoed back: this is a refusal on a screen
        // `docs/14-threat-model.md` §5 counts as a boundary like any other.
        setBusy(false);
        toast({
          title: 'Could not sign out',
          description: 'The session may still be active. Reload the page and try again.',
          tone: 'error',
        });
        return;
      }

      window.location.assign(parsed.data.endSessionUrl ?? '/auth/login');
    } catch {
      setBusy(false);
      toast({
        title: 'Could not sign out',
        description: 'The session may still be active. Reload the page and try again.',
        tone: 'error',
      });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => {
        void signOut();
      }}
    >
      <LogOut aria-hidden />
      <span className="sr-only sm:not-sr-only">Sign out</span>
    </Button>
  );
}
