import { Card, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema, pageTemplatesSchema, projectListSchema } from '@/lib/contracts';
import { NewInitiativeForm } from './initiative-form';

export const metadata = {
  title: 'New initiative · prisme',
  description: 'An outcome you could finish in one to six weeks, scored as it is created.',
};

/** Generous: projects are a handful, and paging a dropdown is a decision nobody wants. */
const PROJECT_LIMIT = 200;

export default async function NewInitiativePage() {
  const [areas, projects, templates] = await Promise.all([
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({
      path: '/projects',
      query: { limit: String(PROJECT_LIMIT) },
      schema: projectListSchema,
    }),
    // What a new initiative page can start from (ADR-0030). Advisory: a failed
    // read shows no choice, and the request asks for the default.
    apiFetch({ path: '/page-kinds/initiative/templates', schema: pageTemplatesSchema }),
  ]);

  if (!areas.ok) return <ApiFailureState failure={areas} surface="the areas" />;

  const rankable = areas.data.items.filter((area) => area.kind === 'area');
  const areaNames = Object.fromEntries(areas.data.items.map((area) => [area.key, area.name]));

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
        />
      </Card>
    </Section>
  );
}
