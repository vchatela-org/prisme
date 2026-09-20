'use client';

import { Button, Card, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { parseSections } from '@/lib/create-view';
import { createProject } from '../../create-actions';
import { PageChoice, type PageDecision } from '../../page-choice';
import { SearchBeforeCreate } from '../../search-before-create';

export interface AreaChoice {
  readonly key: string;
  readonly name: string;
}

/**
 * A new project — the large-effort shape (ADR-0019).
 *
 * ## Sections are a text box, one per line
 *
 * Rather than a repeater with add and remove buttons. Somebody listing the
 * parts of a renovation types six lines in ten seconds and reorders them by
 * editing text; the repeater is the more obvious control and is slower at the
 * only thing it is for. A duplicate name is refused rather than deduplicated
 * quietly — two sections with one name are two places to put the same work,
 * and prisme could not tell them apart afterwards.
 *
 * ## The structure is asked for explicitly, in three states
 *
 * Creating a project in prisme and creating one in the task tool are separate
 * decisions, because a large effort often already *has* a project there. So
 * the control is the same three states the page has: none, create, link.
 * Linking creates nothing (ADR-0010) and the copy says so at the moment of
 * choosing.
 *
 * ## Nothing here is atomic, and the form says that too
 *
 * A project, a page and one section per subtopic is up to eight writes across
 * three systems with no transaction between them. The submit records all of
 * them in prisme in one transaction and the converge pass makes the objects
 * one at a time; the ledger is where you watch it, and the success message
 * sends you there rather than implying it is all done.
 */
export function NewProjectForm({
  areas,
  areaNames,
}: {
  areas: readonly AreaChoice[];
  areaNames: Readonly<Record<string, string>>;
}) {
  const [name, setName] = useState('');
  const [areaKey, setAreaKey] = useState(areas[0]?.key ?? '');
  const [deadline, setDeadline] = useState('');
  const [sectionText, setSectionText] = useState('');
  const [taskProject, setTaskProject] = useState<PageDecision>({ mode: 'create' });
  const [page, setPage] = useState<PageDecision>({ mode: 'none' });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const parsed = parseSections(sectionText);
  const ready = name.trim() !== '' && areaKey !== '' && parsed.duplicate === undefined && !pending;

  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await createProject({
        name: name.trim(),
        areaKey,
        sections: [...parsed.sections],
        taskProject,
        page,
        ...(deadline === '' ? {} : { deadline }),
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok && result.href !== undefined) router.push(result.href);
    });
  };

  if (areas.length === 0) {
    return (
      <Card className="p-4 text-sm text-ink-secondary">
        A project belongs to exactly one area, and there are none yet.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="project-name">What is the effort?</Label>
        <Input
          id="project-name"
          value={name}
          disabled={pending}
          placeholder="A multi-month effort, not a single outcome"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <FieldHint>
          A project is a container, not a scored unit. The initiatives inside it are what get
          ranked.
        </FieldHint>
      </div>

      <SearchBeforeCreate title={name} areaNames={areaNames} />

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="project-area">Area</Label>
          <select
            id="project-area"
            className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
            value={areaKey}
            disabled={pending}
            onChange={(event) => {
              setAreaKey(event.target.value);
            }}
          >
            {areas.map((area) => (
              <option key={area.key} value={area.key}>
                {area.name}
              </option>
            ))}
          </select>
          <FieldHint>One area. Its whole capacity counts toward that one.</FieldHint>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="project-deadline">Deadline</Label>
          <Input
            id="project-deadline"
            type="date"
            className="w-44"
            value={deadline}
            disabled={pending}
            onChange={(event) => {
              setDeadline(event.target.value);
            }}
          />
          <FieldHint>Optional, and a hard constraint when present.</FieldHint>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="project-sections">Subtopics</Label>
        <textarea
          id="project-sections"
          rows={6}
          className="rounded-md border border-border-strong bg-surface-raised px-2 py-1.5 text-sm text-ink"
          value={sectionText}
          disabled={pending}
          placeholder={'One per line\nThey become sections, in this order'}
          onChange={(event) => {
            setSectionText(event.target.value);
          }}
        />
        {parsed.duplicate === undefined ? (
          <FieldHint>
            {parsed.sections.length === 0
              ? 'Optional. They become sections in the task tool, in the order written.'
              : `${String(parsed.sections.length)} section${parsed.sections.length === 1 ? '' : 's'}, in this order.`}
          </FieldHint>
        ) : (
          <FieldHint tone="error">
            “{parsed.duplicate}” appears twice. Two sections with one name are two places to put the
            same work, and prisme cannot tell them apart afterwards.
          </FieldHint>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Project in the task tool</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['none', 'create', 'link'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                name="task-project-mode"
                value={mode}
                checked={taskProject.mode === mode}
                disabled={pending}
                onChange={() => {
                  setTaskProject(mode === 'link' ? { mode: 'link', externalId: '' } : { mode });
                }}
              />
              <span>
                {mode === 'none'
                  ? 'None'
                  : mode === 'create'
                    ? 'Create one with these sections'
                    : 'Link one I have'}
              </span>
            </label>
          ))}
        </div>

        {taskProject.mode === 'link' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-project-external">The project’s identifier</Label>
            <Input
              id="task-project-external"
              value={taskProject.externalId}
              disabled={pending}
              placeholder="From the task tool"
              onChange={(event) => {
                setTaskProject({ mode: 'link', externalId: event.target.value });
              }}
            />
            <FieldHint>
              Binds a project that already exists and creates nothing. The subtopics above are still
              created inside it — linking says the project exists, not that its sections do.
            </FieldHint>
          </div>
        ) : null}

        {taskProject.mode === 'create' ? (
          <FieldHint>
            The project and its sections are made one at a time by the converge pass, in order. If
            one fails the rest are still recorded — nothing is rolled back and nothing is orphaned.
          </FieldHint>
        ) : null}
      </fieldset>

      <PageChoice value={page} onChange={setPage} disabled={pending} subject="project" />

      <div>
        <Button onClick={submit} disabled={!ready}>
          {pending ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </div>
  );
}
