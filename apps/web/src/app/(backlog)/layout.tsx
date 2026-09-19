import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The backlog group, which also carries `/initiative/[id]`.
 *
 * The detail screen lives here rather than in a group of its own because it is
 * read with the backlog's scope (`read:backlog`) and is reached from its rows.
 * A route group's parentheses do not appear in the URL, so the address is
 * `/initiative/{id}` either way.
 */
export default function BacklogLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
