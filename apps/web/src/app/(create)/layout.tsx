import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/**
 * The creation group: `/create/capture`, `/create/initiative`,
 * `/create/project` and `/create/creations`.
 *
 * One group for three flows and a ledger, because they are one idea in four
 * shapes: *this thing should exist*. The ledger belongs here rather than
 * beside the sync surfaces for the same reason — it is where you look when
 * something you asked for has not appeared, and the person looking arrived
 * from one of the three forms.
 */
export default function CreateLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
