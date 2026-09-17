'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING } from '../lib/focus.js';
import { TooltipProvider } from '../primitives/tooltip.js';

export interface NavItem {
  label: string;
  href: string;
  icon?: ReactNode;
  /** Set by the app from the current route. */
  current?: boolean;
  /** A count beside the label — inbox items, adoption queue, conflicts. */
  badge?: number;
}

export interface NavGroup {
  /** Omit for the first group, which needs no heading. */
  label?: string;
  items: readonly NavItem[];
}

export interface AppShellProps {
  nav: readonly NavGroup[];
  children: ReactNode;
  /** The router's link component. Falls back to a plain anchor. */
  linkAs?: React.ElementType;
  /** Sync status, theme toggle, whatever else belongs in the header. */
  headerRight?: ReactNode;
  /** The stale-weights banner, above everything it applies to. */
  banner?: ReactNode;
  brand?: ReactNode;
}

/**
 * The frame every screen sits in.
 *
 * Three things here are accessibility rather than decoration, and are easy to
 * lose in a redesign:
 *
 *  - a **skip link**, so a keyboard reader is not made to tab through the whole
 *    navigation on every page;
 *  - real **landmarks** (`banner`, `navigation`, `main`), so a screen reader
 *    can jump between the regions instead of reading the page as one stream;
 *  - `aria-current="page"` on the active item, so "where am I" does not depend
 *    on noticing a background tint.
 */
export function AppShell({
  nav,
  children,
  linkAs: Link = 'a',
  headerRight,
  banner,
  brand,
}: AppShellProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-surface-page text-ink">
        <a
          href="#main"
          className={cn(
            'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50',
            'focus:rounded-md focus:bg-surface-overlay focus:px-3 focus:py-2 focus:text-sm',
            'focus:shadow-overlay',
          )}
        >
          Skip to content
        </a>

        <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-4 md:px-6">
          <nav aria-label="Main" className="hidden w-52 shrink-0 flex-col gap-6 md:flex">
            {brand ? <div className="px-2 py-1 text-sm font-semibold text-ink">{brand}</div> : null}

            {nav.map((group, index) => (
              <div key={group.label ?? index} className="flex flex-col gap-1">
                {group.label ? (
                  <span className="px-2 text-xs font-medium tracking-wide text-ink-muted uppercase">
                    {group.label}
                  </span>
                ) : null}

                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={item.current ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      '[&_svg]:size-4 [&_svg]:shrink-0',
                      item.current
                        ? 'bg-surface-raised font-medium text-ink shadow-raised'
                        : 'text-ink-secondary hover:bg-surface-raised hover:text-ink',
                      FOCUS_RING,
                    )}
                  >
                    {item.icon}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge === undefined || item.badge === 0 ? null : (
                      <span className="rounded-full bg-surface-page px-1.5 text-xs text-ink-secondary tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              {/*
                On a narrow screen the sidebar is gone, so the brand moves into
                the header rather than leaving the page unlabelled.
              */}
              <span className="text-sm font-semibold text-ink md:hidden">{brand}</span>
              <div className="ml-auto flex items-center gap-3">{headerRight}</div>
            </header>

            {banner}

            <main id="main" className="flex flex-col gap-6 pb-12">
              {children}
            </main>
          </div>
        </div>

        {/* The navigation again, for a narrow screen. */}
        <nav
          aria-label="Main, compact"
          className={cn(
            'sticky bottom-0 flex gap-1 overflow-x-auto border-t border-border-hairline',
            'bg-surface-raised px-2 py-1.5 md:hidden',
          )}
        >
          {nav
            .flatMap((group) => group.items)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                  '[&_svg]:size-4',
                  item.current ? 'bg-surface-page font-medium text-ink' : 'text-ink-secondary',
                  FOCUS_RING,
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
        </nav>
      </div>
    </TooltipProvider>
  );
}

/** A titled block on a screen. The unit every surface composes from. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="text-sm text-ink-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A plain card, for anything that is not a chart or a table. */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-hairline bg-surface-raised p-4 shadow-raised',
        className,
      )}
      {...props}
    />
  );
}
