'use client';

import { TriangleAlert } from 'lucide-react';
import { useRef, useState, type ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING } from '../lib/focus.js';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover.js';

export interface ScorePillProps extends Omit<ComponentProps<'button'>, 'children'> {
  score: number;
  /**
   * The method's own sentence, shown verbatim. **Do not paraphrase it here or
   * at the call site** — the UI and `packages/domain` would drift, and the
   * first person to notice would be someone told two different things about
   * the same number (apps/web/CLAUDE.md).
   */
  explain: string;
  /** Every intermediate the method computed, in its own words. */
  factors?: Readonly<Record<string, number>>;
  /** e.g. `wsjf-balanced v1`. A score is only reproducible if you know this. */
  method?: string;
  /** The weights behind the balance factor were carried from an earlier year. */
  stale?: boolean;
}

/** Two decimal places, as the fixtures and the docs specify. */
function formatScore(value: number): string {
  return value.toFixed(2);
}

const HOVER_DELAY_MS = 120;

/**
 * A score, and the reasoning behind it one interaction away.
 *
 * Explainability is a product requirement rather than a nicety: a ranking that
 * cannot be interrogated gets overridden once and then ignored, at which point
 * prisme is decoration. So every score in the interface is this component.
 *
 * It opens on hover **and** on click, focus or Enter. A hover-only affordance
 * is invisible to a keyboard and unreachable on a touch screen, which would
 * put the explanation behind a door a third of readers cannot open — Radix's
 * own guidance is to reach for a popover rather than a hover card when the
 * content matters.
 */
export function ScorePill({
  score,
  explain,
  factors,
  method,
  stale = false,
  className,
  ...props
}: ScorePillProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openAfterDelay = (next: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOpen(next);
    }, HOVER_DELAY_MS);
  };

  const cancelDelay = () => {
    clearTimeout(timer.current);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Score ${formatScore(score)}. Show how it was calculated.`}
        onPointerEnter={() => {
          openAfterDelay(true);
        }}
        onPointerLeave={() => {
          openAfterDelay(false);
        }}
        onFocus={() => {
          cancelDelay();
          setOpen(true);
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border-hairline',
          'bg-surface-page px-2 py-0.5 text-xs font-semibold text-ink tabular-nums',
          'hover:border-border-strong',
          FOCUS_RING,
          className,
        )}
        {...props}
      >
        {formatScore(score)}
        {stale ? <TriangleAlert className="size-3 text-status-warning" /> : null}
      </PopoverTrigger>

      <PopoverContent
        className="w-72"
        onPointerEnter={cancelDelay}
        onPointerLeave={() => {
          openAfterDelay(false);
        }}
        // Hover-opened content must not steal focus, or the pointer moving
        // across a table would keep yanking the caret away.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink">{explain}</p>

          {stale ? (
            <p className="flex items-start gap-1.5 text-xs text-ink-secondary">
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-status-warning" />
              <span>
                Carried weights: no weights are set for this year, so the balance factor is stale.
              </span>
            </p>
          ) : null}

          {factors && Object.keys(factors).length > 0 ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border-hairline pt-2">
              {Object.entries(factors).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-xs text-ink-secondary">{name}</dt>
                  <dd className="text-right text-xs text-ink tabular-nums">{formatScore(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {method ? (
            <p className="border-t border-border-hairline pt-2 text-xs text-ink-muted">{method}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
