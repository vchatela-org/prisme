import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * A skeleton is for a **first** load, when there is nothing to hold. On a
 * refetch the previous render stays put at reduced opacity instead — a
 * skeleton flashing over data the reader was already reading is a layout jump
 * and loses their place (`dataviz` → interaction).
 *
 * `aria-hidden` because a screen reader should hear "loading" from the
 * region's `aria-busy`, not a list of empty boxes.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-page', className)}
      {...props}
    />
  );
}

/** Holds a refetch in place: same layout, dimmed, no flash. */
export function Refreshing({
  className,
  busy,
  ...props
}: ComponentProps<'div'> & { busy: boolean }) {
  return (
    <div
      aria-busy={busy}
      className={cn(
        'transition-opacity duration-[var(--prisme-duration-normal)]',
        busy && 'opacity-60',
        className,
      )}
      {...props}
    />
  );
}
