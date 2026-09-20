import { Card, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema } from '@/lib/contracts';
import { NewProjectForm } from './project-form';

export const metadata = {
  title: 'New project · prisme',
  description: 'The large-effort shape: a container with ordered subtopics.',
};

export default async function NewProjectPage() {
  const areas = await apiFetch({ path: '/areas', schema: areaListSchema });
  if (!areas.ok) return <ApiFailureState failure={areas} surface="the areas" />;

  const rankable = areas.data.items.filter((area) => area.kind === 'area');
  const areaNames = Object.fromEntries(areas.data.items.map((area) => [area.key, area.name]));

  return (
    <Section
      title="New project"
      description="For a multi-month effort with its own structure — a renovation, an event. Most work needs none of this; an initiative on its own is the common shape."
    >
      <Card className="p-4">
        <NewProjectForm
          areas={rankable.map((area) => ({ key: area.key, name: area.name }))}
          areaNames={areaNames}
        />
      </Card>
    </Section>
  );
}
