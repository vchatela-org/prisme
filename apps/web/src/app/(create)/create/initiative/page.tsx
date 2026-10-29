import { Card, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  objectivePageSchema,
  pageTemplatesSchema,
  projectListSchema,
} from '@/lib/contracts';
import { keyResultChoices } from '@/lib/nudge-view';
import { NewInitiativeForm } from './initiative-form';

export const metadata = {
  title: 'New initiative · prisme',
  description: 'An outcome you could finish in one to six weeks, scored as it is created.',
};

/** Generous: projects are a handful, and paging a dropdown is a decision nobody wants. */
const PROJECT_LIMIT = 200;

/** The most objectives one page of the API returns; a person's open ones are far fewer. */
const OBJECTIVE_LIMIT = 200;

/**
 * The new-initiative flow, optionally opened **pre-filled**: `?area=` from a
 * starved-area notice, `?objective=&keyResult=` from a key result's *Create an
 * initiative that serves this*. A preset that names nothing known is dropped
 * rather than refused — the form still works, it just starts blank.
 */
export default async function NewInitiativePage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; objective?: string; keyResult?: string }>;
}) {
  const preset = await searchParams;
  const [areas, projects, templates, objectives] = await Promise.all([
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({
      path: '/projects',
      query: { limit: String(PROJECT_LIMIT) },
      schema: projectListSchema,
    }),
    // What a new initiative page can start from (ADR-0030). Advisory: a failed
    // read shows no choice, and the request asks for the default.
    apiFetch({ path: '/page-kinds/initiative/templates', schema: pageTemplatesSchema }),
    // What the new initiative may serve. Advisory: a failed read offers no
    // key result, and the initiative is created serving none.
    apiFetch({
      path: '/objectives',
      query: { limit: String(OBJECTIVE_LIMIT) },
      schema: objectivePageSchema,
    }),
  ]);

  if (!areas.ok) return <ApiFailureState failure={areas} surface="the areas" />;

  const rankable = areas.data.items.filter((area) => area.kind === 'area');
  const areaNames = Object.fromEntries(areas.data.items.map((area) => [area.key, area.name]));

  const rankableKeys = new Set(rankable.map((area) => area.key));
  const keyResults = (objectives.ok ? keyResultChoices(objectives.data.items) : []).filter(
    (choice) => rankableKeys.has(choice.areaKey),
  );
  // A key result fixes the area: work serves the objectives of its own area.
  const presetKeyResult = keyResults.find(
    (choice) => choice.id === preset.keyResult && choice.objectiveId === preset.objective,
  );
  const presetArea =
    presetKeyResult?.areaKey ??
    (preset.area !== undefined && rankableKeys.has(preset.area) ? preset.area : undefined);

  return (
    <Section
      title="New initiative"
      description="An outcome you could finish in one to six weeks. Anything bigger is sliced, and the slice is what gets scored."
    >
      <Card className="p-4">
        <NewInitiativeForm
          areas={rankable.map((area) => ({ key: area.key, name: area.name }))}
          projects={
            projects.ok
              ? projects.data.items
                  .filter((project) => project.status === 'active')
                  .map((project) => ({ id: project.id, name: project.name }))
              : []
          }
          areaNames={areaNames}
          pageTemplates={templates.ok ? templates.data : null}
          keyResults={keyResults}
          {...(presetArea === undefined ? {} : { initialAreaKey: presetArea })}
          {...(presetKeyResult === undefined ? {} : { initialKeyResultId: presetKeyResult.id })}
        />
      </Card>
    </Section>
  );
}
