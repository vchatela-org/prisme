import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The timeline group.
 *
 * One route, deliberately: the Gantt answers "when, and what moves with it",
 * and everything adjacent to that question already has a surface. Editing a
 * dependency belongs to the initiative detail screen, which owns the field;
 * scheduling a task belongs to the task tool, because prisme schedules
 * initiatives and nothing smaller (ADR-0003).
 */
export default function TimelineLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
