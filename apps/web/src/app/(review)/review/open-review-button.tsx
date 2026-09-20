'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CADENCE_LABELS } from '@/lib/review-wizard';
import type { ReviewCadence } from '@/lib/contracts';
import { openReview } from './review-actions';

/** Open a session and land on its first step. */
export function OpenReviewButton({
  cadence,
  variant = 'primary',
}: {
  cadence: ReviewCadence;
  variant?: 'primary' | 'secondary';
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const start = (): void => {
    startTransition(async () => {
      const result = await openReview({ cadence });

      if (!result.ok) {
        toast({ title: result.title, description: result.description, tone: 'error' });
        return;
      }

      toast({ title: result.title, description: result.description, tone: 'success' });
      router.push(`/review/${cadence}`);
    });
  };

  return (
    <Button variant={variant} disabled={pending} onClick={start}>
      {pending ? 'Opening…' : `Start the ${CADENCE_LABELS[cadence].toLowerCase()} review`}
    </Button>
  );
}
