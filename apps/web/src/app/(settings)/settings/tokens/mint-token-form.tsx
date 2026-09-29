'use client';

import {
  Button,
  Card,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { Copy } from 'lucide-react';
import { useState, useTransition } from 'react';
import type { TokenScope } from '@/lib/contracts';
import {
  DEFAULT_EXPIRY_ID,
  EXPIRY_CHOICES,
  expirySeconds,
  groupScopes,
  mintProblem,
} from '@/lib/tokens-view';
import { mintToken } from './token-actions';

/**
 * Mint a token: a name, the scopes it holds, and how long it lives.
 *
 * No scope is ticked to begin with and there is no "select all": a token whose
 * scopes nobody chose is one somebody will assume is narrower than it is. A
 * scope the API says no token may hold is shown, unticked and disabled, so the
 * reason it is missing is on the screen rather than in a refusal.
 *
 * The minted plaintext lives in this component's state and nowhere else. It is
 * shown until *Done*, and then it is gone — prisme holds only a hash and cannot
 * show it again, which the copy says before anybody needs to find out.
 */
export function MintTokenForm({ scopes }: { scopes: readonly TokenScope[] }) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [expiryId, setExpiryId] = useState(DEFAULT_EXPIRY_ID);
  const [minted, setMinted] = useState<{ token: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const problem = mintProblem(name, chosen);
  const groups = groupScopes(scopes);

  const toggle = (scope: string, on: boolean): void => {
    const next = new Set(chosen);
    if (on) next.add(scope);
    else next.delete(scope);
    setChosen(next);
  };

  const mint = (): void => {
    const seconds = expirySeconds(expiryId);
    if (problem !== null || seconds === undefined) return;
    startTransition(async () => {
      const result = await mintToken({
        name: name.trim(),
        scopes: [...chosen],
        expiresInSeconds: seconds,
      });
      if (!result.ok) {
        toast({ title: result.title, description: result.description, tone: 'error' });
        return;
      }
      setMinted({ token: result.token, name: result.name });
      setName('');
      setChosen(new Set());
      setExpiryId(DEFAULT_EXPIRY_ID);
    });
  };

  const copy = (token: string): void => {
    navigator.clipboard.writeText(token).then(
      () => {
        toast({ title: 'Copied', description: 'Paste it where the script or agent reads it.' });
      },
      () => {
        toast({
          title: 'Not copied',
          description: 'The browser refused the clipboard. Select the token and copy it by hand.',
          tone: 'error',
        });
      },
    );
  };

  if (minted !== null) {
    return (
      <Card className="flex flex-col gap-3 border-status-warning">
        <div>
          <p className="font-medium text-ink">“{minted.name}” is minted. Copy it now.</p>
          <p className="max-w-prose text-sm text-ink-secondary">
            This is the only time prisme shows it: it keeps a hash, and cannot show the token again.
            Lose it and the answer is to revoke it and mint another. Send it in an{' '}
            <code>Authorization: Bearer …</code> header.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="minted-token" className="sr-only">
            The new token
          </Label>
          <Input
            id="minted-token"
            readOnly
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-xs"
            value={minted.token}
            onFocus={(event) => {
              event.target.select();
            }}
          />
          <Button
            onClick={() => {
              copy(minted.token);
            }}
          >
            <Copy aria-hidden className="size-4" />
            Copy
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMinted(null);
            }}
          >
            Done — I have it
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          mint();
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field className="min-w-64 flex-1">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={100}
              placeholder="Ritual loader"
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <FieldHint>What will use it, so the list below says whose it is.</FieldHint>
          </Field>
          <Field>
            <Label htmlFor="token-expiry">Expires after</Label>
            <Select value={expiryId} onValueChange={setExpiryId}>
              <SelectTrigger id="token-expiry" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_CHOICES.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint>Never longer than a year.</FieldHint>
          </Field>
        </div>

        {groups.map((group) => (
          <fieldset key={group.kind} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-ink">
              {group.label} <span className="font-normal text-ink-muted">— {group.hint}</span>
            </legend>
            {group.items.map((scope) => (
              <label
                key={scope.name}
                className={
                  scope.grantable
                    ? 'flex items-start gap-2 text-sm text-ink'
                    : 'flex items-start gap-2 text-sm text-ink-muted'
                }
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!scope.grantable}
                  checked={chosen.has(scope.name)}
                  onChange={(event) => {
                    toggle(scope.name, event.target.checked);
                  }}
                />
                <span>
                  <code className="text-xs">{scope.name}</code>{' '}
                  <span className="text-ink-secondary">— {scope.description}</span>
                  {scope.grantable ? null : (
                    <span className="block text-xs">
                      Only you hold this, signed in. No token may — one that could mint tokens would
                      make every other token’s scopes meaningless.
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || problem !== null}>
            {pending ? 'Minting…' : 'Mint token'}
          </Button>
          {problem === null ? (
            <span className="text-xs text-ink-muted">
              {String(chosen.size)} scope{chosen.size === 1 ? '' : 's'} chosen.
            </span>
          ) : (
            <span className="text-xs text-ink-muted">{problem}</span>
          )}
        </div>
      </form>
    </Card>
  );
}
