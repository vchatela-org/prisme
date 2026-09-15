# seed.example

**The format of the instance data that lives in `seed/` — which is gitignored and never committed.**

`seed/` holds everything that describes a specific person's setup: their areas, their weights, the
mapping from their tool structure to prisme's model, and the identifiers of their external
databases. None of it belongs in a public repository
([`../docs/17-privacy.md`](../docs/17-privacy.md)).

This directory documents the **shape** so that anyone — including a future you — can build a `seed/`
without reverse-engineering the loader. The values here are invented.

## Setting up

```bash
cp -r seed.example seed      # seed/ is gitignored
$EDITOR seed/*.json          # fill in the real values
pnpm seed:load               # loads into PostgreSQL
```

Confirm it never becomes tracked:

```bash
git check-ignore -v seed/areas.json     # must report a .gitignore match
git ls-files seed/                      # must print nothing
```

## Files

| File | Contents |
|---|---|
| `areas.json` | The real area list, and weights per year |
| `bindings.json` | Role key → external database ID, and area → project/section mapping |

## Why bindings are data, not configuration in git

prisme addresses external databases by **role key** — `objectives_db`, `takeaways_db`, `media_db`,
`areas_db`, `processes_db`, `reviews_db` — and resolves them here.

This is a privacy measure, but it is also better engineering: the application works against any
workspace rather than one, and the connector code contains no reference to a particular setup. Tests
bind the same roles to fixtures.

## The area mapping is what avoids restructuring anything

`areaMappings` is many-to-one: several projects and sections may point at the same area key. That is
how several disagreeing lists of "areas" across two tools fold into one canonical list **without
moving anything in either tool**.

Restructuring the external tools later is optional, and does not change the model — see OQ-3 in
[`../docs/20-decisions/OPEN.md`](../docs/20-decisions/OPEN.md).

## Secrets do not live here

API tokens arrive as environment variables or mounted files from the deployment's secret store
([`../docs/15-runtime.md`](../docs/15-runtime.md)). `seed/` holds configuration, never credentials.
