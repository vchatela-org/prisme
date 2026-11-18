#!/usr/bin/env python3
#
# The `dependency audit` gate, and the negative controls that keep it honest.
#
#   ./scripts/dependency-audit.py             audit the lockfile and gate on it
#   ./scripts/dependency-audit.py --selftest  run the classifier's controls only
#
# `pnpm audit` asks registry.npmjs.org for the advisories covering this lockfile.
# Four things can come back, and only one of them is a clean green:
#
#   the database answered, nothing at or above the level      -> green
#   the database answered, advisories at or above the level   -> red, with them
#   the database answered, and every finding matches a live
#     acceptance in .github/dependency-audit-allowlist.json   -> green, but a
#                                                                distinct state,
#                                                                loudly named
#   the database did not answer, or answered unreadably       -> red, and it says
#                                                                which of the two
#
# The third state is the narrow exception of [ADR-0043]. It is not a waiver:
# the finding is still printed with its id, expiry and reason, an expired or
# unreadable entry turns the gate red, and a production or critical finding is
# never accepted.
#
# The last state is why this is a script rather than one line in the workflow.
# `pnpm audit` exits 1 for both a finding and a failure to read, so a required
# check that is red for "could not check" is indistinguishable in a pull
# request's status list from one that is red for a vulnerability: a reviewer
# reads an npm outage as a CVE, and [#31] spent a re-run cycle learning that on
# 2026-09-19.
#
# **The gate never passes without having actually checked.** That is the
# non-negotiable recorded in `docs/20-decisions/OPEN.md` (OQ-10) and decided in
# [ADR-0027](../docs/20-decisions/0027-audit-gate-fails-closed.md). Two
# consequences are built in and both have a control below:
#
#   * `--ignore-registry-errors` is never passed, and the selftest asserts it
#     stays that way. With it, an unreachable registry prints a report that is
#     the same shape as a clean one — real dependency counts, zero advisories —
#     and exits 0. That was measured on 2026-09-24 against a dead registry, not
#     reasoned about, and the stderr line naming the failed request is the only
#     thing that gives it away. So the classifier reads stderr first and treats
#     any evidence of an unanswered query as *unchecked*, even at exit 0.
#   * an unreadable response is not a pass. If pnpm's JSON shape moves, this
#     fails closed and red, which is the direction that gets noticed; a shape
#     check that widened silently would be a gate that stops covering what it
#     exists for.
#
# A green is a *reading*, not a remembered one: pointed at a local endpoint that
# answered instantly and then stopped, the same command served no stored answer
# and hung instead. So no cache is quieting this gate either — it is asking, every
# run, and saying so when nobody answers.
#
# A bounded retry absorbs a transient blip — the common case — with no human in
# the loop. An outage still fails; the remedy is to re-run the job once the
# registry is back, which is the same remedy the cluster runner's wedge has, and
# never an empty commit. An attempt that has to be killed is bounded too
# (FETCH_TIMEOUT): a check that never reports is worse than one that fails.
#
# The audit report is third-party data like any other (docs/14-threat-model.md
# §2 boundary ⑤): it is parsed, its fields are type-checked, and what reaches the
# log is sanitised and truncated. A compromised registry must not be able to
# forge the verdict, and it must not be able to write terminal control sequences
# into a public build log either.
#
# [31]: https://github.com/vchatela-org/prisme/pull/31

import json
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

# Mirrors the level the workflow has always used. `moderate` rather than `high`:
# this application holds API tokens to the owner's entire planning workspace
# (docs/14-threat-model.md §1), and the dependency surface is small enough that a
# moderate advisory is worth reading rather than batching.
AUDIT_LEVEL = "moderate"
LEVELS = ("info", "low", "moderate", "high", "critical")

ATTEMPTS = 3
RETRY_DELAYS = (5, 15)  # between attempts, so only a real outage exhausts them

# `pnpm audit` against a black-holed endpoint does not fail, it retries — measured
# on 2026-09-24, where a stopped local endpoint left it running past sixty
# seconds. An unbounded check is one that never reports at all, so this is the
# ceiling on one attempt. A timeout is *unchecked* like any other silence: the
# gate fails in a known number of minutes rather than hanging for the runner's.
FETCH_TIMEOUT = 120

# The four states. The names are what the job summary prints.
CLEAN = "checked-clean"
VULNERABLE = "vulnerable"
UNCHECKED = "unchecked"
ACCEPTED = "accepted"

# The failures exit non-zero: the merge gate cannot see the difference, and must
# not — neither state is a green. `unchecked` gets its own code so that whatever
# *does* read this script (a person, a shell, a future job) can tell them apart.
# `accepted` exits 0 like a clean read, but it is a different state and prints a
# warning annotation: it means "read, and every finding is a named acceptance",
# never "nothing was found" (ADR-0043).
EXIT_CODES = {CLEAN: 0, VULNERABLE: 1, UNCHECKED: 2, ACCEPTED: 0}

# The acceptances, reviewed like code. An entry names one advisory (GitHub's
# advisory id plus the module), carries an expiry date, a reason and a tracking
# URL, and is only honoured for a dev-only finding that is not critical. Missing
# file -> no acceptances; unreadable, malformed, unbounded or incomplete ->
# `unchecked`, i.e. red. Never a quiet green. See
# [ADR-0043](../docs/20-decisions/0043-a-dev-only-advisory-can-be-accepted-until-its-patch-ships.md).
ALLOWLIST_PATH = (
    Path(__file__).resolve().parent.parent
    / ".github"
    / "dependency-audit-allowlist.json"
)
MAX_ALLOWLIST_ENTRIES = 10
NEVER_ACCEPTABLE = ("critical",)

# pnpm's own words when it could not get an answer out of the advisory endpoint.
# Matched on the code *and* on the prose, because the two appear in different
# forms depending on how the request failed.
ENDPOINT_FAILURE = re.compile(
    r"ERR_PNPM_AUDIT_BAD_RESPONSE|failed to request the audit endpoint",
    re.IGNORECASE,
)

# A registry URL may carry credentials (`https://user:token@host/`) and pnpm
# prints the URL it failed on. Nothing here may put a credential in a log.
URL_CREDENTIALS = re.compile(r"//[^/\s@]+@")

# Control characters would let a hostile report rewrite the log it is printed in.
UNSAFE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def safe(value, limit=200):
    """A third-party value, fit to print: no control characters, bounded."""
    text = UNSAFE.sub("", str(value)).replace("\n", " ")
    return URL_CREDENTIALS.sub("//***@", text)[:limit]


class Verdict:
    def __init__(
        self,
        state,
        counts=None,
        advisories=None,
        evidence=None,
        total=None,
        accepted=None,
        refusals=None,
    ):
        self.state = state
        self.counts = counts or {}
        self.advisories = advisories or []
        self.evidence = evidence
        self.total = total
        # `(entry, advisory)` pairs, kept so the log can name what was accepted.
        self.accepted = accepted or []
        # `(advisory, reason)` pairs for findings an entry named but refused.
        self.refusals = refusals or []

    @property
    def exit_code(self):
        return EXIT_CODES[self.state]


def parse_report(stdout):
    """The audit report, or None if stdout is not one.

    A report has to carry all five severity counts and a dependency total. A
    response missing any of them is not a reading this gate is willing to
    report on, so it becomes *unchecked* — the state that fails.
    """
    try:
        report = json.loads(stdout)
    except (ValueError, TypeError):
        return None
    if not isinstance(report, dict):
        return None

    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        return None
    counts = metadata.get("vulnerabilities")
    if not isinstance(counts, dict):
        return None

    clean = {}
    for level in LEVELS:
        value = counts.get(level)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
        clean[level] = value

    total = metadata.get("totalDependencies")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        return None

    advisories = []
    raw = report.get("advisories")
    if isinstance(raw, dict):
        for key in sorted(raw, key=str):
            item = raw[key]
            if not isinstance(item, dict):
                continue
            findings = item.get("findings")
            # Only a finding that is entirely in the dev tree can be accepted.
            # No findings array, or any non-dev path, means "not accept-able".
            dev_only = (
                isinstance(findings, list)
                and len(findings) > 0
                and all(
                    isinstance(finding, dict) and finding.get("dev") is True
                    for finding in findings
                )
            )
            advisories.append(
                {
                    "id": safe(item.get("github_advisory_id", ""), 60),
                    "module": safe(item.get("module_name", "?"), 80),
                    "severity": safe(item.get("severity", "?"), 20),
                    "title": safe(item.get("title", ""), 160),
                    "url": safe(item.get("url", ""), 200),
                    "dev_only": dev_only,
                }
            )

    return {"counts": clean, "total": total, "advisories": advisories}


def parse_allowlist(text):
    """The committed acceptances, or an error string. Pure.

    `text` is the allowlist file's content, or None when there is no file (which
    means no acceptances). Anything malformed returns an error, and `classify`
    turns that into *unchecked*: an acceptance nobody can read must never become
    a quiet green (ADR-0043).
    """
    if text is None:
        return None, None
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None, "the audit allowlist is not valid JSON"
    if not isinstance(data, dict) or not isinstance(data.get("accepted"), list):
        return None, "the audit allowlist has no `accepted` list"
    if len(data["accepted"]) > MAX_ALLOWLIST_ENTRIES:
        return None, f"the audit allowlist has more than {MAX_ALLOWLIST_ENTRIES} entries"

    entries = []
    for raw in data["accepted"]:
        if not isinstance(raw, dict):
            return None, "an audit allowlist entry is not an object"
        entry = {}
        for key in ("id", "module", "expires", "reason", "tracking"):
            value = raw.get(key)
            if not isinstance(value, str) or not value.strip():
                return None, f"an audit allowlist entry is missing `{key}`"
            entry[key] = value.strip()
        try:
            entry["expires"] = date.fromisoformat(entry["expires"])
        except ValueError:
            return None, "an audit allowlist entry has an `expires` that is not YYYY-MM-DD"
        entries.append(entry)
    return entries, None


def acceptance(advisory, entries, today):
    """The live acceptance matching this advisory, or the reason it is refused.

    Returns `(entry, None)` when accepted and `(None, reason)` when refused for a
    stated reason; `(None, None)` means no entry names this advisory.
    """
    for entry in entries:
        if entry["id"] != advisory["id"] or entry["module"] != advisory["module"]:
            continue
        if entry["expires"] < today:
            return None, f"{entry['id']} acceptance expired on {entry['expires'].isoformat()}"
        if advisory["severity"] in NEVER_ACCEPTABLE:
            return None, f"{entry['id']} is {advisory['severity']}, which is never accepted"
        if not advisory["dev_only"]:
            return None, f"{entry['id']} reaches a production dependency"
        return entry, None
    return None, None


def classify(exit_code, stdout, stderr, allowlist_text=None, today=None):
    """(exit code, stdout, stderr, allowlist) -> Verdict. Pure, and the gate.

    `exit_code` is None when the attempt had to be killed at FETCH_TIMEOUT.

    Order matters. Evidence of an unanswered query is checked **first**, ahead of
    the exit code and ahead of the report, because the one way to get a clean
    looking report without a check is to ask pnpm to ignore registry errors — and
    that path exits 0.
    """
    if exit_code is None:
        return Verdict(
            UNCHECKED,
            evidence=f"pnpm audit did not finish within {FETCH_TIMEOUT}s",
        )

    failure = ENDPOINT_FAILURE.search(stdout) or ENDPOINT_FAILURE.search(stderr)
    if failure:
        return Verdict(
            UNCHECKED,
            evidence="the advisory endpoint did not answer ("
            + safe(failure.group(0), 60)
            + ")",
        )

    report = parse_report(stdout)
    if report is None:
        detail = safe(stderr.strip().splitlines()[0], 160) if stderr.strip() else ""
        return Verdict(
            UNCHECKED,
            evidence="the response was not readable as an audit report"
            + (f": {detail}" if detail else ""),
        )

    counted = list(LEVELS[LEVELS.index(AUDIT_LEVEL) :])
    at_or_above = {level: report["counts"][level] for level in counted}
    finding_count = sum(at_or_above.values())
    if finding_count > 0:
        entries, allowlist_error = parse_allowlist(allowlist_text)
        if allowlist_error:
            return Verdict(UNCHECKED, evidence=allowlist_error)

        named = [
            advisory
            for advisory in report["advisories"]
            if advisory["severity"] in counted
        ]
        # One entry in the advisory map is not one dependency instance, but the
        # counts and the named advisories come from the same reading. If they
        # disagree, something counted is unnamed — and an unnamed finding cannot
        # be accepted, so it keeps the gate red.
        if len(named) != finding_count:
            return Verdict(
                VULNERABLE,
                counts=at_or_above,
                advisories=report["advisories"],
                total=report["total"],
                evidence="the report counts findings it does not name, so none can be accepted",
            )

        accepted, refused = [], []
        for advisory in named:
            entry, reason = acceptance(
                advisory,
                entries or [],
                today if today is not None else date.today(),
            )
            if entry is not None:
                accepted.append((entry, advisory))
            else:
                refused.append((advisory, reason))

        if not refused:
            return Verdict(
                ACCEPTED,
                counts=at_or_above,
                advisories=report["advisories"],
                total=report["total"],
                accepted=accepted,
            )
        return Verdict(
            VULNERABLE,
            counts=at_or_above,
            advisories=report["advisories"],
            total=report["total"],
            accepted=accepted,
            refusals=refused,
        )

    return Verdict(CLEAN, counts=at_or_above, total=report["total"])


def build_command():
    """The audit command. Built in one place so a control can read it.

    `--ignore-registry-errors` is absent on purpose and by decision: with it, a
    registry that never answered reports as clean and exits 0 (ADR-0027,
    *Alternatives*). The selftest asserts it stays absent.
    """
    return ["pnpm", "audit", f"--audit-level={AUDIT_LEVEL}", "--json"]


def run_audit():
    try:
        proc = subprocess.run(
            build_command(),
            capture_output=True,
            text=True,
            check=False,
            timeout=FETCH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return None, "", ""
    return proc.returncode, proc.stdout, proc.stderr


# --- reporting ---------------------------------------------------------------


def render(verdict):
    """The state, where a reviewer will actually see it.

    The check's name is fixed — it is a required context — so the state cannot
    travel in the name. It travels in the job summary and in an annotation.
    Pure (no file, no stdout), so the controls below can assert on what it says
    without polluting the job summary they run beside.
    """
    lines = [
        "### dependency audit",
        "",
        f"- state: **{verdict.state}**",
        f"- audit level: `{AUDIT_LEVEL}`",
    ]
    if verdict.state == CLEAN:
        lines.append(f"- dependencies in the lockfile: {verdict.total}")
        lines.append(
            f"- advisories at or above `{AUDIT_LEVEL}`: 0 "
            f"({', '.join(f'{k} {v}' for k, v in verdict.counts.items())})"
        )
        lines.append("")
        lines.append("The advisory database answered. This is a real reading.")
    elif verdict.state == ACCEPTED:
        lines.append(
            f"- counts at or above `{AUDIT_LEVEL}`: "
            f"{', '.join(f'{k} {v}' for k, v in verdict.counts.items())}"
        )
        lines.append("")
        lines.append("The advisory database answered. These findings are accepted:")
        for entry, advisory in verdict.accepted:
            lines.append(
                f"- **{advisory['severity']}** `{advisory['module']}` — "
                f"{safe(entry['id'], 60)}, accepted until "
                f"{entry['expires'].isoformat()}: {safe(entry['reason'], 200)} "
                f"Tracking: {safe(entry['tracking'], 200)}"
            )
        lines.append("")
        lines.append(
            "**Accepted is not clean.** The advisory is real; this gate would "
            "still fail on any other finding. When the entry expires this check "
            "goes red until the dependency is patched or the acceptance is "
            "renewed on purpose (ADR-0043)."
        )
    elif verdict.state == VULNERABLE:
        lines.append(
            f"- counts at or above `{AUDIT_LEVEL}`: "
            f"{', '.join(f'{k} {v}' for k, v in verdict.counts.items())}"
        )
        lines.append("")
        if verdict.evidence:
            lines.append(f"- {safe(verdict.evidence, 200)}")
            lines.append("")
        if verdict.advisories:
            refused = {
                (advisory["id"], advisory["module"]): reason
                for advisory, reason in verdict.refusals
                if reason
            }
            lines.append(f"{len(verdict.advisories)} advisory(ies) to read:")
            for advisory in verdict.advisories:
                reason = refused.get((advisory["id"], advisory["module"]))
                lines.append(
                    f"- **{advisory['severity']}** `{advisory['module']}` — "
                    f"{advisory['title']} {advisory['url']}"
                    + (f" — *acceptance refused: {safe(reason, 160)}*" if reason else "")
                )
        else:
            lines.append(
                "The report counted advisories and named none, which is a report "
                "shape this gate does not expect: treat the counts above as the "
                "finding until the audit is read in full."
            )
        if verdict.accepted:
            lines.append("")
            lines.append(
                f"{len(verdict.accepted)} of those match a live acceptance and "
                "are not what makes this red: "
                + ", ".join(
                    f"{safe(entry['id'], 60)} until {entry['expires'].isoformat()}"
                    for entry, _ in verdict.accepted
                )
            )
    else:
        lines.append(f"- evidence: {verdict.evidence}")
        lines.append("")
        if verdict.evidence and "allowlist" in verdict.evidence:
            lines.append(
                "**The gate failed closed on its own allowlist.** An acceptance "
                "that cannot be read must never become a green, so this is "
                "`unchecked`: red until the file is valid, complete and within "
                "the entry cap (ADR-0043)."
            )
        else:
            lines.append(
                "**This is not a vulnerability report.** The audit could not be "
                "completed, so the gate has nothing to report on and fails closed "
                "(ADR-0027). Re-run this job once the registry answers again — "
                "do not push an empty commit, and do not reach for "
                "`--ignore-registry-errors`, which reports this state as a pass."
            )

    return "\n".join(lines) + "\n"


def publish(body):
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(body)


def report(verdict):
    body = render(verdict)
    publish(body)
    for line in body.splitlines():
        print(line)
    if verdict.state == CLEAN:
        print(f"::notice::dependency audit: {verdict.state}")
    elif verdict.state == ACCEPTED:
        named = ", ".join(
            f"{safe(entry['id'], 60)} until {entry['expires'].isoformat()}"
            for entry, _ in verdict.accepted
        )
        print(
            f"::warning::dependency audit: accepted — {named}. These findings "
            "are real; the gate is green only for the named acceptances "
            "(ADR-0043)."
        )
    elif verdict.state == VULNERABLE:
        print(f"::error::dependency audit: {verdict.state} — see the summary above")
    else:
        print(
            "::error::dependency audit: unchecked — nothing was checked, or the "
            "audit allowlist could not be read (ADR-0027, ADR-0043)"
        )


# --- the negative controls ---------------------------------------------------
#
# A gate that has not been watched fail is a gate nobody knows is wired up
# (W00, W14). These run inside the `dependency audit` job rather than as a check
# of their own: a new check *name* would need a human to add it to branch
# protection before it meant anything, and a required control that is not
# required is a green nobody reads — the same reasoning that folded the test-file
# typecheck into `typecheck` (docs/50-journal/FUP-2026-09-23-typecheck-tests.md).

CLEAN_REPORT = {
    "advisories": {},
    "metadata": {
        "vulnerabilities": {
            "info": 0,
            "low": 0,
            "moderate": 0,
            "high": 0,
            "critical": 0,
        },
        "dependencies": 112,
        "devDependencies": 271,
        "optionalDependencies": 166,
        "totalDependencies": 447,
    },
}

# Invented, and shaped like npm's: the control asserts how the classifier reads a
# report, not what npm publishes. A fabricated advisory keeps a real one out of a
# public log, and the shape is checked against the live report by the run above.
VULNERABLE_REPORT = {
    "advisories": {
        "1": {
            "id": 1,
            "module_name": "fixture-lib",
            "severity": "moderate",
            "title": "Prototype pollution in a nested merge (invented)",
            "url": "https://example.invalid/advisories/GHSA-0000-0000-0000",
            "findings": [],
        }
    },
    "metadata": {
        "vulnerabilities": {
            "info": 0,
            "low": 0,
            "moderate": 1,
            "high": 0,
            "critical": 0,
        },
        "totalDependencies": 447,
    },
}

# Shaped like the real report that opened ADR-0043, with an invented advisory id
# and one dev path. The shape (github_advisory_id, findings[].dev) is what the
# acceptance matches on; the live run above checks it against npm's answer.
DEV_ONLY_FINDING = {
    "advisories": {
        "1": {
            "id": 1,
            "github_advisory_id": "GHSA-fixture-0000-0000",
            "module_name": "fixture-lib",
            "severity": "high",
            "title": "A dev-only finding (invented)",
            "url": "https://example.invalid/advisories/GHSA-fixture-0000-0000",
            "findings": [
                {
                    "version": "1.0.0",
                    "paths": [".>vite>fixture-lib"],
                    "dev": True,
                    "optional": False,
                    "bundled": False,
                }
            ],
        }
    },
    "metadata": {
        "vulnerabilities": {
            "info": 0,
            "low": 0,
            "moderate": 0,
            "high": 1,
            "critical": 0,
        },
        "totalDependencies": 447,
    },
}

ACCEPTANCE_DAY = date(2026, 11, 18)


def allowlist(entry_overrides=None, entries=None):
    """An allowlist file's content, with an invented, still-live acceptance."""
    entry = {
        "id": "GHSA-fixture-0000-0000",
        "module": "fixture-lib",
        "expires": "2026-12-18",
        "reason": "dev-only and unpatchable (invented)",
        "tracking": "https://example.invalid/issues/194",
    }
    entry.update(entry_overrides or {})
    return json.dumps({"accepted": entries if entries is not None else [entry]})


# What `pnpm audit --ignore-registry-errors` prints against a registry that never
# answered: a clean-looking report, real dependency counts, exit 0. Only stderr
# says otherwise, which is why the classifier reads stderr first. Recorded
# verbatim (bar the dead host) from the measurement that decided ADR-0027.
IGNORE_REGISTRY_ERRORS_STDERR = (
    "Failed to request the audit endpoint "
    "(at http://registry.invalid/-/npm/v1/security/advisories/bulk): "
    "error sending request for url\n"
    "    Connection refused (os error 111)\n"
)

UNREACHABLE_STDERR = (
    "Error: ERR_PNPM_AUDIT_BAD_RESPONSE\n"
    "\n"
    "  × Failed to request the audit endpoint (at http://registry.invalid/-/npm/v1/\n"
    "  │ security/advisories/bulk): error sending request for url\n"
    "  ╰─▶ Connection refused (os error 111)\n"
)


def controls():
    """(name, expected state, expected exit code, exit_code, stdout, stderr)."""
    return [
        (
            "a clean report is read as checked-and-clean, not as unchecked",
            CLEAN,
            EXIT_CODES[CLEAN],
            0,
            json.dumps(CLEAN_REPORT),
            "",
        ),
        (
            "an advisory at the level is a finding, and names its module",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            1,
            json.dumps(VULNERABLE_REPORT),
            "",
        ),
        (
            "an unreachable advisory endpoint is unchecked, never clean",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            1,
            "",
            UNREACHABLE_STDERR,
        ),
        (
            "an attempt killed at the timeout is unchecked, not silent",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            None,
            "",
            "",
        ),
        # The one that matters. This is the tempting one-flag "fix": a green that
        # was never a check, and the whole reason the classifier reads evidence
        # of an unanswered query ahead of the exit code.
        (
            "--ignore-registry-errors output is unchecked despite exit 0",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            0,
            json.dumps(CLEAN_REPORT),
            IGNORE_REGISTRY_ERRORS_STDERR,
        ),
        (
            "an unreadable response fails closed rather than passing",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            0,
            "<html><body>502 Bad Gateway</body></html>",
            "",
        ),
        (
            "a truncated report fails closed rather than passing",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            0,
            json.dumps(CLEAN_REPORT)[:120],
            "",
        ),
        (
            "a report with a severity count missing fails closed",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            0,
            json.dumps(
                {
                    "advisories": {},
                    "metadata": {"vulnerabilities": {"moderate": 0}},
                }
            ),
            "",
        ),
        (
            "a severity count that is not a number fails closed",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            0,
            json.dumps(
                {
                    "advisories": {},
                    "metadata": {
                        "vulnerabilities": {
                            "info": 0,
                            "low": 0,
                            "moderate": "none",
                            "high": 0,
                            "critical": 0,
                        },
                        "totalDependencies": 1,
                    },
                }
            ),
            "",
        ),
    ]


# The acceptance, watched failing in both directions: it must let exactly the
# named, live, dev-only, non-critical finding through, and must refuse everything
# else — including a malformed allowlist, which fails closed as *unchecked*.
def allowlist_controls():
    """(name, expected state, expected code, allowlist text, report, today)."""
    production = json.loads(json.dumps(DEV_ONLY_FINDING))
    production["advisories"]["1"]["findings"][0]["dev"] = False

    critical = json.loads(json.dumps(DEV_ONLY_FINDING))
    critical["advisories"]["1"]["severity"] = "critical"
    critical["metadata"]["vulnerabilities"]["high"] = 0
    critical["metadata"]["vulnerabilities"]["critical"] = 1

    unnamed = json.loads(json.dumps(DEV_ONLY_FINDING))
    unnamed["metadata"]["vulnerabilities"]["high"] = 2

    too_many = json.loads(allowlist())
    too_many["accepted"] = too_many["accepted"] * (MAX_ALLOWLIST_ENTRIES + 1)

    return [
        (
            "a live acceptance for a dev-only finding is accepted, not failed",
            ACCEPTED,
            EXIT_CODES[ACCEPTED],
            allowlist(),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "an expired acceptance is refused, and the gate is red",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist({"expires": "2026-11-17"}),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "an acceptance for another advisory does not apply",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist({"id": "GHSA-other-0000-0000"}),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "an acceptance for another module does not apply",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist({"module": "another-lib"}),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "a finding that reaches production is never accepted",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist(),
            production,
            ACCEPTANCE_DAY,
        ),
        (
            "a critical finding is never accepted",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist(),
            critical,
            ACCEPTANCE_DAY,
        ),
        (
            "a count the report does not name is never accepted",
            VULNERABLE,
            EXIT_CODES[VULNERABLE],
            allowlist(),
            unnamed,
            ACCEPTANCE_DAY,
        ),
        (
            "an allowlist that is not JSON fails closed",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            "{not json",
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "an entry without an expiry fails closed",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            json.dumps(
                {
                    "accepted": [
                        {
                            "id": "GHSA-fixture-0000-0000",
                            "module": "fixture-lib",
                            "reason": "invented",
                            "tracking": "https://example.invalid/issues/194",
                        }
                    ]
                }
            ),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
        (
            "an allowlist over the entry cap fails closed",
            UNCHECKED,
            EXIT_CODES[UNCHECKED],
            json.dumps(too_many),
            DEV_ONLY_FINDING,
            ACCEPTANCE_DAY,
        ),
    ]


# The gate prints third-party data (docs/14-threat-model.md §2 boundary ⑤), so
# what it prints is a control of its own: a registry response must not be able to
# leak a credential into a public log, and must not be able to rewrite the log it
# appears in. `(name, verdict, forbidden, required)`.
def render_controls():
    hostile = {
        "advisories": {
            "1": {
                "id": 1,
                "module_name": "fixture-lib\x1b[2J",
                "severity": "high",
                "title": "invented advisory\x07 with a bell",
                "url": "https://ci:sekrit@registry.invalid/advisory",
            }
        },
        "metadata": {
            "vulnerabilities": {
                "info": 0,
                "low": 0,
                "moderate": 0,
                "high": 1,
                "critical": 0,
            },
            "totalDependencies": 1,
        },
    }
    return [
        (
            "a hostile field cannot change the verdict it is printed in",
            classify(1, json.dumps(hostile), ""),
            ("\x1b", "\x07", "sekrit"),
            ("vulnerable", "fixture-lib", "high"),
        ),
        (
            "a credential in a failed registry URL does not reach the log",
            classify(
                1,
                "",
                "HttpError: registry request to "
                "https://ci:sekrit@registry.invalid/ failed\n",
            ),
            ("sekrit",),
            ("//***@", "not readable as an audit report"),
        ),
        (
            "an accepted finding is named with its id and expiry, not hidden",
            classify(
                1,
                json.dumps(DEV_ONLY_FINDING),
                "",
                allowlist_text=allowlist(),
                today=ACCEPTANCE_DAY,
            ),
            (),
            (
                "accepted",
                "GHSA-fixture-0000-0000",
                "2026-12-18",
                "Accepted is not clean",
            ),
        ),
    ]


def selftest():
    failures = 0
    checked = []

    for name, state, code, exit_code, stdout, stderr in controls():
        verdict = classify(exit_code, stdout, stderr)
        ok = verdict.state == state and verdict.exit_code == code
        mark = "✓" if ok else "✗"
        print(f"{mark} {name}: {verdict.state} (exit {verdict.exit_code})")
        if not ok:
            print(f"    expected {state} (exit {code})")
            failures += 1
        checked.append(verdict)

    for name, state, code, text, report_data, today in allowlist_controls():
        verdict = classify(
            1,
            json.dumps(report_data),
            "",
            allowlist_text=text,
            today=today,
        )
        ok = verdict.state == state and verdict.exit_code == code
        mark = "✓" if ok else "✗"
        print(f"{mark} {name}: {verdict.state} (exit {verdict.exit_code})")
        if not ok:
            print(f"    expected {state} (exit {code})")
            failures += 1
        checked.append(verdict)

    # The acceptance that is actually committed must be readable, complete and
    # within the cap on every run — otherwise a malformed file would only show up
    # the day a finding appears.
    try:
        committed = ALLOWLIST_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        committed = None
        print("! no committed audit allowlist: every finding will fail the gate")
    except OSError as exc:
        committed = None
        print(f"✗ the committed audit allowlist cannot be read: {type(exc).__name__}")
        failures += 1
    if committed is not None:
        entries, error = parse_allowlist(committed)
        if error:
            print(f"✗ the committed audit allowlist is not usable: {error}")
            failures += 1
        else:
            print(f"✓ the committed audit allowlist is usable "
                  f"({len(entries or [])} entrie(s))")
            for entry in entries or []:
                if entry["expires"] < date.today():
                    print(f"! the acceptance for {entry['id']} expired on "
                          f"{entry['expires'].isoformat()}: the audit is red until "
                          "it is renewed or the dependency is patched")

    for name, verdict, forbidden, required in render_controls():
        body = render(verdict)
        leaked = [needle for needle in forbidden if needle in body]
        missing = [needle for needle in required if needle not in body]
        ok = not leaked and not missing
        mark = "✓" if ok else "✗"
        print(f"{mark} {name}: {verdict.state}")
        if leaked:
            print(f"    these reached the log and must not: {leaked!r}")
        if missing:
            print(f"    the log does not say: {missing!r}")
        if not ok:
            failures += 1
        checked.append(verdict)

    # A classifier that answers `unchecked` to everything would satisfy half the
    # controls above and be worthless, so the verdicts must not all agree. This
    # is the clean-tree control the privacy selftest keeps for the same reason.
    states = {verdict.state for verdict in checked}
    if states == {UNCHECKED}:
        print("✗ the classifier answers unchecked to everything, so its\n"
              "  verdicts mean nothing")
        failures += 1
    else:
        print(f"✓ the classifier is discriminating: it reported {sorted(states)}")

    # The command itself, because the flag is the failure mode that looks like a
    # fix. Asserted here so that adding it is a red control rather than a quiet
    # green on the next pull request.
    command = build_command()
    if "--ignore-registry-errors" in command:
        print("✗ the audit command passes --ignore-registry-errors, which\n"
              "  reports an unanswered registry as clean (ADR-0027)")
        failures += 1
    else:
        print("✓ the audit command asks for a real answer "
              "(no --ignore-registry-errors)")

    print()
    if failures:
        print(f"dependency-audit selftest: FAILED — {failures} control(s) did not "
              f"behave as required.")
        print()
        print("This does not mean a dependency is vulnerable. It means the gate")
        print("that would have said so can no longer be trusted to, which is")
        print("worse: a gate that passes without checking looks exactly like a")
        print("gate that checked and found nothing. Fix the classifier, never")
        print("this script.")
        return 1

    print(f"dependency-audit selftest: {len(checked)} controls behaved as required.")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()

    try:
        allowlist_text = ALLOWLIST_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        allowlist_text = None
    # Any other OSError is left to fail the job: an allowlist that exists but
    # cannot be read must not be mistaken for one that is not there.

    attempt = 0
    while True:
        attempt += 1
        exit_code, stdout, stderr = run_audit()
        verdict = classify(exit_code, stdout, stderr, allowlist_text=allowlist_text)
        print(f"dependency audit: attempt {attempt}/{ATTEMPTS} — {verdict.state}")
        if verdict.state != UNCHECKED or attempt >= ATTEMPTS:
            break
        delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
        print(f"  retrying in {delay}s: a blip is not an outage.")
        time.sleep(delay)

    report(verdict)
    return verdict.exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
