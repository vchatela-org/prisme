'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

/**
 * Collision-aware placement comes from Radix; the 8px offset and the hairline
 * are ours. `align="start"` by default because almost every popover in prisme
 * hangs off a control on the left of its row.
 */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border-hairline bg-surface-overlay p-3 shadow-overlay',
          'text-sm text-ink data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
