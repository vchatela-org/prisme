#!/usr/bin/env python3
#
# Golden fixture / method version pairing.
#
# `fixtures/scoring/*.golden.json` pins a scoring method's inputs to its exact
# outputs. Changing what a method computes is legitimate; changing it without
# bumping `version` is not, because a stored score is attributed to the method
# and version that produced it (ADR-0006). Once two runs of "version 1" mean two
# different things, every historical score becomes unattributable — and nothing
# about that failure is visible at the time it happens.
#
# So the rule, in one line:
#
#   a golden file whose content changed must carry a higher `method.version`
#
# The other half of the pairing — that the golden file's version equals the
# version the registered method actually reports — is asserted by
# `packages/domain/src/scoring/wsjf-balanced.test.ts`, which can read the real
# object rather than guessing at it from source text.
#
#   ./scripts/check-golden-fixtures.py            compare against origin/main
#   ./scripts/check-golden-fixtures.py <base>     compare against a given ref
#
# Exits non-zero when a golden file moved without its version.

import json
import subprocess
import sys
from pathlib import Path

GOLDEN_DIR = Path("fixtures/scoring")
GOLDEN_GLOB = "*.golden.json"


def run(*args: str) -> str:
    return subprocess.run(
        args, capture_output=True, text=True, check=False
    ).stdout.strip()


def version_of(document: object, where: str) -> int:
    if not isinstance(document, dict):
        raise ValueError(f"{where}: expected a JSON object at the top level")
    method = document.get("method")
    if not isinstance(method, dict):
        raise ValueError(f'{where}: no "method" object — a golden file must say what produced it')
    version = method.get("version")
    method_id = method.get("id")
    if not isinstance(method_id, str) or not method_id:
        raise ValueError(f'{where}: "method.id" must name the scoring method')
    if not isinstance(version, int):
        raise ValueError(f'{where}: "method.version" must be a whole number')
    return version


def at_ref(ref: str, path: str) -> str | None:
    """The file's content at a git ref, or None when it did not exist there."""
    result = subprocess.run(
        ["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=False
    )
    return result.stdout if result.returncode == 0 else None


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"

    if not run("git", "rev-parse", "--verify", "--quiet", base):
        print(f"check-golden-fixtures: no such ref {base!r}; nothing to compare against")
        return 0

    golden_files = sorted(GOLDEN_DIR.glob(GOLDEN_GLOB))
    if not golden_files:
        print(f"check-golden-fixtures: no {GOLDEN_GLOB} under {GOLDEN_DIR}/")
        return 0

    problems: list[str] = []

    for path in golden_files:
        key = path.as_posix()

        try:
            head = version_of(json.loads(path.read_text()), key)
        except (ValueError, json.JSONDecodeError) as error:
            problems.append(str(error))
            continue

        previous_text = at_ref(base, key)
        if previous_text is None:
            print(f"  new      {key} — at version {head}")
            continue

        if previous_text == path.read_text():
            print(f"  unchanged {key} — version {head}")
            continue

        try:
            previous = version_of(json.loads(previous_text), f"{key}@{base}")
        except (ValueError, json.JSONDecodeError) as error:
            problems.append(str(error))
            continue

        if head > previous:
            print(f"  bumped   {key} — {previous} -> {head}")
        else:
            problems.append(
                f"{key} changed but method.version is still {head}.\n"
                f"    A golden file records what a method computes. Changing it without a "
                f"version bump makes every stored score ambiguous (ADR-0006).\n"
                f"    Bump `version` on the method in packages/domain/src/scoring/ and in "
                f"this file, or revert the fixture."
            )

    if problems:
        print("\ncheck-golden-fixtures: FAILED\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print("check-golden-fixtures: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
