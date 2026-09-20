'use client';

import {
  Button,
  Card,
  FibonacciSelect,
  FieldHint,
  Input,
  Label,
  useToast,
  type Fibonacci,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createInitiative } from '../../create-actions';
import { PageChoice, type PageDecision } from '../../page-choice';
import { SearchBeforeCreate } from '../../search-before-create';

export interface AreaChoice {
  readonly key: string;
  readonly name: string;
}

export interface ProjectChoice {
  readonly id: string;
  readonly name: string;
}

type EstimateKey = 'value' | 'timeCriticality' | 'risk' | 'size';

/**
 * The four inputs, with the sentence that distinguishes each from the others.
 *
 * The hints are the same ones `components/estimate-editor.tsx` uses, so
 * re-estimating on the detail page reads as the same question being asked
 * again rather than as a different one.
 */
const ESTIMATES: readonly {
  key: EstimateKey;
  label: string;
  hint: string;
  sliceAbove?: Fibonacci;
}[] = [
  { key: 'value', label: 'Value', hint: 'What it is worth if it lands.' },
  { key: 'timeCriticality', label: 'Time criticality', hint: 'How fast that value decays.' },
  { key: 'risk', label: 'Risk / opportunity', hint: 'What it unlocks or removes.' },
  {
    key: 'size',
    label: 'Size',
    hint: 'The next slice, on the same scale as everything else. Above 8, slice it.',
    sliceAbove: 8,
  },
];

/**
 * A new initiative, **scored here**.
 *
 * The four estimates are required rather than optional, and that is the one
 * decision this form is really about. The brief: "scoring inline at creation,
 * because a score assigned later is a score never assigned". An optional
 * estimate would produce exactly the "missing score" backlog the previous
 * system accumulated — items sitting in the inbox indefinitely because
 * nothing ever forced the judgement.
 *
 * ## Deadline, never `due`
 *
 * There is one date field and it is a **deadline**: a hard external
 * constraint that prioritizes. There is nowhere here for a `due` date and
 * there never will be — the task tool owns that, and a field offering it
 * would be prisme quietly taking ownership (ADR-0003).
 *
 * ## The anchor is not asked for
 *
 * Nothing on this form mentions the task tool. The reconciler creates the
 * anchor on its next pass, from `origin = created_in_prisme AND
 * external_anchor_id IS NULL` (ADR-0010 guard 2). A control here would be a
 * second system deciding to make one task.
 */
export function NewInitiativeForm({
  areas,
  projects,
  areaNames,
}: {
  areas: readonly AreaChoice[];
  projects: readonly ProjectChoice[];
  areaNames: Readonly<Record<string, string>>;
}) {
  const [title, setTitle] = useState('');
  const [areaKey, setAreaKey] = useState(areas[0]?.key ?? '');
  const [projectId, setProjectId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [estimates, setEstimates] = useState<Record<EstimateKey, Fibonacci>>({
    value: 3,
    timeCriticality: 3,
    risk: 3,
    size: 3,
  });
  const [page, setPage] = useState<PageDecision>({ mode: 'none' });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const ready = title.trim() !== '' && areaKey !== '' && !pending;

  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await createInitiative({
        title: title.trim(),
        areaKey,
        value: estimates.value,
        timeCriticality: estimates.timeCriticality,
        risk: estimates.risk,
        size: estimates.size,
        page,
        ...(projectId === '' ? {} : { projectId }),
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
        An initiative belongs to exactly one area, and there are none yet.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="initiative-title">What will be true when this is done?</Label>
        <Input
          id="initiative-title"
          value={title}
          disabled={pending}
          placeholder="Fence replaced — a result, not an activity"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <FieldHint>
          Phrase it as a result. An activity has no completion condition, which is how something
          stays open for two years.
        </FieldHint>
      </div>

      <SearchBeforeCreate title={title} areaNames={areaNames} />

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="initiative-area">Area</Label>
          <select
            id="initiative-area"
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
          <FieldHint>Exactly one. Two would break capacity accounting.</FieldHint>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="initiative-project">Project</Label>
          <select
            id="initiative-project"
            className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
            value={projectId}
            disabled={pending}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <FieldHint>Optional. Most initiatives have none.</FieldHint>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="initiative-deadline">Deadline</Label>
          <Input
            id="initiative-deadline"
            type="date"
            className="w-44"
            value={deadline}
            disabled={pending}
            onChange={(event) => {
              setDeadline(event.target.value);
            }}
          />
          <FieldHint>
            Hard constraints only. A deadline prioritizes; when you intend to work on it is the task
            tool’s to say.
          </FieldHint>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">Score it now</span>
          <span className="text-sm text-ink-secondary">
            Relative to the rest of the backlog, not absolute. A score assigned later is a score
            never assigned.
          </span>
        </div>

        {/*
          Each selector carries a **visible** label, not only an `aria-label`.
          `FibonacciSelect` renders its `label` prop to assistive technology
          and nothing on screen, so four of them stacked are four identical
          rows of `1 2 3 5 8 13` — found by looking at the built page, and
          invisible to every check in the repository.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          {ESTIMATES.map(({ key, label, hint, sliceAbove }) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">{label}</span>
              <FibonacciSelect
                label={label}
                value={estimates[key]}
                onValueChange={(next) => {
                  setEstimates((current) => ({ ...current, [key]: next }));
                }}
                disabled={pending}
                {...(sliceAbove === undefined ? {} : { sliceAbove })}
              />
              <p className="text-xs text-ink-muted">{hint}</p>
            </div>
          ))}
        </div>
      </div>

      <PageChoice value={page} onChange={setPage} disabled={pending} />

      <div>
        <Button onClick={submit} disabled={!ready}>
          {pending ? 'Creating…' : 'Create initiative'}
        </Button>
      </div>
    </div>
  );
}
