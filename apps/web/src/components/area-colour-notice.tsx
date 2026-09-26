import { Card } from '@prisme/ui';
import Link from 'next/link';
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
 * ## The fix is a click now
 *
 * Until colours could be chosen on the Settings screen, the only remedy was a
 * pinning map in the web tier's environment, which this notice generated. It
 * now links each clashing area to its settings page, and keeps the generated
 * map as the alternative for an operator who would rather pin in GitOps.
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

      {proposal.exhausted ? (
        <p className="text-ink-secondary">
          There are more ranked areas than the palette has hues, so at least one pair has to share.
          A ninth hue is not generated on purpose: it would be indistinguishable from an existing
          one for a reader with colour-vision deficiency.
        </p>
      ) : null}

      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">Or pin them in the deployment instead</summary>
        <p className="mt-2">
          A colour chosen in Settings wins over this. Set it on the web tier and restart it:
        </p>
        {/*
          A `<pre>` and not a `<code>` with a line break: this is a value to copy
          entire, and whitespace inside `<code>` collapses.
        */}
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-raised px-3 py-2 text-xs text-ink">
          <code>AREA_COLOR_PINS={pinsToEnvValue(proposal.pins)}</code>
        </pre>
      </details>
    </Card>
  );
}
