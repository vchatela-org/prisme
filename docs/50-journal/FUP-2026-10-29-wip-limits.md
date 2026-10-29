# FUP · 2026-10-29 · OQ-2: the work-in-progress caps are soft, and chosen on Settings

**Agent:** Claude · **Duration:** one run · **PR:** — · **Outcome:** OQ-2 is closed by
[ADR-0036](../20-decisions/0036-work-in-progress-limits-are-soft-and-chosen-on-settings.md). The caps
are an instance setting, two per area and seven overall by default, and every cap warning offers
`waiting` as the way to free a slot.

## What was found first

- The caps were `CANDIDATE_SELECTION_LIMITS` in `@prisme/domain` (one per area, five overall),
  passed into the API's services at boot and shown on Settings as deployment configuration.
- **They were already soft.** No route enforces them. The guardrails warn and leave the action
  available. Selection only stops proposing work at a cap.
- **`waiting` already held no slot.** Selection counts `now` only. Nothing on a screen said so at the
  moment a cap was reached, which is when it matters.
- **Objectives never took a slot.** Selection reads initiatives only. On the live instance, the
  owner's objectives looked like slot holders because the label had brought them in as
  *initiatives* with the objectives' own titles. That model error has its own unit.

## What was done

- **Domain.** `DEFAULT_SELECTION_LIMITS` (7, 2), `SELECTION_LIMIT_BOUNDS` (overall 1–30, per area
  1–10) and `selectionLimitsProblem`, which also refuses a per-area cap larger than the overall one.
  The worked example's test pins its own one-and-five as the example's limits.
- **Storage.** Migration 0023, `selection_setting`, a singleton like `audit_setting`. CHECKs repeat
  the bounds and the pair rule. The reversal procedure is in its header.
- **API.** `GET`/`PUT /settings/wip-limits` (`admin:settings`). `buildRanking` reads the chosen pair
  on every call and falls back to the defaults, so Focus, the Backlog, the timeline and MCP all
  select with the owner's numbers from the next request. `/settings` drops `selection`. The MCP
  `propose_now_set` warnings and description name the setting instead of an open question.
- **Web.** *Settings → Work in progress*: both caps, the default note and a form bounded like the
  API. The *area at cap* and *every slot taken* sentences on Focus and in the guardrail dialog say
  that moving blocked work to *waiting* frees a slot, and that a cap is a warning.
- **Docs.** `12-scoring.md` §5, `19-how-it-works.md` §5, `18-user-guide.md` §3, `10-model.md`'s open
  question table, `OPEN.md` (four open), the ADR index and `STATUS.md`.

## Decisions taken

- **Defaults of two and seven, not the candidate's one and five.** With one per area, a single
  blocked item made its area look full. The owner chose the soft, editable option with these
  defaults.
- **No zero.** A cap of zero means *start nothing*, which is a freeze, so the floor is one.
- **The schedule engine's concurrency stays at five.** It is a throughput assumption, and raising a
  cap because work is blocked does not make anybody faster.

## Checks run locally

Node 24.21.0, where the repository pins 26, so CI is what validates the runtime: domain selection
tests, the worked example, the route contract test, and the settings integration suite against
PostgreSQL. The new suite covers the defaults, a chosen pair reaching `/focus`, the pair rule (422),
four boundary refusals (400) and the scope (403). Root typecheck, eslint per package and the privacy
scan with the local supplement are listed in the pull request.

## Not done

- No event is written when the caps change. `updated_at` is the only trace, as for the audit
  window.
- Nothing new keeps objectives out of slots, because none was ever counted. The initiatives that
  carry an objective's title are handled by the unit that makes such a task the objective's own.
