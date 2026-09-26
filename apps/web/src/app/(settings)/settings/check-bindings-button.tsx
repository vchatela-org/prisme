'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { checkBindings } from './settings-actions';

/**
 * Re-read every bound store's title. Metadata only — the API reads no row and
 * no page body to answer it.
 */
export function CheckBindingsButton() {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await checkBindings();
          toast({
            title: result.title,
            description: result.description,
            tone: result.ok ? 'success' : 'error',
          });
          router.refresh();
        });
      }}
    >
      {pending ? 'Checking…' : 'Check again'}
    </Button>
  );
}
