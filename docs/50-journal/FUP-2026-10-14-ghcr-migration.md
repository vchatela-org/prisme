# FUP · 2026-10-14 · Published to GHCR, on a hosted runner

**Agent:** Claude · **Duration:** one run · **PR:** this entry's own · **Outcome:** `publish.yml`
builds on `ubuntu-latest` and pushes `ghcr.io/vchatela-org/prisme-{api,web}`; nothing is published by
this change — the images move on the next `v*` tag

The image build moved off the organisation's self-hosted runners and off Harbor. It is the last
thing keeping a public repository on those runners: every other workflow already ran on
`ubuntu-latest`, and `publish.yml`'s `runs-on: ${{ vars.CI_RUNNER || 'arc-runner-set' }}` fell back
to the self-hosted set.

## What was done

- `publish.yml` runs on GitHub-hosted `ubuntu-latest`, pushes to GHCR with the run's `GITHUB_TOKEN`
  (no registry secret), emits the SBOM and provenance attestation as before, and scans the pushed
  **image by digest** plus the Dockerfile with Trivy, failing on a HIGH or CRITICAL finding.
- The `kubernetes` buildx driver is gone with the self-hosted runner; a hosted runner has a Docker
  daemon. So is the `if: vars.HARBOR_REGISTRY != ''` gate and the `CI_RUNNER` fallback.
- `docs/15-runtime.md` §1 corrected: "pushed to Harbor" → "pushed to GHCR", and the W00 correction
  names the shared GHCR workflow rather than the Harbor one.

## Decisions taken

- **GitHub-hosted, not a restricted self-hosted set.** Standard runners are free for public
  repositories and carry no cluster identity of their own; a dedicated runner set would put
  public-repo code back inside the cluster — with its own namespace, service account and network
  policy — to avoid a cost that does not exist.
- **This change publishes nothing and pins nothing.** `publish.yml` fires on a `v*` tag, so the
  first GHCR image comes with the next release; the deployment pin moves in the deployment
  repository after that. Release, then pin.
- **The build stays in this repository, direct.** The shared GHCR workflow builds one image from
  `context: .` with no Dockerfile input, so it still cannot build this monorepo; the W00 reason
  stands, only the registry changed.

## Surprises

- Harbor was an **internal** host, so it was never reachable from a hosted runner. The self-hosted
  runner and the `kubernetes` BuildKit driver both existed to reach it — removing the runner removes
  all three at once, and no fallback is needed.
- `docs/15-runtime.md` §1 was the only **live** spec naming Harbor. Every other mention is a
  workstream or journal record — history as it was written — and is left untouched.

## Follow-ups

| Item | Owner |
|---|---|
| Move the deployment pin to `ghcr.io/vchatela-org/prisme-{api,web}:<tag>@sha256:<digest>` after the next tag | the human, with the deployment repository |
| Set the two GHCR packages **public** so cluster nodes pull anonymously | the human |
| Remove the now-unused `HARBOR_*` repository variables and secrets here | the human |

## Specs touched

- `docs/15-runtime.md` — §1 build/publish path.
