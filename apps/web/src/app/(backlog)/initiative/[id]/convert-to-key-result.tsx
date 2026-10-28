'use client';

import { Button, FieldHint, Input, Label, useToast } from '@prisme/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { convertToKeyResult } from '@/lib/actions';

interface ObjectiveChoice {
  readonly id: string;
  readonly title: string;
  readonly period: string;
  readonly areaName: string;
}

/**
 * *Convert to key result* — docs/19-how-it-works.md S1.
 *
 * For a goal that arrived as an initiative, usually a task labelled in the task
 * tool, when it is really a measurable part of an objective. The panel says
 * what will happen before it happens, because the API does it in one step:
 * the key result is made under the objective chosen, the initiative's task
 * moves to it, and the initiative is dropped with a reason naming what it
 * became. Nothing is written to the task tool.
 *
 * The statement starts as the initiative's title, which is usually the goal's
 * own wording; a key result reads better as a measurable result, so it is
 * editable.
 */
export function ConvertToKeyResult({
  id,
  title,
  hasTask,
  objectives,
}: {
  id: string;
  title: string;
  hasTask: boolean;
  /** Open objectives, its own area first — `conversionObjectives`. */
  objectives: readonly ObjectiveChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [objectiveId, setObjectiveId] = useState(objectives[0]?.id ?? '');
  const [statement, setStatement] = useState(title);
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  if (!open) {
    return (
      <div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          Convert to key result
        </Button>
      </div>
    );
  }

  if (objectives.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border-hairline p-3 text-sm">
        <p className="text-ink">
          A key result belongs to an open objective, and there is none. Write the objective on{' '}
          <Link href="/objectives" className="underline">
            Objectives
          </Link>{' '}
          first.
        </p>
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  const number = Number(target);
  const ready =
    objectiveId !== '' &&
    statement.trim() !== '' &&
    target.trim() !== '' &&
    Number.isFinite(number) &&
    unit.trim() !== '';

  const convert = (): void => {
    startTransition(async () => {
      const result = await convertToKeyResult({ id, objectiveId, statement, target: number, unit });
      toast(
        result.ok
          ? { title: 'Converted to a key result', description: result.message, tone: 'success' }
          : { title: result.title, description: result.description, tone: 'error' },
      );
      if (result.ok) router.push(`/objectives/${encodeURIComponent(objectiveId)}`);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-hairline p-3">
      <p className="text-sm text-ink-secondary">
        The key result is added to the objective you choose
        {hasTask ? ', its task moves to the key result,' : ''} and this initiative is dropped, with
        a reason naming what it became. Nothing is written to Todoist.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor="convert-objective">Objective</Label>
        <select
          id="convert-objective"
          className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
          value={objectiveId}
          disabled={pending}
          onChange={(event) => {
            setObjectiveId(event.target.value);
          }}
        >
          {objectives.map((objective) => (
            <option key={objective.id} value={objective.id}>
              {objective.title} · {objective.period} · {objective.areaName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="convert-statement">Statement</Label>
        <Input
          id="convert-statement"
          value={statement}
          maxLength={500}
          disabled={pending}
          onChange={(event) => {
            setStatement(event.target.value);
          }}
        />
        <FieldHint>A measurable result, the way it will read under the objective.</FieldHint>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="convert-target">Target</Label>
          <Input
            id="convert-target"
            inputMode="decimal"
            value={target}
            disabled={pending}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="convert-unit">Unit</Label>
          <Input
            id="convert-unit"
            value={unit}
            maxLength={50}
            disabled={pending}
            onChange={(event) => {
              setUnit(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !ready} onClick={convert}>
          {pending ? 'Converting…' : 'Convert'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
