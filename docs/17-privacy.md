# 17 · Privacy

**This repository is public. It documents a product; it never documents its owner.**

The application is open. The content it manages — goals, projects, tasks, weights, workspace
identifiers — is not, and never enters git. This document is the rule set and its enforcement.

Read this before your first commit. Public git history is permanent: a leak is not something you
fix by deleting a file.

---

## 1. The line

| Public — belongs in git | Private — never in git |
|---|---|
| The model: "N areas, weights per year" | Which areas exist, and what their weights are |
| Entity and field definitions | Any real objective, project, initiative or task name |
| The scoring contract and shipped formulas | Real scores, or any real backlog |
| Environment **variable names**, the config contract | Values, secret-store paths, hostnames, cluster or IP details |
| The **schema shape** prisme expects from external tools | Page IDs, database IDs, workspace URLs, account identifiers |
| Synthetic fixtures, and screenshots built from them | Screenshots or exports of the live instance |
| Why allocation fails in personal systems, in general | The measurements that motivated this specific build |

### The test to apply

Before committing any line, ask: **"could a stranger learn something about a specific person from
this?"** If yes, it is instance data. Instance data has exactly two homes: the database, and
`seed/` (gitignored).

### Borderline cases, resolved

- **Names of external databases.** Even a database *name* describes someone's setup. prisme refers
  to external stores by **role key** — `objectives_db`, `takeaways_db`, `media_db`, `areas_db`,
  `processes_db`, `reviews_db`, and the page and template roles ADR-0025 and ADR-0028 added
  (`initiative_pages_db`, `project_pages_db`, `capture_pages_db` and their templates) — and binds
  those to real IDs in `seed/`. This is better engineering anyway: the app works against any
  workspace, not one.
- **Area names.** The model says "N areas". Which areas, and their weights, is configuration.
  Fixtures use an invented set that deliberately does not match any real one.
- **Language.** The instance's data is French; the code and docs are English. Domain terms are
  translated in the glossary in [`10-model.md`](10-model.md), not illustrated with real rows.
- **Commit messages and PR descriptions** are part of public history. Same rules.
- **Test fixtures and snapshot files.** The most common accidental leak: a developer copies a real
  payload into a test to reproduce a bug. Use `fixtures/`, or redact before saving.

---

## 2. Mechanisms

A rule nobody enforces is a wish. Six mechanisms, in order of how much they actually catch:

### 2.1 Instance data lives outside git

Areas, weights, tool mappings and external IDs load from `seed/` (gitignored) or from the
deployment's secret store, straight into PostgreSQL. **There is no committed file that knows
anything about a real person.** `seed/README.md` documents the format; the data never appears.

### 2.2 Synthetic fixtures are the only data allowed anywhere else

[`fixtures/`](../fixtures/) holds an invented dataset — areas, objectives, initiatives, tasks — with
enough shape to exercise the model. It is the **only** data permitted in documentation, tests,
screenshots, and API or MCP examples. If a fixture is missing something you need, extend the
fixture set; do not reach for real data.

### 2.3 Secret scanning with push protection

Enabled at the repository level (§4). This is the one control that blocks a mistake *before* it
reaches public history rather than reporting it afterwards. It catches credentials only — not
personal content.

### 2.4 The privacy deny-list scan

`.github/privacy-denylist.txt` lists patterns that must never appear: real names, workspace
domains, and the ID shapes used by the external tools (32-hex Notion IDs; task-tool ids, which are
16-character alphanumeric strings since that tool moved to its `v1` API, and were long numeric
strings before it — both shapes are listed, because the older one survives in anything recorded
earlier). CI fails on a hit; it also runs as a pre-commit hook, so the common case is caught
locally.

The deny-list is itself public, so it contains **patterns, not secrets** — ID *shapes* rather than
real IDs, and it references personal names indirectly where it must.

An identifier is only a hit in a position where one is *written*, and the key's spelling is part of
that: `project_id: …` and `projectId: …` are two patterns, because a word boundary never reaches the
`Id` inside `projectId`. The camelCase pattern requires the value to be a **quoted** string literal,
which is the only way this scanner can tell a pasted id from a code expression — `projectId:
parentExternalId` is sixteen alphanumeric characters in an id position and is code, not data. That
limit is deliberate and written beside the pattern: an unquoted camelCase value, and a quoted
all-letters sixteen-character word, are not covered.

### 2.5 gitleaks

Runs in CI and as a pre-commit hook, covering credential shapes that push protection may not know.

### 2.6 The journal rule

`docs/50-journal/` is committed and therefore public. Entries record **what was decided and why,
never what the data said.**

- ✅ "Adopted 7 unlinked objectives; 2 needed manual matching because titles had diverged."
- ❌ Anything naming a real objective, project, area or task.

Debugging notes that genuinely need real values go in a `<entry>-private.md` sibling, which is
gitignored.

This is the **likeliest leak path in the whole project**, because it happens under pressure: an
agent is debugging a sync against live data, something is wrong, and the natural thing to write
down is the row that broke. Every workstream brief repeats this rule for that reason.

---

## 3. If something leaks

1. **Do not just delete the file and commit.** The content stays in history and in any clone or
   fork made since.
2. If a **credential** leaked: rotate it first, before anything else. Treat it as compromised —
   public repositories are scraped within minutes.
3. If **personal content** leaked: assess reach (was it pushed? for how long? is the repo forked or
   indexed?), then rewrite history with `git filter-repo` and force-push, or — if the repository is
   young — delete and recreate it, which is cleaner and faster.
4. Record what happened and what changed to prevent it, in an ADR or a journal entry. Describe the
   *class* of mistake, not the leaked content.

---

## 4. GitHub settings checklist

To switch on before the repository goes public. All are free on public repositories.
Enabled 2026-09-15, when the repository was published. **Re-read from the GitHub API on 2026-09-18
(W14)** rather than from this list — a settings checklist that is only ever read is a settings
checklist that drifts. Every line below says what the API actually returned.

- [x] **Secret scanning** — on *(verified: `secret_scanning.status = enabled`)*
- [x] **Push protection** — on *(verified; the highest-value setting here)*
- [x] **CodeQL** code scanning — **closed by W00 (#5)**: an advanced setup in
      `.github/workflows/codeql.yml` covering `actions`, `javascript-typescript` and `python` with
      the `security-extended` suite. The default setup could never have closed it — it derives its
      language list from the default branch, so it refuses `javascript-typescript` until the code
      has already merged
- [x] **Dependabot** alerts, security updates, and version updates (`.github/dependabot.yml`)
      *(verified: `dependabot_security_updates.status = enabled`)*
- [x] **Dependency review** on pull requests (`.github/workflows/dependency-review.yml`)
- [x] **Branch protection** on `main`: required status checks, no force-push, no deletion.
      **`enforce_admins` is now on** *(verified)*, which closes the bypass the owner's token used to
      have — the earlier note here said admins were deliberately excluded, and that is no longer
      true. A pull request is the only route to `main`, for everyone
- [x] **Actions permissions** — read-only `GITHUB_TOKEN` by default, elevated per workflow
- [x] Verify **forking** implications are understood: a fork made before a history rewrite keeps the
      old history. Forking was disabled while the repository was private and there were never any
      forks, so the pre-publication rewrite below was clean. It is enabled now, which is the normal
      state for a public repository and is only a hazard *before* a rewrite, not after one

### Two settings that needed a human, now closed (2026-09-18)

The repository-level API call from here was never the fix — it returns success but silently leaves
both settings `disabled`. The P0 finding was right that this needs an organisation-level action, and
the reason turned out to be twofold:

- Attaching an org **code security configuration** to the repository needs the `admin:org` OAuth
  scope, which the token in use during W14 didn't have.
- The org's existing default configuration ("GitHub recommended", id 17) failed to attach to
  `prisme` specifically: it also sets `code_scanning_default_setup: enabled`, which collides with
  prisme's custom advanced-setup CodeQL workflow ([`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml)).
  The attach call reports `status: "failed"` with no further detail, and — because it applies
  atomically — that silently took the two secret-scanning settings down with it too.

Fixed by creating a second, repo-scoped configuration ("prisme secret scanning", id `277411`) that
only sets the secret-scanning knobs and leaves code scanning, dependency graph and Dependabot as
`not_set`, then attaching that one to `prisme` alone:

- [x] **Secret scanning validity checks** *(verified: `enabled`, via config 277411)*
- [x] **Non-provider patterns** *(verified: `enabled`)* — the one that matters most here, because
      prisme's own tokens carry a `prisme_pat_` prefix (W14) and a non-provider pattern is how
      GitHub learns to recognise it

```
gh auth refresh -h github.com -s admin:org
gh api -X POST orgs/<org>/code-security/configurations \
  -f name="<repo> secret scanning" \
  -f secret_scanning=enabled -f secret_scanning_push_protection=enabled \
  -f secret_scanning_validity_checks=enabled -f secret_scanning_non_provider_patterns=enabled \
  -f advanced_security=enabled \
  -f code_scanning_default_setup=not_set -f dependency_graph=not_set \
  -f dependabot_alerts=not_set -f dependabot_security_updates=not_set \
  -f private_vulnerability_reporting=not_set
gh api -X POST orgs/<org>/code-security/configurations/<id>/attach \
  -f scope=selected -F 'selected_repository_ids[]=<repo id>'
```

Note for the next reader: `repos/<owner>/<repo>` (`security_and_analysis`) does not reflect settings
applied through an org configuration — it only mirrors direct repository-level toggles, and kept
reporting both as `disabled` after they were verifiably live. Read
`repos/<owner>/<repo>/code-security-configuration` instead.

### One drift found, and now closed (2026-09-18)

The required-check list on `main` did **not** include `golden fixtures`, though
[`STATUS.md`](../STATUS.md) has recorded it as required since W01 (#17), and `security gate
self-test` (W14) had never been added either. It was a branch-protection change rather than a
repository change, so W14 listed it for a human rather than making it silently. Closed by PATCHing
`repos/<owner>/<repo>/branches/main/protection/required_status_checks` with the full 15-context
list (the original 13 plus both) and reading the result back from the API to confirm — `strict`
must be sent as a real boolean (`-F`, not `-f`, in `gh api`) or GitHub rejects the request.

## 5. Pre-publication sweep

Run once, before the repository is made public. Cheap now; impossible later.

- [ ] `gitleaks detect --no-git` over the working tree
- [ ] `gitleaks detect` over the **entire history**
- [ ] Privacy deny-list scan over the **entire history**, not just `HEAD`
- [ ] Manual read of every file in `docs/` and `fixtures/` with §1's test in mind
- [ ] `git log --all --format=%s%n%b` read in full — commit messages are public too
- [ ] Confirm `seed/` is absent from `git ls-files`
