/**
 * `@prisme/ui/server` — everything in this package that is **not** a component.
 *
 * ## Why this entry point exists
 *
 * The main barrel re-exports React components, and many of those files start
 * with `'use client'`. Importing anything through that barrel from a server
 * component therefore drags it across the client boundary, and Next refuses
 * with "attempted to call it from the server" — even for a plain function like
 * `parseThemePreference`, which has nothing to do with React.
 *
 * That failure appears at **request time**: the type checker is happy, the
 * build is happy, and the page 500s when someone loads it. It is exactly the
 * class of bug that only surfaces if the application is actually run, which is
 * why the gallery gets started and opened rather than merely built.
 *
 * So: tokens, contrast arithmetic, area colour, chart geometry, sorting,
 * scoring of typed queries and the theme cookie live here, importable from a
 * server component, a route handler, or a test — with no React in sight.
 */

export * from './tokens/palette.js';
export * from './tokens/tokens.js';
export * from './tokens/contrast.js';
export * from './tokens/theme-css.js';
export * from './tokens/area-color.js';

export * from './lib/cn.js';
export * from './lib/focus.js';
export * from './lib/command-score.js';
export * from './lib/relative-time.js';

export * from './domain/balance-meter-core.js';
export * from './domain/data-table-core.js';

export * from './charts/chart-scale.js';
export * from './charts/series.js';

export * from './shell/theme-preference.js';
