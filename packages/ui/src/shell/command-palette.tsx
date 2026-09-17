'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { cn } from '../lib/cn.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../primitives/command.js';

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Aliases — "areas" should find "Balance". */
  keywords?: readonly string[];
  shortcut?: string;
  icon?: ReactNode;
  run: () => void;
}

export interface CommandPaletteProps {
  commands: readonly PaletteCommand[];
  placeholder?: string;
  emptyMessage?: string;
  /** Controlled, for a "Search" button that opens the same palette. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * ⌘K — every navigation and every action in one list.
 *
 * It is the keyboard path through the whole application, so it is a shell
 * component rather than a screen's: a reader who learns it once should reach
 * Focus, Areas and the review wizard the same way from anywhere.
 *
 * The hotkey listens for **either** ⌘K or Ctrl+K so the same muscle memory
 * works on a Mac and on Linux, and it stands down inside a text field, where
 * ⌘K might mean something to the control that has focus.
 */
export function CommandPalette({
  commands,
  placeholder = 'Search for a screen or an action…',
  emptyMessage = 'No command matches that.',
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;

      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement);
      if (isTextEntry && !open) return;

      event.preventDefault();
      setOpen(!open);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  const groups = [...new Set(commands.map((command) => command.group))];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed top-[20%] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2',
            'overflow-hidden rounded-xl border border-border-hairline bg-surface-overlay shadow-overlay',
            'data-[state=open]:animate-fade-in',
          )}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search for a screen or an action. Use the arrow keys to move, Enter to run, Escape to
            close.
          </Dialog.Description>

          <Command loop>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group} heading={group}>
                  {commands
                    .filter((command) => command.group === group)
                    .map((command) => (
                      <CommandItem
                        key={command.id}
                        value={command.label}
                        {...(command.keywords ? { keywords: [...command.keywords] } : {})}
                        onSelect={() => {
                          setOpen(false);
                          command.run();
                        }}
                      >
                        {command.icon}
                        <span className="truncate">{command.label}</span>
                        {command.shortcut ? (
                          <CommandShortcut>{command.shortcut}</CommandShortcut>
                        ) : null}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
