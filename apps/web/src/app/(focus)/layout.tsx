import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * Focus sits at `/`, so this route group's layout is the one a cold visit hits.
 *
 * Each surface group carries its own thin layout rather than the shell moving
 * into the root layout: the root is shared with the gallery and with the wave-4
 * route groups, and a shell added there would wrap screens whose workstreams
 * have not yet decided they want one.
 */
export default function FocusLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
