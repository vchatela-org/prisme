'use client';

import { colorSlotClass, type SeriesSlot } from '@prisme/ui';
import { SERIES_SLOTS } from '@/lib/settings-view';

/**
 * Eight swatches and "automatic".
 *
 * Eight because the palette's ceiling is fixed: a ninth hue is
 * indistinguishable from an existing one under colour-vision deficiency. Each
 * swatch says which other areas already wear it, so a clash is a choice rather
 * than a surprise. The swatch is never the only channel — the radio's label
 * carries a number and the names.
 */
export function ColourPicker({
  value,
  automatic,
  takenBy,
  onChange,
}: {
  value: number | null;
  /** The slot the key's hash (or a pin) gives, shown beside "automatic". */
  automatic: number | null;
  takenBy: Readonly<Record<number, readonly string[]>>;
  onChange: (slot: number | null) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">Colour</legend>
      <div className="flex flex-wrap gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border-hairline px-2 py-1 text-sm has-[:checked]:border-border-strong has-[:checked]:bg-surface-page">
          <input
            type="radio"
            name="colour"
            checked={value === null}
            onChange={() => {
              onChange(null);
            }}
          />
          Automatic
          {automatic === null ? null : (
            <span
              aria-hidden="true"
              className={`inline-block size-3 rounded-full ${colorSlotClass(automatic as SeriesSlot)}`}
            />
          )}
        </label>
        {SERIES_SLOTS.map((slot) => {
          const others = takenBy[slot] ?? [];
          return (
            <label
              key={slot}
              title={others.length === 0 ? 'Free' : `Also used by ${others.join(', ')}`}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border-hairline px-2 py-1 text-sm has-[:checked]:border-border-strong has-[:checked]:bg-surface-page"
            >
              <input
                type="radio"
                name="colour"
                checked={value === slot}
                onChange={() => {
                  onChange(slot);
                }}
              />
              <span
                aria-hidden="true"
                className={`inline-block size-4 rounded-full ${colorSlotClass(slot)}`}
              />
              <span className="tabular-nums">{slot}</span>
              {others.length === 0 ? null : (
                <span className="text-xs text-ink-muted">({others.join(', ')})</span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
