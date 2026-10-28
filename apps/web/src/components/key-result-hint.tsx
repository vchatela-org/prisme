import { Badge } from '@prisme/ui';
import type { ReactNode } from 'react';
import type { KeyResultHint } from '@/lib/contracts';
import { keyResultHintNote } from '@/lib/key-result-hint';

/**
 * "Looks like a key result" — shown on the Inbox row and the initiative's page
 * (docs/19-how-it-works.md S1). The reasons are written out beside the badge
 * rather than in a tooltip: a tooltip enhances, it never gates.
 */
export function KeyResultHintNote({
  hints,
  children,
}: {
  hints: readonly KeyResultHint[];
  /** The action that answers it, where the surface offers one. */
  children?: ReactNode;
}) {
  const note = keyResultHintNote(hints);
  if (note === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
      <Badge variant="outline">Looks like a key result</Badge>
      <span>{note}</span>
      {children}
    </div>
  );
}
