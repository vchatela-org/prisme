# FUP · 2026-09-24 · The skill's own scheduling advice was the bug

**Agent:** Claude · **Duration:** one session · **PR:** this branch · **Outcome:** complete

The owner asked why the scheduled Dependabot runs existed somewhere and yet kept doing nothing. The
answer was in this skill: its *Scheduling* section told the reader to build the schedule out of
`CronCreate` with `recurring: true`, and a recurring session job is **deleted after seven days**. The
schedule had been evaporating on its own — and the document that recommended it is the same document
every later run reads.

Four session jobs were installed. Three days of the week were uncovered, one day carried two firings,
and the earliest of them sat inside the inference provider's weekday peak-pricing window for the whole
daylight-saving half of the year.

## What was done

- **The *Scheduling* section rewritten** around four requirements instead of one mechanism: off the
  hour, off-peak, on a durable scheduler, and out of a human's working checkout.
- **The off-peak window is written as arithmetic, not as an hour.** Weekdays 12:00–18:00 UTC is what
  to stay out of; the section now says to convert the intended wall-clock time to UTC for *both*
  daylight-saving states, because the same local hour is peak in summer and off-peak in winter — which
  is exactly how the installed schedule came to be wrong for half of every year.
- **`CronCreate` is described as what it is** — reasonable for trying a cadence, wrong for keeping
  one, because the expiry is silent. A user crontab or a systemd timer is named as the durable
  equivalent, with the reason a scheduled run has to log: nobody is watching it.
- **Two operational lessons the section had never carried**, both learned the expensive way: run from
  a dedicated worktree pinned to the default branch rather than in a person's mid-branch checkout, and
  hold a lock so two runs cannot collide on the one `pnpm-lock.yaml` that every npm branch shares and
  the per-pull-request worktrees named by number.

## Decisions taken

**The skill keeps saying a weekly run is enough.** It does: Dependabot opens its pull requests weekly
and the skill is idempotent, so the cadence was never what was broken — the *mechanism* was. The
cadence the owner chose is recorded as the operator's call, with the one thing a more frequent run
buys named honestly: noticing that a **pending** version's merge has landed, which *Decide the
release* already says nothing re-runs to do. The two claims are consistent — weekly is enough for the
integration, and the pending-version obligation is what a faster cadence is for — so the sentence was
left standing rather than rewritten.

**No inference provider is named.** The off-peak constraint is real and belongs in the skill; whose
account pays for the session does not, and this repository is public.

## Surprises

**The gap was documented as guidance.** Every other follow-up in this wave was a product defect found
by using the thing. This one was found by reading the instructions: the skill prescribed the exact
failure that had been observed, so a later run would have read the section and rebuilt the same
expiring schedule. A wrong document that gets followed is worse than a missing one.

**A dead credential in a *different* account fails the check.** `gh auth status` — the skill's own
first preflight command — exits non-zero when *any* account in the hosts file holds an invalid token,
including one that is not the active account and whose token nothing else uses. An unattended run
reading that has to reason past a failure that is not about it. Removed.

## Follow-ups

- **The off-peak window is now written down in exactly one place, and it is not enforced.** Nothing
  checks that a schedule is off-peak, off the hour or durable; the section is advice a human follows,
  and the failure it just fixed was silent — which is the argument for a check rather than more prose.
- **A second scheduled job would have to re-derive the window** from the pricing page rather than read
  it from a shared place. An owner-level note outside the repository holds it meanwhile; promoting it
  into the repository would mean committing the operator's pricing context, which the privacy rules
  refuse.

## Specs touched

- `.claude/skills/dependabot/SKILL.md` — *Scheduling*, rewritten. No other section changed: the loop,
  the endings and the report format were accurate, and the stale reference to this skill living on an
  unmerged branch is gone from the schedule itself, which is where it was.
