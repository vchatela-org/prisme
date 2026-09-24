'use client';

import {
  AppShell,
  CommandPalette,
  ThemeToggle,
  ToastProvider,
  type NavGroup,
  type PaletteCommand,
} from '@prisme/ui';
import {
  ChartNoAxesCombined,
  ClipboardCheck,
  GanttChart,
  GitMerge,
  Goal,
  Inbox,
  LayoutList,
  PackagePlus,
  Scale,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { CaptureDialog } from './capture-dialog';
import { SignOut } from './sign-out';

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
 * A navigation item that goes nowhere is a 404 a reader finds by clicking, and
 * it teaches them the navigation is unreliable. So an item appears on the day
 * its route lands, never before. The *creation* entry points are the ones the
 * brief asks to render as disabled affordances, and those live on the screens
 * that would create something — where the affordance says what will eventually
 * happen there.
 *
 * Areas and KPI were added by W09, the Timeline by W10, and Objectives and
 * Reviews by W11, each on the day its route landed — which is the rule this
 * comment describes rather than an exception to it.
 *
 * W15 adds **Creations** — the ledger of what prisme has asked the external
 * tools for and not yet confirmed. The three creation *flows* are not in the
 * navigation and deliberately so: creating is an action rather than a place,
 * and it belongs in the palette, on the keyboard path, next to where somebody
 * already is. The ledger is the one that is a place, because it is where you
 * go when something you asked for has not appeared.
 */

const NAV: readonly NavGroup[] = [
  {
    items: [
      { label: 'Focus', href: '/', icon: <Target aria-hidden /> },
      { label: 'Backlog', href: '/backlog', icon: <LayoutList aria-hidden /> },
      { label: 'Inbox', href: '/inbox', icon: <Inbox aria-hidden /> },
      // Areas and KPI are the measurement surfaces: read weekly and hard at
      // the year's end, rather than several times a day like the three above.
      { label: 'Areas', href: '/areas', icon: <Scale aria-hidden /> },
      { label: 'KPI', href: '/kpi', icon: <ChartNoAxesCombined aria-hidden /> },
      // The Timeline answers "when, and what moves with it" — read when a date
      // is in question rather than daily, which is why it sits after the three
      // above and not among them.
      { label: 'Timeline', href: '/timeline', icon: <GanttChart aria-hidden /> },
      // Objectives and Reviews are the decision surfaces: read monthly rather
      // than daily. Objectives sits before Reviews because the monthly review
      // reads it, not the other way round.
      { label: 'Objectives', href: '/objectives', icon: <Goal aria-hidden /> },
      { label: 'Reviews', href: '/review', icon: <ClipboardCheck aria-hidden /> },
      // Adoption is a migration surface, not a daily one: it is worked hard
      // once and then rarely, and it becomes empty on purpose. It sits here
      // rather than in a group of its own because it is reached the same way
      // the other three are, and a second group for one item is a heading.
      { label: 'Adoption', href: '/adoption', icon: <GitMerge aria-hidden /> },
      // Creations sits beside Adoption for the same reason: both are about
      // the boundary with the external tools, both are read when something
      // there does not match what prisme says, and both become empty on
      // purpose.
      { label: 'Creations', href: '/create/creations', icon: <PackagePlus aria-hidden /> },
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
  const [capturing, setCapturing] = useState(false);

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
      /*
       * Capture is first, and it is the only command that does not navigate.
       *
       * The brief's target is a capture from the palette in under ten
       * seconds with its decisions deferred, and every navigation in that
       * path costs a page load and loses the screen the person was reading.
       * So this opens a dialog over wherever they are: ⌘K, "capture", type,
       * Enter, and they are back where they started.
       */
      {
        id: 'capture',
        label: 'Capture something',
        group: 'Create',
        keywords: ['quick', 'inbox', 'note', 'todo', 'task', 'jot'],
        run: () => {
          setCapturing(true);
        },
      },
      {
        id: 'new-initiative',
        label: 'New initiative',
        group: 'Create',
        keywords: ['outcome', 'score', 'wsjf', 'backlog'],
        run: () => {
          router.push('/create/initiative');
        },
      },
      {
        id: 'new-project',
        label: 'New project',
        group: 'Create',
        keywords: ['container', 'sections', 'renovation', 'large', 'effort'],
        run: () => {
          router.push('/create/project');
        },
      },
      {
        id: 'go-creations',
        label: 'Go to Creations',
        group: 'Navigate',
        keywords: ['ledger', 'pending', 'queued', 'failed', 'outstanding'],
        run: () => {
          router.push('/create/creations');
        },
      },
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
        id: 'go-areas',
        label: 'Go to Areas',
        group: 'Navigate',
        keywords: ['balance', 'capacity', 'declared', 'observed', 'weights'],
        run: () => {
          router.push('/areas');
        },
      },
      {
        id: 'go-kpi',
        label: 'Go to the KPI dashboard',
        group: 'Navigate',
        keywords: ['metrics', 'throughput', 'adherence', 'attainment', 'charts'],
        run: () => {
          router.push('/kpi');
        },
      },
      {
        id: 'go-timeline',
        label: 'Go to the Timeline',
        group: 'Navigate',
        keywords: ['gantt', 'schedule', 'dates', 'critical path', 'dependencies', 'slack'],
        run: () => {
          router.push('/timeline');
        },
      },
      {
        id: 'go-objectives',
        label: 'Go to Objectives',
        group: 'Navigate',
        keywords: ['okr', 'key results', 'progress', 'orphans', 'goals'],
        run: () => {
          router.push('/objectives');
        },
      },
      {
        id: 'go-reviews',
        label: 'Go to Reviews',
        group: 'Navigate',
        keywords: ['ritual', 'checklist', 'weekly', 'monthly', 'quarterly'],
        run: () => {
          router.push('/review');
        },
      },
      {
        id: 'go-weekly-review',
        label: 'Resume the weekly review',
        group: 'Navigate',
        keywords: ['weekly', 'ritual', 'resume'],
        run: () => {
          router.push('/review/weekly');
        },
      },
      {
        id: 'go-year-review',
        label: 'Go to the Year Review',
        group: 'Navigate',
        keywords: ['weights', 'allocation', 'year', 'annual'],
        run: () => {
          router.push('/review/year');
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
            <SignOut />
          </div>
        }
      >
        {children}
      </AppShell>
      <CommandPalette commands={commands} />
      <CaptureDialog open={capturing} onOpenChange={setCapturing} />
    </ToastProvider>
  );
}
