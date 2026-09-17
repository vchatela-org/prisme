import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, relativeLuminance } from './contrast.js';
import { colorTokens, TEXT_CONTRAST_FLOORS, type ThemeMode } from './tokens.js';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from './palette.js';

const MODES: readonly ThemeMode[] = ['light', 'dark'];

/** Both surfaces a token can land on. A component may sit on either. */
function surfaces(mode: ThemeMode): ReadonlyArray<readonly [string, string]> {
  return [
    ['surface-page', colorTokens['surface-page'][mode]],
    ['surface-raised', colorTokens['surface-raised'][mode]],
  ];
}

describe('contrast arithmetic', () => {
  it('reproduces the WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The canonical worked example from the WCAG techniques.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('is symmetric — order of arguments cannot change a verdict', () => {
    expect(contrastRatio('#2a78d6', '#fcfcfb')).toBeCloseTo(contrastRatio('#fcfcfb', '#2a78d6'), 9);
  });

  it('parses both notations the palette uses', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#2a78d6')).toEqual({ r: 42, g: 120, b: 214, a: 1 });
    expect(parseColor('rgba(11, 11, 11, 0.10)')).toEqual({ r: 11, g: 11, b: 11, a: 0.1 });
  });

  it('refuses a notation it cannot evaluate rather than guessing', () => {
    expect(() => parseColor('oklch(0.6 0.2 250)')).toThrow(/Unsupported/);
    expect(() => parseColor('hotpink')).toThrow(/Unsupported/);
  });

  it('composites a translucent colour before judging it', () => {
    // The hairline border is ink at 10%: against white it is nowhere near ink.
    const ratio = contrastRatio('rgba(11, 11, 11, 0.10)', '#ffffff');
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.3);
  });

  it('will not pretend to measure against a background you can see through', () => {
    expect(() => contrastRatio('#000000', 'rgba(11, 11, 11, 0.10)')).toThrow(/opaque/);
  });

  it('orders luminance the way eyes do', () => {
    expect(relativeLuminance(parseColor('#ffffff'))).toBeGreaterThan(
      relativeLuminance(parseColor('#808080')),
    );
    expect(relativeLuminance(parseColor('#808080'))).toBeGreaterThan(
      relativeLuminance(parseColor('#000000')),
    );
  });
});

describe('every text token, on every surface, in both themes', () => {
  for (const mode of MODES) {
    for (const [role, floor] of Object.entries(TEXT_CONTRAST_FLOORS)) {
      for (const [surfaceName, surface] of surfaces(mode)) {
        it(`${role} on ${surfaceName} (${mode}) clears ${floor}:1`, () => {
          const token = colorTokens[role as keyof typeof colorTokens];
          expect(contrastRatio(token[mode], surface)).toBeGreaterThanOrEqual(floor);
        });
      }
    }
  }
});

describe('interactive chrome', () => {
  for (const mode of MODES) {
    for (const [surfaceName, surface] of surfaces(mode)) {
      it(`the focus ring is visible against ${surfaceName} (${mode})`, () => {
        // WCAG 2.2 non-text contrast: a focus indicator is a graphical object.
        expect(contrastRatio(colorTokens.focus[mode], surface)).toBeGreaterThanOrEqual(3);
      });

      it(`the solid accent is a visible fill on ${surfaceName} (${mode})`, () => {
        expect(contrastRatio(colorTokens['accent-solid'][mode], surface)).toBeGreaterThanOrEqual(3);
      });
    }

    it(`the solid accent carries its label (${mode})`, () => {
      expect(
        contrastRatio(colorTokens['ink-on-accent'][mode], colorTokens['accent-solid'][mode]),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`gridlines stay recessive against the chart surface (${mode})`, () => {
      const surface = colorTokens['surface-raised'][mode];
      const grid = contrastRatio(colorTokens['chart-gridline'][mode], surface);
      const baseline = contrastRatio(colorTokens['chart-baseline'][mode], surface);
      const text = contrastRatio(colorTokens['ink-secondary'][mode], surface);

      expect(grid).toBeLessThan(baseline);
      expect(baseline).toBeLessThan(text);
    });
  }
});

describe('the categorical slots against the surface they are drawn on', () => {
  /**
   * The light surface leaves three slots below 3:1. That is a documented WARN
   * from the skill's validator, not an accident, and the relief is that every
   * component painting an area colour also shows its name. This test pins the
   * set: a palette change that pushes a fourth slot under the line has to come
   * with a decision about it, rather than sliding through.
   */
  const EXPECTED_RELIEF_SLOTS_LIGHT = [3, 4, 5];

  it('light — exactly the three documented slots need the relief rule', () => {
    const surface = colorTokens['surface-raised'].light;
    const below = CATEGORICAL_LIGHT.map((hex, i) => [i + 1, contrastRatio(hex, surface)] as const)
      .filter(([, ratio]) => ratio < 3)
      .map(([slot]) => slot);

    expect(below).toEqual(EXPECTED_RELIEF_SLOTS_LIGHT);
  });

  it('dark — every slot clears 3:1 unaided', () => {
    const surface = colorTokens['surface-raised'].dark;
    for (const [i, hex] of CATEGORICAL_DARK.entries()) {
      expect(contrastRatio(hex, surface), `slot ${i + 1}`).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The reason there is no in-fill label anywhere in this package: in light
   * mode no ink clears AA on the slot-1 blue — 4.46:1 at best. The dark step
   * would carry one comfortably, which is exactly the trap: a component is
   * only finished when it works in *both* themes, so one failing mode forbids
   * the pattern everywhere. Values live outside the mark and in the table view
   * instead.
   */
  it('light — no ink clears AA inside the slot-1 fill', () => {
    const fill = CATEGORICAL_LIGHT[0];
    const best = Math.max(
      contrastRatio('#ffffff', fill),
      contrastRatio(colorTokens['ink'].light, fill),
    );
    expect(best).toBeLessThan(4.5);
  });
});

describe('the status palette', () => {
  /**
   * `warning` and `serious` sit below 3:1 on the light surface *by design* —
   * the skill's mitigation is that a status is never colour alone. `StatusIcon`
   * enforces the pairing; this test records which two rely on it.
   */
  it('good and critical stand alone; warning and serious depend on the icon and label', () => {
    const surface = colorTokens['surface-raised'].light;
    expect(contrastRatio(colorTokens['status-good'].light, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colorTokens['status-critical'].light, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colorTokens['status-warning'].light, surface)).toBeLessThan(3);
    expect(contrastRatio(colorTokens['status-serious'].light, surface)).toBeLessThan(3);
  });

  it('all four clear 3:1 on the dark surface', () => {
    const surface = colorTokens['surface-raised'].dark;
    for (const role of [
      'status-good',
      'status-warning',
      'status-serious',
      'status-critical',
    ] as const) {
      expect(contrastRatio(colorTokens[role].dark, surface), role).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the token table itself', () => {
  it('names a value for both themes, for every token', () => {
    for (const [name, token] of Object.entries(colorTokens)) {
      expect(token.light, `${name}.light`).toBeTruthy();
      expect(token.dark, `${name}.dark`).toBeTruthy();
      expect(() => parseColor(token.light)).not.toThrow();
      expect(() => parseColor(token.dark)).not.toThrow();
    }
  });
});
