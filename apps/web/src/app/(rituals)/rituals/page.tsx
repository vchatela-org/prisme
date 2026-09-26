import { Card, EmptyState, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema, ritualListSchema } from '@/lib/contracts';
import { pageUrl } from '@/lib/page-link';
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
 * one.
 */
export default async function RitualsPage() {
  const [rituals, areas] = await Promise.all([
    apiFetch({ path: '/rituals', schema: ritualListSchema }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
  ]);
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
          against initiatives; the KPI dashboard measures how often they actually happen.
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
                  }}
                  areaName={nameOf.get(ritual.areaKey) ?? ritual.areaKey}
                  latestAdherencePct={ritual.latestAdherencePct}
                  pageHref={pageUrl(template, ritual.externalPageId) ?? null}
                  areas={areaList}
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
            }}
            areas={areaList}
          />
        </Card>
      </Section>
    </div>
  );
}
