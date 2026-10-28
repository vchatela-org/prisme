'use client';

import { Button, useToast } from '@prisme/ui';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { transitionInitiative } from '@/lib/actions';

/**
 * Accepting a suggestion: one click moves it to `now`.
 *
 * A suggestion is already the answer to every guardrail the status menu would
 * raise — selection only proposes work that is unblocked, sized for `now`, and
 * whose area has a slot free — so there is nothing to confirm. The status menu
 * on the same card is still there for any other move.
 */
export function StartButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      aria-label={`Start ${title}: move it to now`}
      onClick={() => {
        startTransition(async () => {
          const result = await transitionInitiative({ id, to: 'now' });
          if (result.ok) {
            toast({ title: 'Started. It is in flight now.', tone: 'success' });
            router.refresh();
          } else {
            toast({ title: result.title, description: result.description, tone: 'error' });
          }
        });
      }}
    >
      <Play aria-hidden className="size-3" />
      {pending ? 'Starting…' : 'Start'}
    </Button>
  );
}
