'use client';

import { FIBONACCI_SCALE, type Fibonacci } from '@prisme/domain';
import { RadioGroup } from 'radix-ui';
import { cn } from '../lib/cn.js';
import { FOCUS_RING } from '../lib/focus.js';

export interface FibonacciSelectProps {
  value?: Fibonacci;
  onValueChange?: (value: Fibonacci) => void;
  /** Labels the group for a screen reader — "Value", "Size", "Risk". */
  label: string;
  /** Above this, show the note. `size` uses 8: bigger than that, slice it. */
  sliceAbove?: Fibonacci;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * **The only way to set a score input.** A free number field would let a 4 or a
 * 7 in, and the whole reason the scale is Fibonacci is that 1–4 produced 11
 * distinct values for 16 combinations — ties everywhere, and a ranking
 * carrying almost no information (docs/10-model.md §5).
 *
 * A segmented radio group rather than a dropdown: six options, and the point
 * is to compare them. Radix's radio group gives roving focus, so the group is
 * one tab stop and the arrow keys move within it.
 */
export function FibonacciSelect({
  value,
  onValueChange,
  label,
  sliceAbove,
  disabled = false,
  id,
  className,
}: FibonacciSelectProps) {
  const shouldSlice = sliceAbove !== undefined && value !== undefined && value > sliceAbove;

  return (
    <div className="flex flex-col gap-1.5">
      <RadioGroup.Root
        id={id}
        aria-label={label}
        value={value === undefined ? '' : String(value)}
        onValueChange={(next) => {
          onValueChange?.(Number(next) as Fibonacci);
        }}
        disabled={disabled}
        orientation="horizontal"
        className={cn('inline-flex rounded-md border border-border-strong p-0.5', className)}
      >
        {FIBONACCI_SCALE.map((option) => (
          <RadioGroup.Item
            key={option}
            value={String(option)}
            className={cn(
              'min-w-9 rounded-sm px-2.5 py-1 text-sm font-medium tabular-nums',
              'text-ink-secondary hover:text-ink',
              'data-[state=checked]:bg-accent-solid data-[state=checked]:text-ink-on-accent',
              'disabled:cursor-not-allowed disabled:text-ink-muted',
              FOCUS_RING,
            )}
          >
            {option}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {shouldSlice ? (
        <p className="text-xs text-ink-secondary">
          Above {sliceAbove}, slice it — score the next slice instead.
        </p>
      ) : null}
    </div>
  );
}
