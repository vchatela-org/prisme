'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { rescanAdoption } from '@/lib/actions';

/** Re-read both tools into the queue. Writes prisme's own tables and nothing outward. */
export function RescanButton() {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await rescanAdoption();
          toast(
            result.ok
              ? { title: 'Rescanned', description: result.message, tone: 'success' }
              : { title: result.title, description: result.description, tone: 'error' },
          );
          router.refresh();
        });
      }}
    >
      {pending ? 'Reading both tools…' : 'Rescan'}
    </Button>
  );
}
