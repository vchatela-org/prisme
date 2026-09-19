'use client';

import { ErrorState, PermissionDeniedState } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import type { ApiFailure } from '@/lib/api-result';
import { failureCopy } from '@/lib/api-result';

/**
 * A failed read, rendered as the state that matches it.
 *
 * A client component for one reason: `onRetry`. A function prop cannot cross
 * from a server component into a client one, and an error state with no way
 * forward is a dead end — so the retry lives here and re-renders the server
 * component that failed.
 *
 * `unauthenticated` and `forbidden` are not errors. Deny-by-default means a
 * reader meets the second one occasionally, and painting it red teaches them to
 * read a working security control as an outage.
 */
export function ApiFailureState({ failure, surface }: { failure: ApiFailure; surface: string }) {
  const router = useRouter();
  const copy = failureCopy(failure, surface);

  if (failure.kind === 'forbidden' || failure.kind === 'unauthenticated') {
    return <PermissionDeniedState title={copy.title} description={copy.description} />;
  }

  return (
    <ErrorState
      title={copy.title}
      description={copy.description}
      onRetry={() => {
        router.refresh();
      }}
    />
  );
}
