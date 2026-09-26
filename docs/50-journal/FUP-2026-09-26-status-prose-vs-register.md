# FUP · 2026-09-26 · The dashboard's prose and its own register had stopped agreeing

**Agent:** Claude · **Duration:** one session · **PR** [#93](https://github.com/vchatela-org/prisme/pull/93) · **Outcome:** complete

Asked a one-line question — *what decisions remain to be taken* — the answer had to be read off
[`STATUS.md`](../../STATUS.md) and [`OPEN.md`](../20-decisions/OPEN.md). Five of the dashboard's
workstream paragraphs turned out to assert, in the present tense, states that four merged pull
requests had closed. Reading the same page carefully turned up a second, unrelated defect: a
**private repository's name** linked from its §7 row.

Both are corrected. The second one is a live leak of a name into this public repository's history, and
it is the more important half of this entry.

---

## 1 · Five paragraphs narrated a state their own register contradicted

Every workstream's paragraph ends with a *what is not done* sentence. The follow-up wave closed five
of those gaps and added a row to the follow-up table **further down the same page** — and never went
back to the prose above it:

| Paragraph | The sentence | Closed by | Landed |
|---|---|---|---|
| W07 | "what is **left** on the gallery is twelve violations from Radix's own markup" | [#41](https://github.com/vchatela-org/prisme/pull/41) | 2026-09-21 |
| W11 | "what is **not** fixed: `fixtures/` still carries no task mirror" | [#36](https://github.com/vchatela-org/prisme/pull/36), [#80](https://github.com/vchatela-org/prisme/pull/80) | 2026-09-21, then 09-24 |
| W12 | "`createDocToolClient` **still has no caller** and the scan runs on the task tool alone" | [#39](https://github.com/vchatela-org/prisme/pull/39) | 2026-09-21 |
| W13 | "`capacity_week` **has no reader yet** … the document tool is **still not read**" | [#38](https://github.com/vchatela-org/prisme/pull/38), [#39](https://github.com/vchatela-org/prisme/pull/39) | 2026-09-21 |
| W15 | "**ADR-0011's *Create page* cannot be implemented** … ADR-0025 … is **Proposed, not Accepted**" | [#40](https://github.com/vchatela-org/prisme/pull/40), [#69](https://github.com/vchatela-org/prisme/pull/69) | 2026-09-21, then 09-24 |

**W15's is the worst of the five, and it is a different kind of wrong.** The other four describe a gap
that closed. This one described an **Accepted ADR as Proposed**, five days after acceptance, in the
file a reader checks first — which is not a stale note but an invitation to re-open a decision that
has been made. Anyone planning work from that sentence would have treated `ADR-0025` as negotiable.

### Why nothing saw it

- **No check reads prose.** `STATUS.md` is hand-maintained, and of its two halves only one is a
  table: the register's rows are checkable against their PR column, which is why a 🟡 row with `—`
  beside a journal entry naming a PR is a readable tell. A narrative paragraph has no column and
  nothing to compare it to.
- **The tell is a contradiction three screens apart.** Every closure had updated the register
  correctly; the record was right everywhere a check could look, and wrong only in the half nothing
  reads. Seeing it needed the whole page read at once, which is not something a run does.
- **This is the fourth time.** A duplicated section (#41), a count that drifted for five days, a row
  reverted by a bad conflict resolution (#77), and now five paragraphs — every one of them in these
  two files, every one with all gates green.

### Verified against the code, not the register

The register rows were themselves the claim under test, so each closure was re-checked in the source:
`apps/sync/src/main.ts` constructs a document-tool client at **four** sites; `measure.ts` carries
`ObservedSource = 'capacity_week' | 'task_mirror'` and prefers the week; `fixtures/task-mirror.json`
exists; `patches/` holds five patches with four render cases behind them.

### What was corrected, and what was deliberately not

The five paragraphs are corrected **in place** — what was not done, in the past tense, and which pull
request closed it — keeping the shape the file already uses elsewhere. Nothing is deleted, so a reader
can still see what the workstream recorded at its landing.

**The journal entries are left alone, and that is the decision.** `W12`/`W13`/`W15`'s entries say
*Proposed* and are dated 2026-09-20; they were accurate when written. The journal is append-only and
this file is a dashboard of the present, and the two are allowed to disagree: rewriting a dated record
to match today is how a journal stops being evidence of what was decided then. The correction belongs
on the dashboard, and this entry is where the discrepancy is explained.

---

## 2 · A private repository's name was linked from the public page

Running `./scripts/privacy-scan.sh` before the first commit failed: `STATUS.md`'s §7 row linked its
deployment-repository pull request by **full URL**, and the local deny-list carries the repository's
name. It is a **private** repository. It was introduced by #92, merged into `main` on 2026-09-26.

**The CI gate could not have caught this, by construction.** `privacy deny-list` runs the committed
deny-list; the local supplement is **gitignored** on purpose, because it holds the personal patterns
that must not themselves be published. The consequence is exactly the one that obtained: the only
scanner able to see this class is the one that runs on a person's machine before they push — and it
did, one commit before the leak could have been repeated.

Redacted to the form every other row in this file already uses — the prose *"deployment-repository PR
#1273"* — which names a number and nothing else. It is its own commit, so that a future search for the
name in history lands on the remediation rather than on a commit about documentation.

**Reach, as far as this session can establish it:** one occurrence, in one file, on `main`, pushed to
a public repository on 2026-09-26. Whether it has been indexed or forked is not something that can be
determined from here. Per [`17-privacy.md`](../17-privacy.md) §3 the options for the history are a
`git filter-repo` rewrite with a force-push, or — this repository being neither young nor quiet — an
approach to GitHub support if it is believed to be indexed. **Both are the owner's decision and
neither was taken here**; the class of mistake is recorded and the content deliberately is not.

**What this changes about the local scan's standing.** It was already the only scanner that can see
instance-shaped values; now it is also the only one that can see *a private name*, and the same
gitignored file is what makes it so. The corollary is worth stating once: the CI `privacy deny-list`
check passing is not evidence that nothing private is in a diff. It never was.

---

## Cost the most time

**`git checkout -- <file>` restores from the index, not from `HEAD`.** Splitting one file's changes
into two commits, the first attempt staged everything, then "baselined" a file that had just been
`git add`ed — and the restore brought back the *staged* content, so the second commit contained
everything and the first commit's message described a change it did not contain. The fix is
`git reset --hard` (safe here, because the finished content was copied outside the repository first),
and the lesson is that `checkout --` is a discard of the working tree *toward the index*, which is only
the same thing as "toward HEAD" when nothing is staged.

## What I did not do

- **No history rewrite.** The leak is still in `main`'s history; that remediation is a force-push and
  the owner's call.
- **No systematic checker for prose-versus-register drift.** The class with a tell was fixed; the
  class without one was not, and inventing a checker to have one would be the wrong fix.
- **No audit of the rest of the prose.** The search was for the *shape* that had a contradiction — a
  "what is not done" sentence — and not a reading of all ~550 lines for every claim. A claim with no
  register row would not have been caught.
- **The four `⏸ deliberate` rows were re-read and are genuinely open**, not stale.

## Follow-ups

- A register row records the class: **a follow-up that closes a recorded gap also owes the paragraph
  above it**, because the wave updated the table and left the prose standing for five days.
- The history of `main` still carries the private name ([#92](https://github.com/vchatela-org/prisme/pull/92)) — owner's decision, per `17-privacy.md` §3.

## Specs touched

None. Every corrected claim was already recorded correctly in `STATUS.md`'s follow-up table and in the
cited entries; this brings the prose into agreement with the register rather than changing what either
says.
