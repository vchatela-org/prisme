import { Card } from '@prisme/ui';
import Link from 'next/link';

/** One area, as the notice names it: a key for the map and a name for a person. */
export interface NamedArea {
  readonly key: string;
  readonly name: string;
}

export interface AreaColourNoticeProps {
  /** The areas sharing a hue, grouped by the slot they share. */
  readonly collisions: readonly (readonly NamedArea[])[];
  /** More ranked areas than the palette has hues, so some pair must share. */
  readonly exhausted: boolean;
}

/**
 * Two areas painting in one colour, said where it can be acted on.
 *
 * ## The defect
 *
 * `areaColorSlot` hashes an area's key into the palette's eight categorical
 * slots, and six areas hashed into eight slots collide most of the time — the
 * birthday problem, not a bad hash. The colours are merely wrong when it
 * happens: two areas a reader is meant to tell apart at a glance share a hue,
 * on every chart, with nothing saying so.
 *
 * ## The fix is a click
 *
 * A colour is chosen per area on the Settings screen, which is the only place
 * it is set. This notice links each clashing area to its settings page.
 *
 * ## `role="status"`, like the year gate
 *
 * A persistent condition rather than an alert: it stays until a colour is
 * chosen, and an alert would interrupt on every navigation. It is also not
 * an error — the application is working, and the colours are wrong.
 */
export function AreaColourNotice({ collisions, exhausted }: AreaColourNoticeProps) {
  const sharing = collisions
    .map((group) => group.map((area) => area.name).join(' and '))
    .join('; ');
  const sharers = collisions.flat();

  return (
    <Card role="status" className="flex flex-col gap-3 border-status-warning p-4 text-sm text-ink">
      <p>
        <span className="font-medium">Some areas are painting in the same colour: {sharing}.</span>{' '}
        <span className="text-ink-secondary">
          An area nobody has given a colour gets one derived from its key, and two keys can land on
          the same hue.
        </span>
      </p>

      <p className="text-ink-secondary">
        Give one of them a colour of its own:{' '}
        {sharers.map((area, index) => (
          <span key={area.key}>
            {index > 0 ? ', ' : ''}
            <Link
              className="font-medium text-ink underline underline-offset-2"
              href={`/settings/areas/${encodeURIComponent(area.key)}`}
            >
              {area.name}
            </Link>
          </span>
        ))}
        .
      </p>

      {exhausted ? (
        <p className="text-ink-secondary">
          There are more ranked areas than the palette has hues, so at least one pair has to share.
          A ninth hue is not generated on purpose: it would be indistinguishable from an existing
          one for a reader with colour-vision deficiency.
        </p>
      ) : null}
    </Card>
  );
}
