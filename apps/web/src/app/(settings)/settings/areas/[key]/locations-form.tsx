'use client';

import { Badge, Button, Card, Field, FieldHint, Input, Label, Section, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import type { SettingsArea, TaskLocations } from '@/lib/contracts';
import { locationKey, nameLocation } from '@/lib/settings-view';
import { saveMappings } from '../../settings-actions';

interface Picked {
  readonly externalProjectId: string;
  readonly externalSectionId: string | null;
}

/**
 * Where this area's work lives in Todoist — picked by name.
 *
 * Three things a person decides here, and the screen says what each does:
 *
 * - **which projects and sections are this area's.** A task completed in any
 *   of them counts toward this area's capacity, and a task labelled for prisme
 *   there is proposed as one of its initiatives. A section beats its project, so
 *   one project can be split between two areas by section.
 * - **which one is home** — where prisme creates new work for the area: an
 *   initiative's task once it reaches `next`, and a quick capture. With none
 *   marked, the most specific location is used.
 * - nothing else: mapping moves nothing in Todoist. It is how prisme reads the
 *   structure you already have.
 */
export function LocationsForm({
  area,
  locations,
  heldBy,
}: {
  area: SettingsArea;
  locations: TaskLocations | null;
  /** Location key → the name of the area that already holds it. */
  heldBy: Readonly<Record<string, string>>;
}) {
  const [picked, setPicked] = useState<readonly Picked[]>(
    area.mappings.map((mapping) => ({
      externalProjectId: mapping.externalProjectId,
      externalSectionId: mapping.externalSectionId,
    })),
  );
  const [home, setHome] = useState<string | null>(() => {
    const marked = area.mappings.find((mapping) => mapping.isHome);
    return marked === undefined
      ? null
      : locationKey(marked.externalProjectId, marked.externalSectionId);
  });
  const [showArchived, setShowArchived] = useState(false);
  const [manualProject, setManualProject] = useState('');
  const [manualSection, setManualSection] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const pickedKeys = useMemo(
    () =>
      new Set(picked.map((entry) => locationKey(entry.externalProjectId, entry.externalSectionId))),
    [picked],
  );

  const toggle = (projectId: string, sectionId: string | null): void => {
    const key = locationKey(projectId, sectionId);
    setPicked((current) =>
      pickedKeys.has(key)
        ? current.filter(
            (entry) => locationKey(entry.externalProjectId, entry.externalSectionId) !== key,
          )
        : [...current, { externalProjectId: projectId, externalSectionId: sectionId }],
    );
    if (pickedKeys.has(key) && home === key) setHome(null);
  };

  const save = (): void => {
    startTransition(async () => {
      const result = await saveMappings({
        key: area.key,
        mappings: picked.map((entry) => ({
          ...entry,
          isHome: locationKey(entry.externalProjectId, entry.externalSectionId) === home,
        })),
      });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  const listed = new Set<string>();
  for (const project of locations?.projects ?? []) {
    listed.add(locationKey(project.id, null));
    for (const section of project.sections) listed.add(locationKey(project.id, section.id));
  }
  const unlisted = picked.filter(
    (entry) => !listed.has(locationKey(entry.externalProjectId, entry.externalSectionId)),
  );

  const projects = (locations?.projects ?? []).filter(
    (project) =>
      showArchived ||
      !project.archived ||
      pickedKeys.has(locationKey(project.id, null)) ||
      project.sections.some((section) => pickedKeys.has(locationKey(project.id, section.id))),
  );
  const archivedCount = (locations?.projects ?? []).filter((project) => project.archived).length;

  const row = (
    projectId: string,
    sectionId: string | null,
    label: string,
    archived: boolean,
    indent: boolean,
  ) => {
    const key = locationKey(projectId, sectionId);
    return (
      <LocationRow
        key={key}
        id={`loc-${key}`}
        label={label}
        archived={archived}
        indent={indent}
        holder={heldBy[key]}
        checked={pickedKeys.has(key)}
        isHome={home === key}
        onToggle={() => {
          toggle(projectId, sectionId);
        }}
        onHome={() => {
          setHome(key);
        }}
      />
    );
  };

  return (
    <Section
      title="Where its work lives in Todoist"
      description="Tick every project or section whose tasks belong to this area. Nothing moves in Todoist: this is how prisme reads the structure you already have."
    >
      <Card className="flex flex-col gap-4">
        {locations === null || locations.failure !== null ? (
          <p className="text-sm text-status-warning">
            Todoist could not be read
            {locations?.failure ? ` (${locations.failure})` : ''}, so projects cannot be listed by
            name. You can still add one by its identifier below.
          </p>
        ) : null}

        {projects.length > 0 ? (
          <ul className="flex max-h-[28rem] flex-col overflow-y-auto">
            {projects.map((project) => (
              <li key={project.id}>
                <ul>
                  {row(
                    project.id,
                    null,
                    project.parentId === null ? project.name : `↳ ${project.name}`,
                    project.archived,
                    false,
                  )}
                  {project.sections.map((section) =>
                    row(project.id, section.id, section.name, section.archived, true),
                  )}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}

        {archivedCount > 0 ? (
          <label className="flex items-center gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => {
                setShowArchived(event.target.checked);
              }}
            />
            Show {String(archivedCount)} archived project{archivedCount === 1 ? '' : 's'}
          </label>
        ) : null}

        {unlisted.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-secondary">Mapped, but not in Todoist’s current list:</p>
            <ul>
              {unlisted.map((entry) => {
                const named = nameLocation(
                  locations,
                  entry.externalProjectId,
                  entry.externalSectionId,
                );
                const key = locationKey(entry.externalProjectId, entry.externalSectionId);
                return (
                  <li key={key} className="flex items-center gap-3 py-1 text-sm">
                    <code>
                      {named.project}
                      {named.section === null ? '' : ` › ${named.section}`}
                    </code>
                    <label className="flex items-center gap-1 text-xs text-ink-secondary">
                      <input
                        type="radio"
                        name="home"
                        checked={home === key}
                        onChange={() => {
                          setHome(key);
                        }}
                      />
                      new work goes here
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        toggle(entry.externalProjectId, entry.externalSectionId);
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer text-ink-secondary">Add by identifier</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field>
              <Label htmlFor="manual-project">Project id</Label>
              <Input
                id="manual-project"
                value={manualProject}
                onChange={(event) => {
                  setManualProject(event.target.value);
                }}
              />
            </Field>
            <Field>
              <Label htmlFor="manual-section">Section id (optional)</Label>
              <Input
                id="manual-section"
                value={manualSection}
                onChange={(event) => {
                  setManualSection(event.target.value);
                }}
              />
            </Field>
            <Button
              variant="secondary"
              size="sm"
              disabled={manualProject.trim() === ''}
              onClick={() => {
                const section = manualSection.trim() === '' ? null : manualSection.trim();
                if (!pickedKeys.has(locationKey(manualProject.trim(), section))) {
                  toggle(manualProject.trim(), section);
                }
                setManualProject('');
                setManualSection('');
              }}
            >
              Add
            </Button>
          </div>
          <FieldHint className="mt-2">
            The identifier is the number at the end of the project’s address in Todoist.
          </FieldHint>
        </details>

        <div className="flex flex-wrap items-center gap-4 border-t border-border-hairline pt-4">
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save locations'}
          </Button>
          <span className="text-xs text-ink-muted">
            {String(picked.length)} location{picked.length === 1 ? '' : 's'}
            {home === null && picked.length > 1
              ? ' · no home chosen: new work goes to the most specific one'
              : ''}
          </span>
        </div>
      </Card>
    </Section>
  );
}

function LocationRow({
  id,
  label,
  archived,
  indent,
  holder,
  checked,
  isHome,
  onToggle,
  onHome,
}: {
  id: string;
  label: string;
  archived: boolean;
  indent: boolean;
  holder: string | undefined;
  checked: boolean;
  isHome: boolean;
  onToggle: () => void;
  onHome: () => void;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-3 py-1 ${indent ? 'pl-6' : ''}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={holder !== undefined}
        onChange={onToggle}
      />
      <label htmlFor={id} className={holder === undefined ? 'text-ink' : 'text-ink-muted'}>
        {label}
      </label>
      {archived ? <Badge variant="outline">archived</Badge> : null}
      {holder === undefined ? null : (
        <span className="text-xs text-ink-muted">belongs to {holder}</span>
      )}
      {checked ? (
        <label className="flex items-center gap-1 text-xs text-ink-secondary">
          <input type="radio" name="home" checked={isHome} onChange={onHome} />
          new work goes here
        </label>
      ) : null}
    </li>
  );
}
