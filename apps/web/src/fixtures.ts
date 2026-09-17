/**
 * The synthetic dataset, typed.
 *
 * `fixtures/` is the **only** data permitted in this repository's screens,
 * tests and examples (docs/17-privacy.md). The gallery reads from here so that
 * nobody ever needs to point a demo at a real instance to make it look
 * convincing — which is the exact moment a real goal ends up in a public
 * screenshot.
 *
 * The JSON is imported rather than fetched, so a missing or renamed field is a
 * type error at build time instead of an empty screen at runtime.
 */

import areasJson from '../../../fixtures/areas.json';
import initiativesJson from '../../../fixtures/initiatives.json';
import goldenJson from '../../../fixtures/scoring/wsjf-balanced.golden.json';

export interface FixtureArea {
  key: string;
  name: string;
  kind: 'area' | 'run' | 'signals';
}

export interface FixtureAreaWindow {
  key: string;
  targetPct: number;
  observedSharePct: number;
}

export interface FixtureInitiative {
  id: string;
  title: string;
  areaKey: string;
  status: 'inbox' | 'later' | 'next' | 'now' | 'waiting' | 'review' | 'done' | 'dropped';
  value: number;
  timeCriticality: number;
  risk: number;
  size: number;
  deadline: string | null;
}

export const fixtureAreas: FixtureArea[] = areasJson.areas.map((area) => ({
  key: area.key,
  name: area.name,
  kind: (area.kind ?? 'area') as FixtureArea['kind'],
}));

export const fixtureWeights2026: Record<string, number> = Object.fromEntries(
  areasJson.areaWeights
    .filter((weight) => weight.year === 2026)
    .map((weight) => [weight.areaKey, weight.weightPct]),
);

/**
 * The four-week window the worked example in `docs/12-scoring.md` uses. A lane
 * has no target share, which is why `targetPct` falls back to zero rather than
 * to something invented.
 */
export const fixtureWindow: FixtureAreaWindow[] = areasJson.areaContext2026W37.areas.map(
  (area) => ({
    key: area.key,
    targetPct: 'targetPct' in area ? area.targetPct : 0,
    observedSharePct: area.observedSharePct,
  }),
);

export const fixtureInitiatives: FixtureInitiative[] = initiativesJson.initiatives.map(
  (initiative) => ({
    id: initiative.id,
    title: initiative.title,
    areaKey: initiative.areaKey,
    status: initiative.status as FixtureInitiative['status'],
    value: initiative.value,
    timeCriticality: initiative.timeCriticality,
    risk: initiative.risk,
    size: initiative.size,
    deadline: initiative.deadline,
  }),
);

/** Scores straight from the golden file — never recomputed in the browser. */
export const fixtureScores: Record<string, { score: number; factors: Record<string, number> }> =
  Object.fromEntries(
    goldenJson.cases.map((one) => [
      one.id,
      {
        score: one.out.score,
        factors: {
          cod: one.out.cod,
          wsjf: one.out.wsjf,
          size: one.in.size,
          balanceFactor: one.in.balanceFactor,
        },
      },
    ]),
  );

export const fixtureMethod = `${goldenJson.method.id} v${String(goldenJson.method.version)}`;

/**
 * The area→slot pinning for the fixture set.
 *
 * Six areas hashed into eight palette slots collide (see
 * `packages/ui/src/tokens/area-color.ts`), so the fixture areas are pinned in
 * order. A real instance keeps its own map in configuration — these keys are
 * invented, and only invented keys belong in git.
 */
export const fixtureAreaColors = {
  health: 1,
  relationships: 2,
  craft: 3,
  money: 4,
  home: 5,
  community: 6,
} as const;
