# FUP · 2026-10-28 · S8: Settings says what the deployment switches off, and a refused pass says so

**Agent:** Claude · **Duration:** one run · **PR:** [#193](https://github.com/vchatela-org/prisme/pull/193) · **Outcome:** *Settings → Features*
names each optional feature as on or off and how to turn it on; every apply pass records why it was
refused, and a refusal for creations is shown on Focus and Settings. S8 is closed.

## What was found first

- The reconciler's refusal was a string in the CronJob pod's log and in the response of a forced
  pass. `sync_run_state` (0009) already held the pass's outcome for `/metrics`, but only *whether*
  it succeeded, not why it did not. So the case the finding describes — the threshold at 0 and one
  new initiative in `next` — stopped every write with nothing on any screen.
- `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` and `DOCTOOL_DURATION_PROPERTY` are parsed by every process from
  the shared schema; the API already reads the first (its adoption scan types takeaways), the sync
  reads both. `DOCTOOL_PAGE_URL_TEMPLATE` is the web tier's.

## What was done

- **Migration 0022** adds `sync_run_state.last_refusal` (`create_threshold` | `write_freeze`) and
  `last_refusal_creates`, overwritten by every apply pass (`NULL` when not refused).
- **The sync.** `apply` returns the refusal as a kind and a count beside its sentence; the pass
  records it with its outcome (`PassRefusal`).
- **The API.** `GET /sync` gains `lastRefusal { kind, creates, at }` (the time is the pass's,
  `last_drift_at`), and so does the MCP `sync_status` tool, which returns the same shape (the tool
  manifest is regenerated). `GET /settings` gains `features { readingPipeline, declaredDurations }`, from
  the API's own configuration, as booleans.
- **The web.** `featureRows` and `refusalBanner` (`lib/features-view.ts`, + tests). Settings has a
  *Features* section — sync, writes, creation, reading pipeline, declared durations, page links —
  and the banner; Focus shows the banner with a link to it.

## Decisions taken

- **Recorded by the pass, read by the API.** The pass is the only thing that knows why it refused,
  and its pod is gone seconds later; the row it already writes is where the reason can outlive it.
  Overwritten every pass, so the banner clears itself on the next pass that is not refused.
- **Only a creation refusal gets a banner.** A write-freeze refusal is every pass's state until the
  freeze is lifted, and Settings already says *Frozen*; a banner for it would be permanent noise.
- **Booleans, not values.** A property name is instance data, and whether it is set is all the
  panel needs to say.
- **The API reports its own environment.** A variable set on the sync and not on the API would read
  as off. `docs/15-runtime.md` now says to set `DOCTOOL_DURATION_PROPERTY` on both; the takeaway
  property was already documented as *Sync and API*.

## Checks run locally

Node 24.21.0: root `pnpm typecheck`; the whole `unit` project, including `features-view.test.ts` and
the refusal kinds in `apply.test.ts`; the API's `integration.test.ts` and
`metrics.integration.test.ts` (refusal recorded and cleared; `lastRefusal` and `features` read
back); eslint and prettier on the changed files; the privacy scan with the local supplement;
migration 0022 rehearsed on a throwaway database.

## Not done

- No banner in the app frame on every screen: Focus is where the day starts, and Settings is where
  it is fixed.

## Specs touched

- `docs/15-runtime.md` §(variables), `docs/16-sync.md` (plan/apply), `docs/18-user-guide.md` §2.3 and
  the write section, `docs/19-how-it-works.md` S8.
