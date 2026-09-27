# FUP · 2026-09-27 · An open review can be discarded

**Asked:** the owner wanted a way out of a review they had started and did not mean to finish. There
was none. An open session stayed open until it was closed, and closing it would have recorded a
review that never happened. "Save for later" was explicitly not asked for.

## What was there

- `review_session` had an open state (`completed_at` null) and a closed one. The API could open,
  patch and close a session and could delete nothing. **No route in the API deleted anything**, so
  this is the first `delete` route. `HttpMethod` already allowed it.
- The web client's `ApiCall.method` did not list `DELETE`. The origin check was already keyed on
  "anything but `GET`", so no security change was needed.
- Nothing references `review_session`: no foreign key and no event row. Opening a review writes
  nothing to `event_log`.

## What was done

- **`DELETE /reviews/:id`** (`discardReview`, scope `write:review`). It deletes an **open** session
  and answers with what was deleted. A closed one answers `409`, and a missing one `404`. The
  condition is in the statement (`… where id = $1 and completed_at is null`), so a close racing a
  discard cannot delete a closed session. The store tells the two refusals apart afterwards.
- **A *Discard* button**, in two places: the open review's status card, and beside *Resume* in the
  hub's *In progress* list. It confirms first, and the dialog counts what goes, e.g. "Its 3 ticked
  steps and 2 recorded decisions will be deleted". An empty session reads "Nothing has been
  recorded in it yet". After a discard the page refreshes in place, and the wizard offers a new
  session.
- **The action treats a `404` as done.** The session is gone, which is what the click asked for,
  and a second click on a slow button is the usual way to get a `404`. A `409` says the review is
  already closed.
- **Tests:** four integration cases against PostgreSQL. A discard deletes the ticks and decisions
  and answers with them, then `GET` and a second `DELETE` are both `404`. A closed session is
  refused with `409` and left byte-identical. A discard touches only the session it names. A
  `read:reviews` token gets `403`. Plus unit tests for the dialog's sentence, and `DELETE` added to
  the origin-check test's write verbs.
- **Checked by running it.** On the harness with the fixture seed: opened a weekly review, recorded
  a decision, discarded it from the wizard, then opened another and discarded it from the hub.
  Both times the page fell back to "No weekly review is open" with a start button.

## Decisions taken

- **A hard delete, not a `discarded_at` flag.** A discarded session was never a review. Keeping it
  would mean every reader of `review_session` (history, the hub, the artefact) learning to skip it.
  It is prisme-only data with no external counterpart (`docs/11-ownership.md` §9), so nothing
  outside prisme notices it leave.
- **Closed sessions are refused, not merely hidden.** A closed session carries the capacity
  snapshot and the decisions it was closed on. Deleting it would rewrite what a review decided,
  which is exactly what the never-retaken snapshot exists to prevent.
- **No event row.** `event_log.kind` is a closed vocabulary and would need a migration. A draft
  that is thrown away is not a change to anything the log tracks: no score, status, weight or
  outward write.

## Surprises

- **A CSP violation that predates this change.** Opening any Radix dialog on a page long enough to
  scroll logs `Applying inline style violates … style-src` in the console. The discard dialog did it
  on the review wizard, and so did the existing command palette (Ctrl+K) on the same page. The same
  dialog on the shorter hub page did not. The likely cause is the scroll lock's scrollbar
  compensation. It is not fixed here: it is a design-system change (`packages/ui`) and is recorded
  below.

## Follow-ups

- **The scroll-lock CSP violation** (above): every modal on a scrolling page. W07's twelve
  violations (#41) were fixed at the markup; this one comes from the scroll lock at run time.
- **Not done, deliberately:**
  - an MCP tool for discarding. An agent that runs a review can open and close one. Letting it
    delete a human's half-done session is a decision of its own;
  - "save for later": an open session already is one.

## Specs touched

`docs/18-user-guide.md` §4.
