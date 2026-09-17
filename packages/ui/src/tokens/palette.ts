/**
 * The raw palette. **The only file in the monorepo that may contain a colour
 * literal.** Everything else — components, charts, the web app — reads a
 * semantic token from `tokens.ts`, which is built out of these values.
 *
 * The values are the validated default palette of the `dataviz` skill, adopted
 * wholesale rather than invented. That matters more than it looks: the eight
 * categorical hues and their *order* are a colour-vision-deficiency safety
 * mechanism, not a mood. They were re-validated for this repository with the
 * skill's own validator, in both modes, and the run is recorded in
 * `docs/50-journal/W07-2026-09-16-design-system.md`:
 *
 *   light — lightness band PASS · chroma floor PASS · CVD ΔE 9.1 PASS ·
 *           normal-vision ΔE 19.6 PASS · contrast WARN on three slots
 *   dark  — every check PASS
 *
 * The light-mode WARN is the reason `<AreaBadge>`, the bar chart and the
 * balance meter all carry a visible text label: three light steps sit below
 * 3:1 against the light surface, and the skill's relief rule makes a label or
 * a table view mandatory rather than optional. A future component that paints
 * an area colour with no label beside it is a regression, not a shortcut.
 *
 * Re-run before changing anything here:
 *   node scripts/validate_palette.js "<the eight light hexes>" --mode light
 *   node scripts/validate_palette.js "<the eight dark hexes>" --mode dark --surface "#1a1a19"
 */

/**
 * Categorical identity, light mode. Fixed order — never re-order, never cycle
 * past eight, never generate a ninth.
 */
export const CATEGORICAL_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const;

/** The same eight hues, stepped for the dark surface. Not an automatic flip. */
export const CATEGORICAL_DARK = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const;

export const CATEGORICAL_SLOT_COUNT = CATEGORICAL_LIGHT.length;

/**
 * Sequential magnitude: one hue, light → dark. Mode-invariant steps; the two
 * modes differ in which end anchors "near zero", not in the hexes.
 */
export const SEQUENTIAL_BLUE = {
  100: '#cde2fb',
  150: '#b7d3f6',
  200: '#9ec5f4',
  250: '#86b6ef',
  300: '#6da7ec',
  350: '#5598e7',
  400: '#3987e5',
  450: '#2a78d6',
  500: '#256abf',
  550: '#1c5cab',
  600: '#184f95',
  650: '#104281',
  700: '#0d366b',
} as const;

/**
 * Status. Fixed, never themed, never reused as "series 9". Always shipped with
 * an icon and a label — on the light surface `warning` and `serious` are
 * deliberately below 3:1, and the pairing is the mitigation.
 */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Chart chrome and ink. */
export const CHROME = {
  chartSurfaceLight: '#fcfcfb',
  chartSurfaceDark: '#1a1a19',
  pagePlaneLight: '#f9f9f7',
  pagePlaneDark: '#0d0d0d',
  inkPrimaryLight: '#0b0b0b',
  inkPrimaryDark: '#ffffff',
  inkSecondaryLight: '#52514e',
  inkSecondaryDark: '#c3c2b7',
  inkMuted: '#898781',
  gridlineLight: '#e1e0d9',
  gridlineDark: '#2c2c2a',
  baselineLight: '#c3c2b7',
  baselineDark: '#383835',
  successTextLight: '#006300',
  successTextDark: '#0ca30c',
  borderLight: 'rgba(11, 11, 11, 0.10)',
  borderDark: 'rgba(255, 255, 255, 0.10)',
  neutralMidpointLight: '#f0efec',
  neutralMidpointDark: '#383835',
} as const;

/**
 * Elevation. Shadows are ink at low alpha rather than gray, so a raised
 * surface darkens what is under it instead of tinting it.
 */
export const SHADOW = {
  raisedLight: '0 1px 2px rgba(11, 11, 11, 0.06), 0 1px 1px rgba(11, 11, 11, 0.04)',
  raisedDark: '0 1px 2px rgba(0, 0, 0, 0.50), 0 1px 1px rgba(0, 0, 0, 0.40)',
  overlayLight: '0 10px 30px rgba(11, 11, 11, 0.12), 0 2px 8px rgba(11, 11, 11, 0.08)',
  overlayDark: '0 10px 30px rgba(0, 0, 0, 0.60), 0 2px 8px rgba(0, 0, 0, 0.45)',
} as const;
