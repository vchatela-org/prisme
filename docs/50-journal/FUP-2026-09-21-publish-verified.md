# FUP · 2026-09-21 · The publish path has been run, and it works

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the first of the two W00 close-out items: *"Re-run publish once this is on `main`: `v0.0.1`
as pushed pointed at a commit whose build could not run, so the tag exists and the images do not.
Re-point it, or cut the next tag, and confirm the digest lands."*

W00 set the standard and then failed to meet it for this one path: *"Every other gate here was
**watched fail** before it was trusted … publish did not meet it."* It has now been run, and the
`kubernetes` buildx driver the close-out added is what made it work.

## What was done

- **`publish.yml` dispatched on `main`** and watched to completion. Both matrix jobs green:
  `prisme-api` in 3m12s and `prisme-web` in 3m21s, with SBOM and provenance attestation emitted.
- **Both digests read back** from the run rather than assumed from a green tick:

| Image | Digest |
|---|---|
| `prisme-api` | `sha256:4434a824…94b45b4` |
| `prisme-web` | `sha256:06699faf…05872a2` |

- **The tag published was `main`**, and that is the one thing about this run worth arguing with —
  see below.

## Decisions taken

**`workflow_dispatch` on `main`, rather than re-pointing `v0.0.1` or cutting a new tag.** The
close-out offers two endings — "re-point it, or cut the next tag" — and this is neither, deliberately.
Re-pointing `v0.0.1` would have rebuilt a commit that predates every workstream, so the images would
carry a skeleton under a tag that promises one; cutting `v0.0.2` is a *release decision* about what
the project's first meaningful version is, and that is a human's to make, not a follow-up's. A
dispatch verifies the pipeline and lands images without deciding a version.

**The `kubernetes` driver is what the run proves.** The first publish, on `v0.0.1`, died at
`setup-buildx` with `connect: no such file or directory` — the runner is a pod in the cluster with no
Docker socket, which no check in this repository could have found (`images.yml` builds the same
Dockerfiles successfully on a hosted runner). Both jobs now reach BuildKit running as pods in the
cluster and push. That is the fix working, observed rather than reasoned about.

## Surprises

**A repository *variable* is not masked in a workflow log, and this repository is public.**
`publish.yml` reads the registry host from `vars.HARBOR_REGISTRY`, and the build step logs the full
`--tag` it pushes to — so a successful run writes the registry host, the project name and both image
tags into a **publicly readable** Actions log. The first run never got that far (it failed at
`setup-buildx`), so this is new, and it arrived with my run rather than with anyone's change.

It is recorded here rather than fixed here, and it is **not** written into this entry: the host is
infrastructure detail that [`17-privacy.md`](../17-privacy.md) keeps out of the repository, and a
journal entry is part of the repository. What it exposes is a hostname on a private network, not a
credential — the blast radius is small and the fix is a decision (mask the value, move it to a
secret, or accept it) rather than a patch. It is a human's call which, and it is on the pull
request.

**Two jobs sharing one build means the two images are the same build.** `prisme-api` and
`prisme-sync` are one Dockerfile and one matrix row, which is what `15-runtime.md` §1 says and what
`images.yml` asserts as a digest equality. Publish does not assert the same thing — it has one row
for `prisme-api` and relies on the CronJob running the same image with a different command. Worth
knowing when reading the run: there are two jobs, not three, and that is the design.

## The tag, stated plainly

The images are tagged `main`. That is what a dispatch on `main` produces — `github.ref_name` is the
tag — and it sits awkwardly beside `publish.yml`'s own header, which says *"what runs in the cluster
should be a deliberate, named version rather than whatever merged last"*. No manifest references
prisme yet (`STATUS.md`'s deployment follow-up is open), so nothing consumes `:main` and the next
real tag will produce properly-named images beside it. But an operator reading the registry sees a
tag the workflow's own comment argues against, and that is worth a sentence rather than silence.

**The published code is `main` as of the dispatch**, which is *after* the first follow-up landed and
*before* the other six. A later tag will carry the whole wave.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The registry host in a public Actions log | See *Surprises*. A hostname on a private network, not a credential, but it is in the repository's public output | the human |
| `v0.0.1`'s images still do not exist | The tag points at a commit whose build could not run, and this run did not re-point it. Either delete the tag or accept that it names nothing | the human |
| `CI_RUNNER` is still unset | The default resolved to a real runner, which this run proves again. If the scale set is renamed, a publish queues forever rather than failing | the human, with the deployment repository |
| Nothing consumes the images yet | No manifests, no pull secret, no migration Job, no backup CronJob in the deployment repository | the human, deployment side |

## Checks

This is a documentation change: a journal entry, an index row and a `STATUS.md` row. The same checks
as any pull request apply and the rollup on the pull request carries them. Locally:
`./scripts/privacy-scan.sh` clean — which is the check that matters most here, because this entry
discusses infrastructure.

**The evidence, read back from the run rather than inferred:** the run's conclusion, both job
conclusions, both image digests and the tag are recorded above. The run URL is on the pull request;
it reaches GitHub and nothing else.

## Privacy

No registry host, project name, namespace, runner label or cluster detail appears in this entry or
in the diff — which is the only reason it took a paragraph to say what it says under *Surprises*.
The digests identify public-package-derived images and carry no instance data. The deny-list and
secret scans are green.
