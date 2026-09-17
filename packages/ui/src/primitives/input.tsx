'use client';

import { Label as RadixLabel } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED, FOCUS_RING } from '../lib/focus.js';

const field = cn(
  'w-full rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-ink',
  'placeholder:text-ink-muted',
  'transition-colors duration-[var(--prisme-duration-fast)]',
  FOCUS_RING,
  DISABLED,
  'disabled:bg-surface-page',
);

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-20 py-2 leading-normal', className)} {...props} />;
}

/**
 * Radix's label rather than a bare `<label>`: it also prevents the text
 * selection you get from double-clicking a label, which is the sort of detail
 * that makes a hand-built form feel unfinished.
 */
export function Label({ className, ...props }: ComponentProps<typeof RadixLabel.Root>) {
  return (
    <RadixLabel.Root
      className={cn('text-sm font-medium text-ink', 'peer-disabled:text-ink-muted', className)}
      {...props}
    />
  );
}

/**
 * Help text and error text for a field. `tone="error"` also sets `role="alert"`
 * so a screen reader hears the problem rather than only seeing it in red —
 * colour is never the only channel.
 */
export function FieldHint({
  className,
  tone = 'hint',
  ...props
}: ComponentProps<'p'> & { tone?: 'hint' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'text-xs',
        tone === 'error' ? 'text-status-critical' : 'text-ink-secondary',
        className,
      )}
      {...props}
    />
  );
}

/** Label, control and hint in the one arrangement every form in prisme uses. */
export function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}
