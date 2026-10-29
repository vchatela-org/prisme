import { Button, Notice } from '@prisme/ui';
import Link from 'next/link';
import type { Nudge } from '@/lib/nudge-view';

/**
 * Nudges, each a `<Notice>` with its one link — or nothing when there are none.
 *
 * Shared by Focus and Areas, which both show the starved-area notice, so the
 * two cannot lay it out differently. The wording is `lib/nudge-view.ts`'s and
 * tested there; the notice itself is `packages/ui`'s and tested there.
 */
export function Nudges({ nudges }: { nudges: readonly Nudge[] }) {
  if (nudges.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {nudges.map((nudge) => (
        <Notice
          key={nudge.key}
          title={nudge.title}
          description={nudge.description}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={nudge.href}>{nudge.action}</Link>
            </Button>
          }
        />
      ))}
    </div>
  );
}
