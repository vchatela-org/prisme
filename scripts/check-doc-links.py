#!/usr/bin/env python3
#
# Internal documentation link check.
#
# The specification cites itself constantly — briefs cite ADRs, ADRs cite the
# model, the model cites the ownership matrix. A broken citation does not look
# broken: a link to a missing anchor lands silently at the top of the right
# file, so the reader gets a plausible-looking page and the wrong section.
# That is how a spec set stops being worth citing. See docs/50-journal/
# P0-2026-09-15-model-frozen.md, which found fourteen of them at once.
#
#   ./scripts/check-doc-links.py          check every tracked markdown file
#   ./scripts/check-doc-links.py -v       also print what was checked
#
# Checks relative links resolve to a real file, and that any #fragment resolves
# to a real heading. External links are not fetched — this is a consistency
# check, not a crawler. Exits non-zero on any broken reference.

import os
import re
import subprocess
import sys
import urllib.parse

# Fenced code blocks hold examples: the entry template in the journal index has
# lines starting with "#" that are not headings, and would otherwise invent
# anchors that do not exist on the rendered page.
FENCE = re.compile(r"^(?P<f>```|~~~).*?^(?P=f)\s*$", re.M | re.S)
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$", re.M)
LINK = re.compile(r"(?<!\!)\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*([^)\s]+)")


def strip_fences(text: str) -> str:
    """Blank out fenced blocks, preserving line numbers for error messages."""
    return FENCE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def slug(heading: str) -> str:
    """GitHub's heading anchor, as github-slugger computes it."""
    s = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", heading)  # links -> their text
    s = re.sub(r"<[^>]+>", "", s)                           # inline html
    s = re.sub(r"[`*_~]", "", s)                            # emphasis, code
    s = s.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)        # punctuation
    # Each space becomes one hyphen; runs are NOT collapsed. "P0 · Model" has
    # two spaces once the separator is stripped, and anchors as "p0--model".
    return s.replace(" ", "-")


def anchors_of(path: str, _cache: dict = {}) -> set:
    if path not in _cache:
        seen, out = {}, set()
        for _, text in HEADING.findall(strip_fences(read(path))):
            base = slug(text)
            n = seen.get(base, 0)
            seen[base] = n + 1
            out.add(base if n == 0 else f"{base}-{n}")  # duplicate headings
        _cache[path] = out
    return _cache[path]


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def main() -> int:
    verbose = "-v" in sys.argv[1:]
    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    os.chdir(root)

    files = subprocess.run(
        ["git", "ls-files", "*.md"], capture_output=True, text=True, check=True,
    ).stdout.split()

    broken, checked = [], 0
    for path in files:
        text = strip_fences(read(path))
        for m in LINK.finditer(text):
            target = m.group(1).strip("<>")
            if target.startswith(("http://", "https://", "mailto:", "#!")):
                continue
            rel, _, frag = target.partition("#")
            rel, frag = urllib.parse.unquote(rel), urllib.parse.unquote(frag)
            line = text.count("\n", 0, m.start()) + 1
            where = f"{path}:{line}"
            checked += 1

            dest = path if not rel else os.path.normpath(
                os.path.join(os.path.dirname(path), rel))
            if not os.path.exists(dest):
                broken.append(f"{where}  {target}\n      no such file: {dest}")
                continue
            if frag and dest.endswith(".md") and frag not in anchors_of(dest):
                broken.append(f"{where}  {target}\n      no such heading in {dest}")
                continue
            if verbose:
                print(f"  ok  {where}  {target}")

    print(f"check-doc-links: {checked} internal links across {len(files)} files")
    if broken:
        print(f"\ncheck-doc-links: FAILED — {len(broken)} broken reference(s)\n",
              file=sys.stderr)
        for b in broken:
            print(f"  ✗ {b}", file=sys.stderr)
        print(
            "\nAnchors are the usual cause: headings here are numbered, so a link\n"
            "to '## 4. Measuring capacity' is '#4-measuring-capacity', not\n"
            "'#measuring-capacity'. The short form resolves to the top of the file\n"
            "instead of failing, which is why these survive review.",
            file=sys.stderr,
        )
        return 1
    print("check-doc-links: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
