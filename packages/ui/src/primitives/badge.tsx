import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * The plain badge. Anything that carries *meaning* — an area, a status, a
 * score — has its own component in `domain/`, because a badge whose colour is
 * chosen at the call site is how two screens end up disagreeing about what
 * amber means.
 */
const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-page text-ink-secondary border border-border-hairline',
        accent: 'bg-accent-solid text-ink-on-accent',
        outline: 'border border-border-strong text-ink-secondary',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badge> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant }), className)} {...props} />;
}
