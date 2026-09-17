'use client';

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * A tooltip **enhances, it never gates**. Nothing in prisme may be readable
 * only on hover: a tooltip has no keyboard equivalent on a touch screen, and
 * Radix will not show one for an element that cannot take focus. If a value
 * matters, it belongs in the row, the label or the table view — the tooltip is
 * the second place it appears, never the first.
 *
 * The provider belongs once, in the app shell, so that the delay is consistent
 * and moving between two tooltips does not re-wait.
 */
export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-border-hairline bg-surface-overlay px-2 py-1',
          'text-xs text-ink shadow-overlay data-[state=delayed-open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
