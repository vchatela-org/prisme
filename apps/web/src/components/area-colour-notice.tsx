import { Card } from '@prisme/ui';
import { pinsToEnvValue, type PinProposal } from '@/lib/area-pin-proposal';

/** One area, as the notice names it: a key for the map and a name for a person. */
export interface NamedArea {
  readonly key: string;
  readonly name: string;
}

export interface AreaColourNoticeProps {
  /** The areas sharing a hue, grouped by the slot they share. */
  readonly collisions: readonly (readonly NamedArea[])[];
  /** What to set instead, from `proposePins`. */
  readonly proposal: PinProposal;
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
 * on every chart, with nothing saying so. W09 found it and #37 mounted the
 * pinning map; what was still missing is that an operator had to *invent* that
 * map — *"`AREA_COLOR_PINS` must be set by hand and nothing generates it"*.
 *
 * ## Why the notice is on this screen and not a build step
 *
 * Only the web tier can read `AREA_COLOR_PINS`, so only the web tier can tell
 * that the pinning in force still collides; and only the web tier can read the
 * palette's ceiling without a second copy of it (see `area-pin-proposal.ts`).
 * A check that ran anywhere else would be reporting on a configuration it
 * cannot see.
 *
 * ## `role="status"`, like the year gate
 *
 * A persistent condition rather than an alert: it stays until the environment
 * is changed, and an alert would interrupt on every navigation. It is also not
 * an error — the application is working, and the colours are wrong.
 */
export function AreaColourNotice({ collisions, proposal }: AreaColourNoticeProps) {
  const sharing = collisions
    .map((group) => group.map((area) => area.name).join(' and '))
    .join('; ');

  return (
    <Card role="status" className="flex flex-col gap-3 border-status-warning p-4 text-sm text-ink">
      <p>
        <span className="font-medium">Some areas are painting in the same colour: {sharing}.</span>{' '}
        <span className="text-ink-secondary">
          An area&rsquo;s colour is derived from its key and hashed into eight slots, so two keys
          land on one hue — which is the birthday problem rather than a bad hash, and it stays until
          the areas are pinned.
        </span>
      </p>

      {proposal.exhausted ? (
        <p className="text-ink-secondary">
          There are more ranked areas than the palette has hues, so at least one pair has to share.
          The map below gives every area it can its own hue; which pair shares is then a choice
          rather than an accident. A ninth hue is not generated on purpose: it would be
          indistinguishable from an existing one for a reader with colour-vision deficiency.
        </p>
      ) : null}

      <p className="text-ink-secondary">
        Set this on the <span className="font-medium text-ink">web tier</span> and restart it:
      </p>

      {/*
        A `<pre>` and not a `<code>` with a line break: this is a value to copy
        entire, and whitespace inside `<code>` collapses.
      */}
      <pre className="overflow-x-auto rounded-md bg-surface-raised px-3 py-2 text-xs text-ink">
        <code>AREA_COLOR_PINS={pinsToEnvValue(proposal.pins)}</code>
      </pre>

      <p className="text-xs text-ink-muted">
        Colours do not move once they are pinned: the map is keyed by area, so adding an area later
        leaves every existing one exactly as it is. An area that already has a hue keeps it — only
        the unpinned ones are dealt — which is what stops this from re-shuffling a chart somebody
        has learned to read.
      </p>
    </Card>
  );
}
