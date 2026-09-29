# FUP · 2026-09-29 · API tokens are minted from the UI

**Asked:** the owner wanted a token holding `write:ritual` and found no way to make one short of a
hand-written call to `POST /tokens` carrying their own session. They proposed a screen to mint, list
and revoke tokens, and asked that it not lock them out of anything.

## What was found

- **The spec already asked for it.** `14-threat-model.md` §3, ADR-0015 and the W14 brief all say
  tokens are "minted from the UI". W14 (#23) shipped the API half; nothing in `apps/web` ever called
  `/tokens`. So this closes a gap in delivered spec; it decides nothing new.
- **"Only a verified human ever holds `admin:tokens`" was a comment, not a rule.** `POST /tokens`
  accepted `admin:tokens` in `scopes`, so a human could mint a machine token that mints further
  tokens with any scope — which makes the scopes on every token decorative.

## What was done

- **The API refuses to give a token `admin:tokens`.** `HUMAN_ONLY_SCOPES` in `http/scopes.ts`; the
  mint's schema offers only `TOKEN_SCOPE_NAMES`, and `TokenService.issue` refuses it again, as it
  already did for an unknown scope, so the rule holds for any caller of the service.
- **`GET /tokens/scopes`** (behind `admin:tokens`) lists every scope with its description and whether
  a token may hold it. The screen renders that list, so the vocabulary is not restated in the web
  tier and a scope added later is offered without a web change.
- **Settings → API tokens** (`/settings/tokens`): mint (name, scopes grouped read / write /
  administer, a lifetime up to the API's year), the plaintext shown once with *Copy*, the list with
  live tokens first and revoked or expired ones kept below with *Last used*, *Revoke* per row
  behind a confirmation, and *Revoke all* behind a typed one. Settings links to it with a live count;
  the palette has *Go to API tokens*.
- **Specs:** `14-threat-model.md` token rules name the refusal; the user guide gains §6 *Scripts and
  agents — API tokens*.

## Not locking the owner out

The owner's session carries `OWNER_SCOPES`, which is the whole vocabulary, so it still holds
`admin:tokens`. Only the set a token may be *given* shrank. Integration tests pin this down: the
signed-in owner lists scopes, mints and revokes; revoking still works with the write freeze in
`all` mode (the freeze withholds `write:*` only); and a token holding every grantable scope, the
administrative ones included, gets `403` on every token route.

Verified by driving the harness in a browser as the owner. A `write:ritual` token minted on the
screen created a ritual with `201` and got `403` on `/areas` and on `/tokens`. Once revoked from
the screen it got `401` on its next request. *Revoke all* stayed disabled until the words were
typed. The plaintext appeared in none of the three process logs.

## Decisions taken

- **No ADR.** It implements ADR-0015 as written and enforces a rule `auth/routes.ts` already
  claimed. It contradicts no accepted ADR.
- **Only `admin:tokens` is human-only.** It is the one scope that widens what a later caller may do.
  `admin:settings` and `admin:areas` stay grantable; a narrower policy for them is a separate
  decision.
- **Refused at mint, not at use.** A token minted with `admin:tokens` before this change keeps
  working until it is revoked or expires. The screen lists it, so it can be seen and revoked there.
  Refusing it at verification could have cut off something in use without warning.
- **No delete.** A revoked token stays listed; the list is the record of what was ever let in.

## Follow-ups

- The scope descriptions are the API's own text and one of them carries markdown backticks, which
  the screen shows literally.
- The harness's `up.sh` skips the web build when `apps/web/.next` exists. A typecheck leaves one
  behind with no production build in it, so the web tier fails to start there. It was built by hand
  for this run.

## Privacy

Fixture area keys and invented token names only. The token in the run was a harness token on a
throwaway local stack, and it was revoked.
