/**
 * `@prisme/ui` — the design system, and the app shell everything sits in.
 *
 * Built in wave 1 so waves 3–5 are composition rather than invention. Four UI
 * workstreams run in parallel later; if each invents its own table, chart and
 * spacing, the result looks assembled rather than designed, and the merge
 * conflicts are worse than the inconsistency.
 *
 * Four rules hold this together, and each one is enforced by something other
 * than good intentions:
 *
 *  1. **Colour lives in `tokens/palette.ts` and nowhere else.**
 *     `tokens/no-raw-colour.test.ts` walks `packages/ui` and `apps/web` and
 *     fails on a second home for it.
 *  2. **Both themes, both measured.** Every token names a light value and a
 *     dark one, and `tokens/contrast.test.ts` checks each against the surfaces
 *     it can land on.
 *  3. **Area colour comes from the area key**, never from list position —
 *     `tokens/area-color.ts`.
 *  4. **Charts handle their own awkward states.** Empty, loading, error, one
 *     data point and a short history are the frame's job, not the call site's.
 *
 * The gallery route in `apps/web` renders everything here with fixture data.
 * Look there before building a component: it is how four parallel agents avoid
 * writing four tables.
 */

// Domain types the components take, re-exported so a consumer does not have
// to depend on @prisme/domain to name a prop.
export type { Fibonacci, InitiativeStatus } from '@prisme/domain';

// Tokens
export * from './tokens/palette.js';
export * from './tokens/tokens.js';
export * from './tokens/contrast.js';
export * from './tokens/theme-css.js';
export * from './tokens/area-color.js';

// Utilities
export * from './lib/cn.js';
export * from './lib/focus.js';
export * from './lib/command-score.js';
export * from './lib/relative-time.js';

// Primitives
export * from './primitives/badge.js';
export * from './primitives/button.js';
export * from './primitives/combobox.js';
export * from './primitives/command.js';
export * from './primitives/dialog.js';
export * from './primitives/input.js';
export * from './primitives/popover.js';
export * from './primitives/select.js';
export * from './primitives/skeleton.js';
export * from './primitives/states.js';
export * from './primitives/tabs.js';
export * from './primitives/toast.js';
export * from './primitives/tooltip.js';

// Domain components
export * from './domain/area-badge.js';
export * from './domain/area-color-context.js';
export * from './domain/balance-meter.js';
export * from './domain/balance-meter-core.js';
export * from './domain/data-table.js';
export * from './domain/data-table-core.js';
export * from './domain/fibonacci-select.js';
export * from './domain/score-pill.js';
export * from './domain/status-chip.js';
export * from './domain/sync-status.js';

// Charts
export * from './charts/bar-chart.js';
export * from './charts/chart-frame.js';
export * from './charts/chart-scale.js';
export * from './charts/line-chart.js';
export * from './charts/series.js';
export * from './charts/stat-tile.js';

// Shell
export * from './shell/app-shell.js';
export * from './shell/banner.js';
export * from './shell/breadcrumbs.js';
export * from './shell/command-palette.js';
export * from './shell/theme.js';
export * from './shell/theme-preference.js';
