'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { commandScore } from '../lib/command-score.js';

/**
 * The searchable list underneath both the command palette and the combobox.
 *
 * `cmdk` supplies the listbox semantics — `aria-activedescendant`, arrow-key
 * movement that skips disabled and filtered-out rows, and typing that never
 * steals focus from the input. Ranking is ours (`commandScore`), because the
 * default is a fuzzy matcher tuned for file paths.
 */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      filter={commandScore}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-lg bg-surface-overlay',
        className,
      )}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border-hairline px-3">
      <Search className="size-4 shrink-0 text-ink-muted" />
      <CommandPrimitive.Input
        className={cn(
          'h-11 w-full bg-transparent text-sm text-ink outline-none',
          'placeholder:text-ink-muted disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-80 overflow-x-hidden overflow-y-auto p-1', className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('px-3 py-6 text-center text-sm text-ink-secondary', className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-ink-secondary',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-ink',
        'outline-none select-none [&_svg]:size-4 [&_svg]:text-ink-muted',
        'data-[selected=true]:bg-surface-page data-[disabled=true]:text-ink-muted',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('my-1 h-px bg-border-hairline', className)}
      {...props}
    />
  );
}

/** The keyboard hint on the right of a row — `⌘K`, `G then F`. */
export function CommandShortcut({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'ml-auto rounded border border-border-hairline bg-surface-page px-1.5 py-0.5',
        'font-sans text-xs text-ink-secondary',
        className,
      )}
      {...props}
    />
  );
}
