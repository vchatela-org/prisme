'use client';

import {
  AppShell,
  CommandPalette,
  ThemeToggle,
  ToastProvider,
  type NavGroup,
  type PaletteCommand,
} from '@prisme/ui';
import { GitMerge, Inbox, LayoutList, Target } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';

/**
 * The frame the daily surfaces sit in.
 *
 * It is a client component for one reason: `usePathname`. "Where am I" is
 * `aria-current="page"` on the active navigation item, and computing that in
 * each route group's layout would mean three copies of the same nav — which is
 * how four parallel UI workstreams end up with four navigations that disagree
 * about what exists.
 *
 * The screens themselves stay **server** components. They are passed in as
 * `children`, already rendered, so nothing about being inside a client frame
 * pulls a page's data fetching into the browser.
 *
 * ## The navigation only lists what exists
 *
 * Areas, Timeline, Objectives and the reviews are wave 4 and 5. They are absent
 * rather than disabled: a navigation item that goes nowhere is a 404 a reader
 * finds by clicking, and it teaches them the navigation is unreliable. The
 * *creation* entry points are the ones the brief asks to render as disabled
 * affordances, and those live on the screens that would create something —
 * where the affordance says what will eventually happen there.
 */

const NAV: readonly NavGroup[] = [
  {
    items: [
      { label: 'Focus', href: '/', icon: <Target aria-hidden /> },
      { label: 'Backlog', href: '/backlog', icon: <LayoutList aria-hidden /> },
      { label: 'Inbox', href: '/inbox', icon: <Inbox aria-hidden /> },
      // Adoption is a migration surface, not a daily one: it is worked hard
      // once and then rarely, and it becomes empty on purpose. It sits here
      // rather than in a group of its own because it is reached the same way
      // the other three are, and a second group for one item is a heading.
      { label: 'Adoption', href: '/adoption', icon: <GitMerge aria-hidden /> },
    ],
  },
];

export interface AppFrameProps {
  children: ReactNode;
  /** How many items are waiting in the inbox, when the caller knows. */
  inboxCount?: number;
  banner?: ReactNode;
  headerRight?: ReactNode;
}

export function AppFrame({ children, inboxCount, banner, headerRight }: AppFrameProps) {
  const pathname = usePathname();
  const router = useRouter();

  const nav = useMemo<readonly NavGroup[]>(
    () =>
      NAV.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          // An exact match for Focus, which is `/`, and a prefix match for the
          // rest so an initiative page keeps the backlog lit.
          current: item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
          ...(item.href === '/inbox' && inboxCount !== undefined ? { badge: inboxCount } : {}),
        })),
      })),
    [pathname, inboxCount],
  );

  const commands = useMemo<readonly PaletteCommand[]>(
    () => [
      {
        id: 'go-focus',
        label: 'Go to Focus',
        group: 'Navigate',
        keywords: ['now', 'today'],
        run: () => {
          router.push('/');
        },
      },
      {
        id: 'go-backlog',
        label: 'Go to Backlog',
        group: 'Navigate',
        keywords: ['ranked', 'next', 'later'],
        run: () => {
          router.push('/backlog');
        },
      },
      {
        id: 'go-inbox',
        label: 'Go to Inbox',
        group: 'Navigate',
        keywords: ['triage', 'capture', 'takeaway'],
        run: () => {
          router.push('/inbox');
        },
      },
      {
        id: 'backlog-deadlines',
        label: 'Backlog: only what has a deadline',
        group: 'Filter',
        keywords: ['deadline', 'due', 'at risk'],
        run: () => {
          router.push('/backlog?hasDeadline=true&sort=deadline');
        },
      },
      {
        id: 'backlog-now-next',
        label: 'Backlog: now and next',
        group: 'Filter',
        keywords: ['wip', 'in flight'],
        run: () => {
          router.push('/backlog?status=now,next');
        },
      },
    ],
    [router],
  );

  return (
    <ToastProvider>
      <AppShell
        nav={nav}
        linkAs={Link}
        banner={banner}
        brand={<span className="text-sm font-semibold">prisme</span>}
        headerRight={
          <div className="flex items-center gap-2">
            {headerRight}
            <ThemeToggle />
          </div>
        }
      >
        {children}
      </AppShell>
      <CommandPalette commands={commands} />
    </ToastProvider>
  );
}
