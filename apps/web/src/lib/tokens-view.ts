import type { ApiToken, TokenScope } from './contracts';

/**
 * What the API tokens screen says, and how it groups what the API returns —
 * pure, so it is tested rather than eyeballed.
 *
 * Nothing here decides who may do what. The vocabulary, its descriptions and
 * which scopes a token may hold all come from `GET /tokens/scopes`, and the API
 * refuses a mint that breaks its rules whatever this screen offered.
 */

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

const DAY_SECONDS = 24 * 60 * 60;

export interface ExpiryChoice {
  readonly id: string;
  readonly label: string;
  readonly seconds: number;
}

/**
 * The lifetimes offered. A year is the API's ceiling, and there is no "never":
 * the API cannot express one, and a screen offering it would only be refused.
 */
export const EXPIRY_CHOICES: readonly ExpiryChoice[] = [
  { id: '1d', label: '1 day', seconds: DAY_SECONDS },
  { id: '7d', label: '7 days', seconds: 7 * DAY_SECONDS },
  { id: '30d', label: '30 days', seconds: 30 * DAY_SECONDS },
  { id: '90d', label: '90 days', seconds: 90 * DAY_SECONDS },
  { id: '365d', label: '1 year', seconds: 365 * DAY_SECONDS },
];

/** The API's own default, so choosing nothing here means what it means there. */
export const DEFAULT_EXPIRY_ID = '90d';

export function expirySeconds(id: string): number | undefined {
  return EXPIRY_CHOICES.find((choice) => choice.id === id)?.seconds;
}

// ---------------------------------------------------------------------------
// Scopes, grouped
// ---------------------------------------------------------------------------

export type ScopeKind = 'read' | 'write' | 'admin' | 'other';

export interface ScopeGroup {
  readonly kind: ScopeKind;
  readonly label: string;
  readonly hint: string;
  readonly items: readonly TokenScope[];
}

const GROUP_COPY: Readonly<Record<ScopeKind, { label: string; hint: string }>> = {
  read: { label: 'Read', hint: 'See, never change.' },
  write: { label: 'Write', hint: 'Change prisme’s own data. The write freeze can withhold these.' },
  admin: { label: 'Administer', hint: 'Change how this instance is set up.' },
  other: { label: 'Other', hint: 'Scopes this screen does not know how to group yet.' },
};

function kindOf(name: string): ScopeKind {
  const prefix = name.split(':', 1)[0];
  return prefix === 'read' || prefix === 'write' || prefix === 'admin' ? prefix : 'other';
}

/**
 * The API's scopes in read, write and administer groups, in the API's order
 * within each. A group with nothing in it is left out rather than shown empty;
 * a scope with an unfamiliar prefix is shown under *Other* rather than dropped.
 */
export function groupScopes(scopes: readonly TokenScope[]): readonly ScopeGroup[] {
  const order: readonly ScopeKind[] = ['read', 'write', 'admin', 'other'];
  return order
    .map((kind) => ({
      kind,
      ...GROUP_COPY[kind],
      items: scopes.filter((scope) => kindOf(scope.name) === kind),
    }))
    .filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------------------
// A token, in words
// ---------------------------------------------------------------------------

export type TokenState = 'active' | 'revoked' | 'expired';

/** `active` is the API's own verdict; the other two only say why it is not. */
export function tokenState(token: Pick<ApiToken, 'active' | 'revokedAt'>): TokenState {
  if (token.active) return 'active';
  return token.revokedAt === null ? 'expired' : 'revoked';
}

/** Live tokens first, each part in the API's order (newest first). */
export function orderTokens(tokens: readonly ApiToken[]): readonly ApiToken[] {
  return [...tokens.filter((token) => token.active), ...tokens.filter((token) => !token.active)];
}

/** Why the mint button is off, in words — or `null` when it is on. */
export function mintProblem(name: string, scopes: ReadonlySet<string>): string | null {
  if (name.trim() === '') return 'Name it after what will use it.';
  if (name.trim().length > 100) return 'A name is at most 100 characters.';
  if (scopes.size === 0) return 'Choose at least one scope.';
  return null;
}
