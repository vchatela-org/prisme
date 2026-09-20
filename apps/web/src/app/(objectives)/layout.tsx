import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The objectives group: `/objectives` and `/objectives/[id]`.
 *
 * The cadence reviews are a sibling group, `(review)`, even though the monthly
 * review's objective steps read exactly these screens. They are separate
 * because they are entered differently — one is browsed, the other is worked
 * through in order — and a wizard step links here rather than embedding the
 * page, so a review never loses its place.
 */
export default function ObjectivesLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
