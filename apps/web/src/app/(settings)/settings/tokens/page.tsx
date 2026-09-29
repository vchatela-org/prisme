import { Badge, Card, EmptyState, Section, relativeTime } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { apiTokenListSchema, tokenScopeListSchema, type ApiToken } from '@/lib/contracts';
import { orderTokens, tokenState, type TokenState } from '@/lib/tokens-view';
import { MintTokenForm } from './mint-token-form';
import { RevokeAllTokensButton, RevokeTokenButton } from './revoke-buttons';

export const metadata = { title: 'API tokens · Settings · prisme' };

/**
 * API tokens — how a script, an agent or an MCP client gets into prisme.
 *
 * "Minted from the UI, which is itself behind the identity provider"
 * (docs/14-threat-model.md §3, ADR-0015): this is that UI. A signed-in person
 * needs no token — the session carries every scope, `admin:tokens` included,
 * which is what lets this screen exist — and no token may ever hold
 * `admin:tokens`, so nothing a token can do reaches this screen's calls.
 *
 * Revoked and expired tokens stay listed below the live ones: the list is the
 * record of what was ever let in, and `lastUsedAt` is what shows a token nobody
 * uses any more.
 */
export default async function TokensPage() {
  const now = new Date();
  const [tokens, scopes] = await Promise.all([
    apiFetch({ path: '/tokens', schema: apiTokenListSchema }),
    apiFetch({ path: '/tokens/scopes', schema: tokenScopeListSchema }),
  ]);
  const live = tokens.ok ? tokens.data.items.filter((token) => token.active).length : 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-xs text-ink-muted">
          <Link className="underline underline-offset-2" href="/settings">
            Settings
          </Link>{' '}
          › API tokens
        </p>
        <h1 className="text-xl font-semibold text-ink">API tokens</h1>
        <div className="flex max-w-prose flex-col gap-2 text-sm text-ink-secondary">
          <p>
            Scripts, agents and MCP clients cannot sign in the way you do, so each gets a token: a
            name, the scopes it may use, and an expiry. Give each one only what it needs — a token
            that loads rituals needs <code>write:ritual</code> and nothing else.
          </p>
          <p>
            You do not need one. Signed in, you hold every scope; managing tokens is one of them,
            and it is the one no token can be given.
          </p>
        </div>
      </header>

      <Section
        title="Mint a token"
        description="The token is shown once, when it is minted. prisme keeps only a hash of it."
      >
        {scopes.ok ? (
          <MintTokenForm scopes={scopes.data.items} />
        ) : (
          <ApiFailureState failure={scopes} surface="the scopes a token can hold" />
        )}
      </Section>

      <Section
        title="Tokens"
        description="Live ones first. Revoking takes effect on the token’s next request."
        actions={tokens.ok ? <RevokeAllTokensButton live={live} /> : null}
      >
        {!tokens.ok ? (
          <ApiFailureState failure={tokens} surface="the API tokens" />
        ) : tokens.data.items.length === 0 ? (
          <EmptyState
            title="No tokens yet"
            description="Nothing but you, signed in, can reach the API. Mint one above when a script or an agent needs to."
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Every API token, live ones first.</caption>
              <thead>
                <tr className="border-b border-border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Scopes
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Expires
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last used
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">State</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orderTokens(tokens.data.items).map((token) => (
                  <TokenRow key={token.id} token={token} now={now} />
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </div>
  );
}

const STATE_LABEL: Readonly<Record<Exclude<TokenState, 'active'>, string>> = {
  revoked: 'revoked',
  expired: 'expired',
};

/** A day for creation and expiry, which are read as dates; "3 days ago" for use. */
function When({ at, now }: { at: string; now?: Date }) {
  return (
    <time dateTime={at} title={at}>
      {now === undefined ? at.slice(0, 10) : relativeTime(new Date(at), now)}
    </time>
  );
}

function TokenRow({ token, now }: { token: ApiToken; now: Date }) {
  const state = tokenState(token);
  const live = state === 'active';

  return (
    <tr
      className={
        live
          ? 'border-b border-border-hairline align-top last:border-b-0'
          : 'border-b border-border-hairline align-top text-ink-muted last:border-b-0'
      }
    >
      <td className="px-3 py-2">
        <div className={live ? 'font-medium text-ink' : 'font-medium'}>{token.name}</div>
        <div className="text-xs text-ink-muted">{token.id}</div>
      </td>
      <td className="px-3 py-2">
        <ul className="flex max-w-md flex-wrap gap-1">
          {token.scopes.map((scope) => (
            <li key={scope}>
              <code className="text-xs">{scope}</code>
            </li>
          ))}
        </ul>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
        <When at={token.createdAt} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
        <When at={token.expiresAt} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
        {token.lastUsedAt === null ? (
          <span className="text-ink-muted">never</span>
        ) : (
          <When at={token.lastUsedAt} now={now} />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {live ? (
          <RevokeTokenButton id={token.id} name={token.name} />
        ) : (
          <Badge variant="outline">{STATE_LABEL[state]}</Badge>
        )}
      </td>
    </tr>
  );
}
