/**
 * WCAG contrast, computed rather than eyeballed.
 *
 * This exists so "checked in both themes" is a test that fails, not a claim in
 * a pull request body. It is pure arithmetic over the token table: no DOM, no
 * canvas, no rendering — which is why it can run in the repository's ordinary
 * node test environment alongside the domain tests.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–1. Translucent colours must be composited before they mean anything. */
  readonly a: number;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i;

/** Parses the two notations the palette uses. Throws on anything else. */
export function parseColor(value: string): Rgb {
  if (HEX.test(value)) {
    const hex = value.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const match = RGBA.exec(value);
  if (match) {
    const [, r, g, b, a] = match;
    return {
      r: Number(r),
      g: Number(g),
      b: Number(b),
      a: a === undefined ? 1 : Number(a),
    };
  }

  throw new Error(`Unsupported colour notation: ${value}`);
}

/** Flattens a translucent colour onto an opaque one. */
export function composite(front: Rgb, back: Rgb): Rgb {
  return {
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * WCAG 2.1 contrast ratio, 1–21. Either argument may be translucent; both are
 * composited onto `surface` first, because contrast against a colour you can
 * see through is not a number.
 */
export function contrastRatio(foreground: string, background: string): number {
  const back = parseColor(background);
  if (back.a !== 1) {
    throw new Error(`The background must be opaque, got ${background}`);
  }
  const front = composite(parseColor(foreground), back);

  const lf = relativeLuminance(front);
  const lb = relativeLuminance(back);
  const [lighter, darker] = lf > lb ? [lf, lb] : [lb, lf];
  return (lighter + 0.05) / (darker + 0.05);
}

/*
 * There is deliberately no `inkOnFill` helper here.
 *
 * The obvious one — pick white or ink by the fill's luminance — was written,
 * tested, and deleted: measured against the eight categorical slots, the best
 * available ink on the slot-1 blue reaches only 4.46:1, so a label set inside
 * a mark misses AA for body text no matter which ink it picks. Rather than
 * ship a helper whose output is *usually* legible, the system places values
 * outside the mark (the bar's tip, the column's cap, the line's end) and keeps
 * every value reachable in the chart's table view. The skill permits an
 * in-fill label; the palette does not earn it.
 */
