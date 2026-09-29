# FUP · 2026-09-29 · A ritual can be quarterly or yearly

**Asked:** the owner is bringing the processes store into Rituals. Half of its rows recur once a
quarter or once a year, and a ritual could only be daily, weekly or monthly, so they had no way in.
Offered a choice between ignoring them, approximating them as monthly, or growing the vocabulary,
the owner chose to grow it.

## What was done

- **Migration 0019** widens `ritual.cadence` to five values. Nothing else changes; the reversal is
  written in the file and needs any quarterly or yearly ritual removed first.
- **The vocabulary** (`RITUAL_CADENCES`, the API DTO, the store types, the web form and its
  contracts) gains `quarterly` and `yearly`.
- **Adherence periods.** The backfill buckets a quarterly ritual by calendar quarter and a yearly
  one by calendar year, one opportunity each, next to the existing monthly rule. The two new starts
  live in `weeks.ts` with the others, so the bucketing stays in one place.
- **Tests:** three backfill units (quarter and year periods, a year end, excess capped) and an API
  integration test that creates, lists and changes a quarterly and a yearly ritual against
  PostgreSQL, and still refuses an unknown cadence.
- **Specs:** `10-model.md` (Ritual) and the user guide (§2.5) name the five cadences and say what a
  period is.

## Decisions taken

- **No ADR.** No accepted ADR fixes the ritual cadences; this widens a vocabulary and contradicts
  none. Review sessions already have these two cadences.
- **On-demand processes are not rituals.** They have no rhythm to adhere to, so they are ignored in
  the queue rather than given an invented cadence.
- **Calendar quarters, not rolling ninety days.** It matches how a monthly period is a calendar month
  and how a review's quarter is read.

## Follow-ups

- Adopting a processes row as a ritual is still refused; the owner links after creating the ritual.
- The KPI chart draws a quarterly ritual's single point in whichever week or month bucket its
  period starts in. It is correct, and sparse; a wider bucket is a separate decision.

## Privacy

Fixture names and invented values only.
