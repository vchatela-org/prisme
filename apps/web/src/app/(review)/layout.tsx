import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The review group: the hub, the four cadences and the history.
 *
 * `/review/year` is **not** here — it lives in `(areas)`, because W09 owns the
 * one surface that writes a weight and every other screen reading one is in
 * that group. A route group's parentheses do not appear in the URL, and Next
 * resolves the static `year` segment ahead of this group's `[cadence]`, so the
 * yearly wizard's allocate step links to it rather than reimplementing it.
 */
export default function ReviewLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
