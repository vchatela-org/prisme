'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED, FOCUS_RING } from '../lib/focus.js';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './command.js';
import { Popover, PopoverContent, PopoverTrigger } from './popover.js';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Aliases, so "sso" can find an initiative called "Single sign-on". */
  keywords?: readonly string[];
  disabled?: boolean;
  /** An area swatch, a status dot — anything the row should show. */
  adornment?: ReactNode;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the query matches nothing. Say what would match. */
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Type-to-filter selection for a list too long to scroll — an initiative, a
 * project, an objective.
 *
 * The trigger is a real `<button>` with `role="combobox"` and `aria-expanded`,
 * so it is reachable by keyboard and announced as a combobox rather than as a
 * div somebody made clickable.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'Nothing matches that.',
  disabled = false,
  id,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md',
          'border border-border-strong bg-surface-raised px-3 text-sm',
          selected ? 'text-ink' : 'text-ink-muted',
          FOCUS_RING,
          DISABLED,
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.adornment}
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-muted" />
      </PopoverTrigger>

      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                // Spread rather than pass `undefined`: under
                // `exactOptionalPropertyTypes` an absent prop and a prop set to
                // undefined are different things, and cmdk wants the former.
                {...(option.keywords ? { keywords: [...option.keywords] } : {})}
                disabled={option.disabled ?? false}
                onSelect={() => {
                  onValueChange?.(option.value);
                  setOpen(false);
                }}
              >
                {option.adornment}
                <span className="truncate">{option.label}</span>
                {option.value === value ? <Check className="ml-auto size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
