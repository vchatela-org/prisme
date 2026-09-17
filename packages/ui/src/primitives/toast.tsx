'use client';

import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_RAISED } from '../lib/focus.js';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** A toast with an undo is worth more than a confirmation dialog. */
  action?: { label: string; onAction: () => void };
}

interface ToastContextValue {
  toast: (message: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * `useToast` throws outside the provider rather than silently doing nothing.
 * A toast that never appears is a bug that only shows up when the thing it was
 * confirming has already happened.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info className="size-4 text-ink-secondary" />,
  success: <CircleCheck className="size-4 text-status-good" />,
  error: <TriangleAlert className="size-4 text-status-critical" />,
};

/**
 * Sits once in the app shell. Radix's provider gives each toast a swipe
 * gesture, an `F8` hotkey to focus the region, and the live-region wiring that
 * makes an announcement reach a screen reader — with `foreground` priority for
 * an error, so it interrupts, and `background` otherwise, so it does not.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    setMessages((current) => [
      ...current,
      { ...message, id: `${Date.now()}-${current.length.toString()}` },
    ]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setMessages((current) => current.filter((m) => m.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {messages.map((message) => (
          <RadixToast.Root
            key={message.id}
            type={message.tone === 'error' ? 'foreground' : 'background'}
            duration={message.tone === 'error' ? 10000 : 5000}
            onOpenChange={(open) => {
              if (!open) dismiss(message.id);
            }}
            className={cn(
              'flex items-start gap-3 rounded-lg border border-border-hairline',
              'bg-surface-overlay p-3 shadow-overlay data-[state=open]:animate-fade-in',
            )}
          >
            {TONE_ICON[message.tone ?? 'info']}
            <div className="flex flex-1 flex-col gap-0.5">
              <RadixToast.Title className="text-sm font-medium text-ink">
                {message.title}
              </RadixToast.Title>
              {message.description ? (
                <RadixToast.Description className="text-xs text-ink-secondary">
                  {message.description}
                </RadixToast.Description>
              ) : null}
            </div>
            {message.action ? (
              <RadixToast.Action
                altText={message.action.label}
                onClick={message.action.onAction}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium text-accent hover:underline',
                  FOCUS_RING_RAISED,
                )}
              >
                {message.action.label}
              </RadixToast.Action>
            ) : null}
            <RadixToast.Close
              className={cn('rounded-md p-0.5 text-ink-muted hover:text-ink', FOCUS_RING_RAISED)}
            >
              <X className="size-3.5" />
              <span className="sr-only">Dismiss</span>
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
