'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED, FOCUS_RING } from '../lib/focus.js';

/**
 * A select for a **closed, short** list — a status, a year, an area. If the
 * list is long or the reader is likely to type rather than scroll, that is a
 * `<Combobox>`.
 */
export const Select = RadixSelect.Root;
export const SelectValue = RadixSelect.Value;
export const SelectGroup = RadixSelect.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixSelect.Trigger>) {
  return (
    <RadixSelect.Trigger
      className={cn(
        'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md',
        'border border-border-strong bg-surface-raised px-3 text-sm text-ink',
        'data-[placeholder]:text-ink-muted',
        FOCUS_RING,
        DISABLED,
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon>
        <ChevronDown className="size-4 text-ink-muted" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof RadixSelect.Content>) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        position={position}
        sideOffset={4}
        className={cn(
          'z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg',
          'border border-border-hairline bg-surface-overlay shadow-overlay',
          'data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm text-ink',
        'outline-none select-none',
        // Highlight follows the keyboard as well as the pointer: Radix sets
        // data-highlighted for both, so arrow keys look the same as a hover.
        'data-[highlighted]:bg-surface-page data-[disabled]:text-ink-muted',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3 items-center justify-center">
        <RadixSelect.ItemIndicator>
          <Check className="size-3" />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof RadixSelect.Label>) {
  return (
    <RadixSelect.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-ink-secondary', className)}
      {...props}
    />
  );
}
