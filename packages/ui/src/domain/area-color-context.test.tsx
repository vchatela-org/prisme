import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { areaColorSlot, colorSlotClass, type SeriesSlot } from '../tokens/area-color.js';
import { AreaBadge } from './area-badge.js';
import { AreaColorProvider } from './area-color-context.js';

/**
 * **The pinning map actually reaches the mark.**
 *
 * `areaColor.ts`'s own tests cover the derivation; this covers the wiring, and
 * the wiring is where the defect was. W09 recorded it: `AreaColorProvider`
 * existed, `packages/ui` exported it, and **nothing outside the gallery mounted
 * it** — so two areas that hash into the same palette slot rendered in the same
 * colour on every screen of every instance, and no test could see it because
 * every test asked the derivation a question the derivation answers correctly.
 *
 * `health` and `money` collide at slot 8. That is the birthday problem rather
 * than a bad hash — six keys into eight slots collides most of the time — which
 * is why the palette has an override table at all. These assertions are written
 * so that they fail if the provider stops being honoured, not if the hash
 * changes: the collision is *asserted* rather than assumed, and then resolved.
 */
const COLLIDING = ['health', 'money'] as const;

function render(overrides?: Readonly<Record<string, SeriesSlot>>): string {
  const badge = <AreaBadge areaKey="health" name="Health" />;
  return renderToStaticMarkup(
    overrides === undefined ? (
      badge
    ) : (
      <AreaColorProvider overrides={overrides}>{badge}</AreaColorProvider>
    ),
  );
}

describe('the area colour pinning map', () => {
  it('is needed: two fixture keys hash into one slot', () => {
    // The premise, asserted rather than left as a comment. If the palette ever
    // grows a ninth slot or the hash changes so this pair separates, this test
    // fails and the fixture pinning map in `apps/web` should be revisited.
    expect(areaColorSlot(COLLIDING[0])).toBe(areaColorSlot(COLLIDING[1]));
  });

  it('pins an area to a slot, and the mark wears that slot', () => {
    const markup = render({ health: 1 });
    expect(markup).toContain(colorSlotClass(1));
    expect(markup).not.toContain(colorSlotClass(8));
  });

  it('pins two colliding areas apart, which is the whole point', () => {
    const [first, second] = COLLIDING;
    const one = renderToStaticMarkup(
      <AreaColorProvider overrides={{ [first]: 1, [second]: 4 }}>
        <AreaBadge areaKey={first} name="Health" />
        <AreaBadge areaKey={second} name="Money" />
      </AreaColorProvider>,
    );

    expect(one).toContain(colorSlotClass(1));
    expect(one).toContain(colorSlotClass(4));
    expect(one).not.toContain(colorSlotClass(8));
  });

  it('falls back to the key-derived slot for an area the map does not name', () => {
    // A map is a partial answer, not a replacement: an area added after the
    // map was written still gets a colour, and it gets the same one twice.
    const markup = render({ money: 4 });
    expect(markup).toContain(colorSlotClass(areaColorSlot('health') as SeriesSlot));
  });

  it('renders no `style` attribute, pinned or not', () => {
    // The map changes which *slot* an area wears, never how it is painted —
    // and painting is a class from the generated stylesheet, because the CSP
    // the web tier sends refuses a style attribute (W07).
    expect(render({ health: 1 })).not.toContain('style=');
    expect(render()).not.toContain('style=');
  });
});
