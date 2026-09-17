/**
 * Semantic tokens: the names the rest of the system is allowed to use.
 *
 * A component never asks for "blue". It asks for `accent`, `ink-secondary` or
 * `status-critical`, and the theme decides what that is in each mode. Two
 * consequences worth stating, because both are load-bearing:
 *
 *  1. Dark mode is *selected*, not derived. Every token names both values, so
 *     nobody ever ships a component that works in one theme only.
 *  2. There is exactly one place to change a colour, and
 *     `no-raw-colour.test.ts` fails the build if a second one appears.
 */

import {
  CATEGORICAL_DARK,
  CATEGORICAL_LIGHT,
  CHROME,
  SEQUENTIAL_BLUE,
  SHADOW,
  STATUS,
} from './palette.js';

export type ThemeMode = 'light' | 'dark';

/** A colour that is chosen per mode. */
export interface ColorToken {
  readonly light: string;
  readonly dark: string;
}

const both = (value: string): ColorToken => ({ light: value, dark: value });

/**
 * Surfaces, ink, lines and state colour.
 *
 * `surface-raised` doubles as the chart surface: the validator was run against
 * exactly these two values, so a chart drawn on any other background is a
 * chart whose contrast results no longer hold.
 */
export const colorTokens = {
  'surface-page': { light: CHROME.pagePlaneLight, dark: CHROME.pagePlaneDark },
  'surface-raised': { light: CHROME.chartSurfaceLight, dark: CHROME.chartSurfaceDark },
  'surface-overlay': { light: CHROME.chartSurfaceLight, dark: CHROME.chartSurfaceDark },

  ink: { light: CHROME.inkPrimaryLight, dark: CHROME.inkPrimaryDark },
  'ink-secondary': { light: CHROME.inkSecondaryLight, dark: CHROME.inkSecondaryDark },
  // Decoration and placeholders only — never an axis tick, never a value.
  // It clears 3:1, not 4.5:1, on the light surface.
  'ink-muted': both(CHROME.inkMuted),
  'ink-success': { light: CHROME.successTextLight, dark: CHROME.successTextDark },

  'border-hairline': { light: CHROME.borderLight, dark: CHROME.borderDark },
  'border-strong': { light: CHROME.baselineLight, dark: CHROME.baselineDark },

  'chart-gridline': { light: CHROME.gridlineLight, dark: CHROME.gridlineDark },
  'chart-baseline': { light: CHROME.baselineLight, dark: CHROME.baselineDark },
  'chart-neutral': { light: CHROME.neutralMidpointLight, dark: CHROME.neutralMidpointDark },

  // The accent is categorical slot 1, so the one colour a reader sees most is
  // the same colour the charts start from. It is a *mark* colour: it paints
  // lines, rings and 2px indicators on the surface.
  accent: { light: CATEGORICAL_LIGHT[0], dark: CATEGORICAL_DARK[0] },
  focus: { light: CATEGORICAL_LIGHT[0], dark: CATEGORICAL_DARK[0] },

  /**
   * The accent as a *fill behind text* — a primary button, a selected row.
   *
   * It is a different step from `accent` on purpose, and the reason is a
   * measurement rather than a preference: white on the slot-1 blue is 4.42:1,
   * which misses AA for body text by a hair. A mark colour is tuned to sit on
   * the surface, not to carry a label. The contrast test caught this, and
   * these two steps clear it in both directions — 5.39:1 light, 5.41:1 dark,
   * with the fill itself ≥3:1 against both surfaces so the button's edge is
   * visible too.
   */
  'accent-solid': { light: SEQUENTIAL_BLUE[500], dark: CATEGORICAL_DARK[0] },
  'ink-on-accent': { light: CHROME.inkPrimaryDark, dark: CHROME.inkPrimaryLight },

  'status-good': both(STATUS.good),
  'status-warning': both(STATUS.warning),
  'status-serious': both(STATUS.serious),
  'status-critical': both(STATUS.critical),

  /**
   * Lanes — Run and Signals — are context, not identity. They wear the
   * de-emphasis neutral so that on a capacity chart the six areas carry the
   * hue and upkeep stays legible without competing (ADR-0014: lanes count
   * toward capacity, never toward ranking).
   */
  lane: both(CHROME.inkMuted),

  'series-1': { light: CATEGORICAL_LIGHT[0], dark: CATEGORICAL_DARK[0] },
  'series-2': { light: CATEGORICAL_LIGHT[1], dark: CATEGORICAL_DARK[1] },
  'series-3': { light: CATEGORICAL_LIGHT[2], dark: CATEGORICAL_DARK[2] },
  'series-4': { light: CATEGORICAL_LIGHT[3], dark: CATEGORICAL_DARK[3] },
  'series-5': { light: CATEGORICAL_LIGHT[4], dark: CATEGORICAL_DARK[4] },
  'series-6': { light: CATEGORICAL_LIGHT[5], dark: CATEGORICAL_DARK[5] },
  'series-7': { light: CATEGORICAL_LIGHT[6], dark: CATEGORICAL_DARK[6] },
  'series-8': { light: CATEGORICAL_LIGHT[7], dark: CATEGORICAL_DARK[7] },
} as const satisfies Record<string, ColorToken>;

export type ColorTokenName = keyof typeof colorTokens;

/** Text roles, and the WCAG ratio each one promises against both surfaces. */
export const TEXT_CONTRAST_FLOORS = {
  ink: 7,
  'ink-secondary': 4.5,
  'ink-muted': 3,
  'ink-success': 4.5,
} as const satisfies Partial<Record<ColorTokenName, number>>;

export const shadowTokens = {
  raised: { light: SHADOW.raisedLight, dark: SHADOW.raisedDark },
  overlay: { light: SHADOW.overlayLight, dark: SHADOW.overlayDark },
} as const satisfies Record<string, ColorToken>;

/**
 * A 4px base step. Every gap, pad and inset in the system is one of these —
 * "looks about right" is how two screens end up 2px apart.
 */
export const spaceTokens = {
  '0': '0px',
  px: '1px',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
} as const;

export const radiusTokens = {
  none: '0px',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  full: '9999px',
} as const;

/**
 * One sans, everywhere, including the hero figure — a display face on a big
 * number reads as decoration. `tabular-nums` is opt-in per component and
 * belongs only where digits must line up vertically.
 */
export const typeTokens = {
  'font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  'text-hero': '3rem',
  'text-2xl': '1.5rem',
  'text-xl': '1.25rem',
  'text-lg': '1.125rem',
  'text-base': '1rem',
  'text-sm': '0.875rem',
  'text-xs': '0.75rem',
  'leading-tight': '1.2',
  'leading-normal': '1.5',
  'weight-regular': '400',
  'weight-medium': '500',
  'weight-semibold': '600',
} as const;

/**
 * Motion is short and near-linear. Anything longer than 200ms in an
 * information tool reads as lag rather than polish, and every duration here is
 * disabled outright under `prefers-reduced-motion`.
 */
export const motionTokens = {
  'duration-instant': '80ms',
  'duration-fast': '120ms',
  'duration-normal': '200ms',
  'ease-standard': 'cubic-bezier(0.2, 0, 0.13, 1)',
  'ease-exit': 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** Every scalar token group, in the order the stylesheet emits them. */
export const scalarTokenGroups = {
  space: spaceTokens,
  radius: radiusTokens,
  type: typeTokens,
  motion: motionTokens,
} as const;
