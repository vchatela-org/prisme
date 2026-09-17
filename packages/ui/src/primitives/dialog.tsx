'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_RAISED } from '../lib/focus.js';

/**
 * Dialog and Sheet are the same Radix primitive wearing different geometry —
 * centred, or anchored to an edge. They share the focus trap, the escape key,
 * the scroll lock and the `aria-modal` wiring, which is exactly the set of
 * things a hand-rolled modal gets subtly wrong.
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

function Overlay({ className, ...props }: ComponentProps<typeof RadixDialog.Overlay>) {
  return (
    <RadixDialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px]',
        'data-[state=open]:animate-fade-in',
        className,
      )}
      {...props}
    />
  );
}

function CloseButton() {
  return (
    <RadixDialog.Close
      className={cn(
        'absolute top-4 right-4 rounded-md p-1 text-ink-muted',
        'hover:bg-surface-page hover:text-ink',
        FOCUS_RING_RAISED,
      )}
    >
      <X className="size-4" />
      <span className="sr-only">Close</span>
    </RadixDialog.Close>
  );
}

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Portal>
      <Overlay />
      <RadixDialog.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border-hairline bg-surface-overlay p-6 shadow-overlay',
          'flex flex-col gap-4 data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/**
 * The side panel. Used for anything that must not lose the page behind it —
 * an initiative opened from a table, the explain panel behind a score.
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { side?: 'right' | 'left' }) {
  return (
    <RadixDialog.Portal>
      <Overlay />
      <RadixDialog.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto',
          'border-border-hairline bg-surface-overlay p-6 shadow-overlay',
          side === 'right'
            ? 'right-0 border-l data-[state=open]:animate-slide-in-right'
            : 'left-0 border-r data-[state=open]:animate-slide-in-left',
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title className={cn('text-lg font-semibold text-ink', className)} {...props} />
  );
}

/**
 * Radix warns when a dialog has no description, and it is right to: a dialog
 * that only has a title gives a screen-reader user the heading and nothing
 * about what the dialog is for.
 */
export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description className={cn('text-sm text-ink-secondary', className)} {...props} />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2', className)} {...props} />;
}

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;
export const SheetHeader = DialogHeader;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
