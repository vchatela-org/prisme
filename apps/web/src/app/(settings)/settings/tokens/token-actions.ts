'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import { mintedTokenSchema, revocationSchema } from '@/lib/contracts';

/**
 * Every write the API tokens screen makes.
 *
 * Minting is the only call in this application whose answer is a credential.
 * The plaintext goes from the API's response straight into the return value
 * and nowhere else: not a log line, not a cookie, not a URL, not a cache. It is
 * the caller's to show once — `apiFetch` logs a path and a status on failure
 * and nothing of a successful body, which is what makes that true.
 *
 * A server action is a public endpoint: each re-parses its arguments and names
 * every field it sends (`apps/api/CLAUDE.md` non-negotiable 2). The rules on
 * scopes and lifetimes are the API's and are enforced there; these schemas only
 * keep a malformed value from making the trip.
 */

export type TokenResult =
  | { readonly ok: true; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

export type MintResult =
  | { readonly ok: true; readonly token: string; readonly name: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

function refused(failure: ApiFailure, what: string, invalid: string): TokenResult & { ok: false } {
  if (failure.status === 400) return { ok: false, title: 'Not done', description: invalid };
  const copy = failureCopy(failure, what);
  return { ok: false, title: copy.title, description: copy.description };
}

function listChanged(): void {
  revalidatePath('/settings/tokens');
  revalidatePath('/settings');
}

const mintSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.string().regex(/^[a-z]+:[a-z_-]+$/))
    .min(1)
    .max(64),
  expiresInSeconds: z.number().int().min(60),
});

export async function mintToken(input: z.input<typeof mintSchema>): Promise<MintResult> {
  const parsed = mintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'Not minted',
      description: 'A token needs a name and at least one scope.',
    };
  }

  const result = await apiFetch({
    path: '/tokens',
    method: 'POST',
    body: {
      name: parsed.data.name,
      scopes: [...new Set(parsed.data.scopes)],
      expiresInSeconds: parsed.data.expiresInSeconds,
    },
    schema: mintedTokenSchema,
  });
  if (!result.ok) {
    return refused(
      result,
      'API tokens',
      'The API refused one of the scopes or the lifetime. Reload the page for the current list and try again.',
    );
  }

  listChanged();
  return { ok: true, token: result.data.token, name: result.data.apiToken.name };
}

const idSchema = z.object({ id: z.string().length(16) });

export async function revokeToken(input: z.input<typeof idSchema>): Promise<TokenResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, title: 'Not revoked', description: 'That is not a token of this list.' };
  }

  const result = await apiFetch({
    path: `/tokens/${encodeURIComponent(parsed.data.id)}`,
    method: 'DELETE',
    schema: revocationSchema,
  });
  if (!result.ok) return refused(result, 'API tokens', 'That is not a token of this list.');

  listChanged();
  return result.data.revoked === 0
    ? { ok: true, title: 'Already revoked', description: 'It could not be used anyway.' }
    : {
        ok: true,
        title: 'Revoked',
        description: 'It stops working now — on its very next request.',
      };
}

export async function revokeAllTokens(): Promise<TokenResult> {
  const result = await apiFetch({
    path: '/tokens/revocations',
    method: 'POST',
    schema: revocationSchema,
  });
  if (!result.ok) return refused(result, 'API tokens', 'The revocation could not run.');

  listChanged();
  const count = result.data.revoked;
  return {
    ok: true,
    title: count === 0 ? 'Nothing to revoke' : `${String(count)} revoked`,
    description:
      count === 0
        ? 'No token was live.'
        : 'Every script and agent is signed out. Your own session is not affected.',
  };
}
