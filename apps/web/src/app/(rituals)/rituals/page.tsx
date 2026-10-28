import { Card, EmptyState, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema, recurringTasksSchema, ritualListSchema } from '@/lib/contracts';
import { pageUrl } from '@/lib/page-link';
import { taskTitleOf } from '@/lib/rituals-view';
import { webRuntime } from '@/lib/runtime';
import { RitualForm } from './ritual-form';
import { RitualRow } from './ritual-row';

export const metadata = {
  title: 'Rituals · prisme',
  description: 'Habits with a cadence and a target, outside the ranked backlog.',
};

/**
 * Rituals — habits with a cadence and a target.
 *
 * They sit outside the ranked backlog (ADR-0014): a weekly review is not an
 * initiative competing for a slot, it is something that should simply happen.
 * The KPI dashboard's adherence is measured over the rituals defined here, and
 * until this screen existed only a hand-written `POST /rituals` could define
 * one. Each is measured from its recurring task in Todoist, chosen here (S2);
 * from closing the review of its cadence (S3); or — for a habit that is
 * neither — recorded by hand on its row.
 */
export default async function RitualsPage() {
  const [rituals, areas, recurring] = await Promise.all([
    apiFetch({ path: '/rituals', schema: ritualListSchema }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({ path: '/task-tool/recurring-tasks', schema: recurringTasksSchema }),
  ]);
  const tasks = recurring.ok ? recurring.data : null;
  const ritualNames: Record<string, string> = rituals.ok
    ? Object.fromEntries(rituals.data.items.map((ritual) => [ritual.id, ritual.name]))
    : {};
  const template = webRuntime().config.doctoolPageUrlTemplate;
  const areaList = areas.ok
    ? areas.data.items.map((area) => ({ key: area.key, name: area.name }))
    : [];
  const nameOf = new Map(areaList.map((area) => [area.key, area.name]));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold text-ink">Rituals</h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          Habits with a cadence and a target — a weekly review, a daily walk. They are never ranked
          against initiatives; the KPI dashboard measures how often they actually happen, from the
          completions of each one&rsquo;s recurring task in Todoist, from the reviews you close in
          prisme, or from what you record here.
        </p>
      </header>

      <Section title="Defined">
        {!rituals.ok ? (
          <ApiFailureState failure={rituals} surface="the rituals" />
        ) : rituals.data.items.length === 0 ? (
          <EmptyState
            title="No rituals yet"
            description="Define one below. Adherence starts being measured from its first period."
          />
        ) : (
          <Card className="py-0">
            <ul className="flex flex-col divide-y divide-border-hairline">
              {rituals.data.items.map((ritual) => (
                <RitualRow
                  key={ritual.id}
                  draft={{
                    id: ritual.id,
                    name: ritual.name,
                    areaKey: ritual.areaKey,
                    cadence: ritual.cadence,
                    targetAdherencePct: ritual.targetAdherencePct,
                    page: ritual.externalPageId ?? '',
                    task: ritual.externalTaskId,
                    byReview: ritual.fulfilledByReview,
                  }}
                  areaName={nameOf.get(ritual.areaKey) ?? ritual.areaKey}
                  latestAdherencePct={ritual.latestAdherencePct}
                  currentPeriod={ritual.currentPeriod}
                  measuredFrom={ritual.measuredFrom}
                  taskTitle={taskTitleOf(tasks, ritual.externalTaskId)}
                  pageHref={pageUrl(template, ritual.externalPageId) ?? null}
                  areas={areaList}
                  tasks={tasks}
                  ritualNames={ritualNames}
                />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Define a ritual">
        <Card>
          <RitualForm
            initial={{
              name: '',
              areaKey: areaList[0]?.key ?? '',
              cadence: 'weekly',
              targetAdherencePct: 80,
              page: '',
              task: null,
              byReview: false,
            }}
            areas={areaList}
            tasks={tasks}
            ritualNames={ritualNames}
          />
        </Card>
      </Section>
    </div>
  );
}
