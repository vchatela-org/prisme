/**
 * How a chart's numbers are written, as a **value** rather than a function.
 *
 * ## Why this exists
 *
 * Every chart in this package is a client component, and `format` on
 * `<LineChart>` and `<BarChart>` is a function prop. A function cannot cross
 * the server/client boundary: React refuses it at render time with
 * *"Functions cannot be passed directly to Client Components"*. So a **server**
 * component — which is what every screen in `apps/web` is, by convention — can
 * render these charts only with the default formatting, or not at all.
 *
 * Nothing catches that before a request. It typechecks, `next build` emits the
 * route, and the page 500s the first time somebody opens it. W09 found it by
 * opening the KPI dashboard; W10 and W11 would each have found it again.
 *
 * `formatAs` is the same instruction expressed as data, so it serialises. The
 * function prop stays exactly as it was for callers that are already client
 * components — the gallery is one — and this is the door for everyone else.
 *
 * ## Why an enum and not a format string
 *
 * A format string ("0.0'%'") is a small language, and a small language in a
 * design system is a thing every call site spells slightly differently. Four
 * kinds cover every chart in the product, and a fifth is a deliberate addition
 * rather than a punctuation choice made once at a call site.
 */

export type ValueFormatKind =
  /** A plain count or score. */
  | 'number'
  /** A share, suffixed `%`. The value is already 0–100, not 0–1. */
  | 'percent'
  /** Hours, suffixed `h`. */
  | 'hours'
  /** Minutes rendered as hours, suffixed `h` — the axis a duration wants. */
  | 'minutes-as-hours';

export interface ValueFormat {
  readonly kind: ValueFormatKind;
  /** Decimal places. Defaults to 0 for counts and shares, 1 for durations. */
  readonly decimals?: number;
}

const DEFAULT_DECIMALS: Record<ValueFormatKind, number> = {
  number: 0,
  percent: 0,
  hours: 1,
  'minutes-as-hours': 1,
};

/** Render one value according to a descriptor. */
export function formatValue(value: number, format: ValueFormat): string {
  const decimals = format.decimals ?? DEFAULT_DECIMALS[format.kind];

  switch (format.kind) {
    case 'percent':
      return `${value.toFixed(decimals)}%`;
    case 'hours':
      return `${value.toFixed(decimals)}h`;
    case 'minutes-as-hours':
      return `${(value / 60).toFixed(decimals)}h`;
    case 'number':
      return value.toFixed(decimals);
  }
}

/**
 * The formatter a chart actually uses.
 *
 * `format` wins when both are given: a caller that can pass a function has
 * said something more specific than a caller that can only pass a descriptor,
 * and silently preferring the descriptor would make the function prop look
 * broken rather than overridden.
 */
export function resolveFormat(
  format: ((value: number) => string) | undefined,
  formatAs: ValueFormat | undefined,
): (value: number) => string {
  if (format !== undefined) return format;
  if (formatAs !== undefined) return (value) => formatValue(value, formatAs);
  return (value) => value.toFixed(1);
}
