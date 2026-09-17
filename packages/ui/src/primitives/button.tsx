'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED, FOCUS_RING } from '../lib/focus.js';

/**
 * `primary` is the one button on a screen that commits the decision — a review
 * accepted, a plan applied. Everything else is `secondary` or `ghost`.
 * `danger` is reserved for a destructive action and wears the status palette,
 * not a red series colour.
 */
const button = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'font-medium transition-colors duration-[var(--prisme-duration-fast)]',
    // 24px is the WCAG 2.2 target-size minimum; every size below clears it.
    '[&_svg]:size-4 [&_svg]:shrink-0',
    FOCUS_RING,
    DISABLED,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-accent-solid text-ink-on-accent hover:opacity-90 disabled:opacity-60',
        secondary:
          'border border-border-strong bg-surface-raised text-ink hover:bg-surface-page disabled:bg-surface-page',
        ghost: 'text-ink-secondary hover:bg-surface-page hover:text-ink',
        danger:
          'border border-status-critical text-status-critical hover:bg-status-critical hover:text-ink-on-accent',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof button> {
  /**
   * Render the caller's child element instead of a `<button>`, keeping the
   * styling. The escape hatch for a link that must look like a button —
   * without it, someone reimplements the styling on an `<a>` and loses the
   * focus ring.
   */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component className={cn(button({ variant, size }), className)} {...props} />;
}
