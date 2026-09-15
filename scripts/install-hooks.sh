#!/usr/bin/env bash
#
# Install pre-commit hooks that catch leaks before they leave the machine.
# Run once after cloning:  ./scripts/install-hooks.sh

set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"

cat > "$ROOT/.git/hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# prisme pre-commit: privacy deny-list + gitleaks on staged content.
#
# A public repository's history is permanent, so catching a leak here is
# worth far more than catching it in CI after a push.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"

"$ROOT/scripts/privacy-scan.sh" --staged

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact --no-banner
else
  echo "pre-commit: gitleaks not installed locally — CI will still check." >&2
fi
HOOK

chmod +x "$ROOT/.git/hooks/pre-commit"
echo "installed: .git/hooks/pre-commit"
echo
echo "Optional but recommended: install gitleaks locally so secrets are caught"
echo "before they are committed rather than after they are pushed."
