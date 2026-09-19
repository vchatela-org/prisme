import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The areas group, which also carries `/review/year`.
 *
 * The Year Review lives here rather than in `(review)` because W11 owns that
 * group and its `/review/[cadence]` route, and two wave-4 agents editing one
 * directory is the conflict `apps/web/CLAUDE.md` warns about. A route group's
 * parentheses do not appear in the URL, so the address is `/review/year`
 * either way, and Next resolves the static segment ahead of the dynamic one.
 *
 * It belongs beside the areas for a better reason than convenience, though:
 * the Year Review is the only surface that writes a weight, and every other
 * screen that reads one is in this group.
 */
export default function AreasLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
