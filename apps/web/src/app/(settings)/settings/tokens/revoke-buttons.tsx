'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { revokeAllTokens, revokeToken, type TokenResult } from './token-actions';

/**
 * Revoking, one token or every one, behind a confirmation.
 *
 * Both confirm because neither can be undone: a revoked token is revoked for
 * good, and getting access back means minting another and handing it out
 * again. Revoking every token asks for the words typed as well, because it is
 * the button pressed in a hurry — the morning a laptop goes missing — and it
 * signs out every script at once.
 *
 * Neither touches the session revoking them: a signed-in person is not a token.
 */

function useRevocation() {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const run = (action: () => Promise<TokenResult>, done: () => void): void => {
    startTransition(async () => {
      const result = await action();
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) {
        done();
        router.refresh();
      }
    });
  };

  return { pending, run };
}

export function RevokeTokenButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRevocation();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setOpen(true);
        }}
      >
        Revoke
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{name}”?</DialogTitle>
            <DialogDescription>
              Whatever uses it is refused from its next request. This cannot be undone — to give it
              access again, mint a new token.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                run(
                  () => revokeToken({ id }),
                  () => {
                    setOpen(false);
                  },
                );
              }}
            >
              {pending ? 'Revoking…' : 'Revoke it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CONFIRMATION = 'revoke all';

export function RevokeAllTokensButton({ live }: { live: number }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const { pending, run } = useRevocation();
  const confirmed = typed.trim().toLowerCase() === CONFIRMATION;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || live === 0}
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
      >
        Revoke all
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke all {String(live)} live token{live === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              Every script, agent and MCP client is refused from its next request. Your own session
              is not affected, so you can mint new ones straight away.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmed) return;
              run(revokeAllTokens, () => {
                setOpen(false);
              });
            }}
          >
            <Field>
              <Label htmlFor="revoke-all-confirmation">
                Type <strong>{CONFIRMATION}</strong> to confirm
              </Label>
              <Input
                id="revoke-all-confirmation"
                autoComplete="off"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </Field>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending || !confirmed}>
                {pending ? 'Revoking…' : 'Revoke every token'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
