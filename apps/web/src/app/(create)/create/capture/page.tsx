import { Card, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema, captureListSchema } from '@/lib/contracts';
import { CaptureForm } from './capture-form';
import { PromoteDialog } from './promote-dialog';

export const metadata = {
  title: 'Capture · prisme',
  description: 'A small thing, in seconds, with its decisions deferred.',
};

/**
 * Quick capture, as a screen.
 *
 * The same form the command palette opens in a dialog — one component, two
 * mounts, because a capture box that behaves differently depending on how it
 * was opened is two things to keep working.
 *
 * Beneath it, what has been captured and not promoted. That list is meant to
 * stay long: **most captures never become initiatives**, and reading it as a
 * backlog to work down would be reading it wrong. It is here so a person can
 * see that the thing they typed landed, and so that promoting one is one
 * click from where they captured it.
 */
export default async function CapturePage() {
  const [areas, captures] = await Promise.all([
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({
      path: '/captures',
      query: { promoted: 'false', limit: '25' },
      schema: captureListSchema,
    }),
  ]);

  if (!areas.ok) return <ApiFailureState failure={areas} surface="the areas" />;

  const choices = areas.data.items
    .filter((area) => area.kind === 'area')
    .map((area) => ({
      key: area.key,
      name: area.name,
      mapped: area.mappings.length > 0,
    }));

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Capture"
        description="One line and an area. It becomes a task and stays a task — deciding whether it is an initiative is a separate, later act."
      >
        <Card className="p-4">
          <CaptureForm areas={choices} />
        </Card>
      </Section>

      <Section
        title="Captured, not promoted"
        description="Most of these will stay here, and that is the intended outcome rather than a backlog to work down."
      >
        {!captures.ok ? (
          <ApiFailureState failure={captures} surface="what has been captured" />
        ) : captures.data.items.length === 0 ? (
          <Card className="p-4 text-sm text-ink-secondary">Nothing captured yet.</Card>
        ) : (
          <ul className="flex flex-col gap-1">
            {captures.data.items.map((capture) => (
              <li
                key={capture.id}
                className="flex items-center gap-3 rounded-md border border-border-hairline px-3 py-2 text-sm"
              >
                <span className="flex-1 truncate">{capture.title}</span>
                {capture.externalTaskId === null ? (
                  <Link href="/create/creations" className="text-xs text-ink-tertiary underline">
                    task pending
                  </Link>
                ) : (
                  <span className="text-xs text-ink-tertiary">task made</span>
                )}
                <PromoteDialog
                  captureId={capture.id}
                  captureTitle={capture.title}
                  disabled={capture.externalTaskId === null}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
