# Deliberate CI gate failure — DO NOT MERGE

This branch exists to prove two security gates actually fail. It carries, on
purpose:

1. a credential-shaped string, for `gitleaks`;
2. a string matching the privacy deny-list, for `privacy deny-list`.

Both are fabricated. Neither is a real credential and neither describes a real
workspace. The branch is deleted as soon as both checks have been seen red.

See docs/40-workstreams/W00-foundations.md, definition of done: "CI is green and
fails on a deliberately committed fake secret and on a deliberate deny-list hit.
Test both — a security gate nobody has seen fail is a gate nobody knows is wired
up."
