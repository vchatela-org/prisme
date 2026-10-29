# ADR-0036 · Make the work-in-progress limits soft, and choose them on Settings

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29 — closes OQ-2

## Context

OQ-2 asked for the work-in-progress caps: how many initiatives may be in `now` overall and per area.
It named a candidate, one per area and five overall, and asked for it to be implemented as
configuration and calibrated at the first real review. The candidate shipped as a constant in
`@prisme/domain` (`CANDIDATE_SELECTION_LIMITS`). Changing it meant a release, and Settings showed it
as deployment configuration.

When the owner reviewed it, they said a strict cap does not fit how the work goes. Some work is
**blocked by someone else**, and while it waits, new work has to start. A cap that counts the blocked
item pushes a person to break the rule or to leave the blocked item's status wrong. The owner also
said that **objectives run all year** and must never take a slot.

What already held before this record:

- Selection only ever counts **`now`**. `waiting` holds no slot. Objectives and key results are
  never slot holders: selection reads initiatives only.
- The caps never refused anything. `POST /initiatives/{id}/status` enforces no limit. The Focus,
  Backlog and status-menu guardrails warn and leave the action available. Selection stops
  *proposing* work at a cap, and work already in flight keeps its slot.

## Decision

1. **The limits are soft, by decision rather than by accident.** A cap stops selection from
   proposing more work (`wip_full`, `area_at_cap`). A move to `now` past a cap is warned about and
   never refused, by the API, the screens or an MCP tool.
2. **They are prisme's own setting, chosen on Settings → Work in progress.** They are stored in
   `selection_setting` (migration 0023), a singleton like `audit_setting`. `GET /settings/wip-limits`
   and `PUT /settings/wip-limits` require `admin:settings`. A change applies to the next request with
   no deploy. Lowering a cap moves nothing already in flight: Focus says it is over capacity, and
   demotion stays a review decision ([`12-scoring.md`](../12-scoring.md) §5.1).
3. **The defaults are two per area and seven overall** (`DEFAULT_SELECTION_LIMITS`). They apply
   while nothing has been chosen. The candidate's one per area made an area with one blocked item
   look full.
4. **The bounds:** overall 1–30, per area 1–10, and per area no larger than overall
   (`selectionLimitsProblem`). The database CHECKs repeat the bounds. A cap of zero is refused,
   because it would mean *start nothing*, which is a freeze, not a limit.
5. **Work blocked by someone else belongs in `waiting`, and `waiting` gives its slot back.** The
   status menu, Focus and the guardrails say so at the moment a cap is reached. That moment is when
   the alternative to breaking the cap has to be visible.
6. **Only initiatives take a slot.** Objectives and key results are never counted, at any point of
   their period. An initiative that is really an objective's task is a model error. It is fixed
   where it starts, by making the task the objective's, and not by an exception in selection.

The worked example in [`12-scoring.md`](../12-scoring.md) §6 keeps one per area and five overall. Those
numbers belong to the example, and the test pins them as the example's.

## Consequences

- **`/settings` no longer reports `selection`.** It held deployment configuration, and these limits
  are not deployment configuration anymore. The pair has its own route. A web tier older than its
  API fails to parse `/settings` during a roll, as with any version skew between the two.
- **The schedule engine's concurrency (`CANDIDATE_CONCURRENT_INITIATIVES`, 5) is unchanged.** It is
  a planning assumption about throughput. Raising the cap because something is blocked elsewhere
  does not make anybody faster, so the two values are no longer described as the same question.
- **The cost:** a soft cap can be ignored every week, and nothing stops that. The guardrails and the
  over-capacity line are the only pressure. That is deliberate. A hard block gets worked around by
  leaving a status wrong, and the model then stops describing reality.

## Alternatives

- **A hard cap, refused by the API.** Rejected: the owner's case is the normal one. Blocked work
  would be moved somewhere false, such as `next` or `dropped`, to make room. A refusal on a personal
  calibration is the model lying to protect a number.
- **No cap at all.** Rejected: without a cap, nothing stops Focus from suggesting every free
  candidate, and allocation (ADR-0005) depends on an area not holding every slot.
- **Keep the candidate one-per-area and five overall.** Rejected by the owner's own case: one blocked
  item would fill its area.
- **Deployment configuration (an environment variable).** Rejected: a calibration taken at a review
  should not need a release, and Settings already edits instance-level choices such as the audit
  retention.
- **Count `waiting` work against the cap with a separate allowance.** Rejected: a second number that
  answers the same question. `waiting` already means *not being worked on now*.
