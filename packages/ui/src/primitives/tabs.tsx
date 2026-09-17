'use client';

import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING } from '../lib/focus.js';

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex items-center gap-1 border-b border-border-hairline', className)}
      {...props}
    />
  );
}

/**
 * The active tab is marked by an underline as well as by weight and ink —
 * three channels, none of them colour alone, so the state survives a
 * greyscale print and a reader who cannot separate the two blues.
 */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-secondary',
        'hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink',
        'data-[state=active]:font-semibold',
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}
