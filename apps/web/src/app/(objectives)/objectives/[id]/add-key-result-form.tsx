'use client';

import { Button, Card, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { unitLooksLikeARate } from '@/lib/objectives-view';
import { addKeyResult } from '../objective-actions';

/**
 * Add a key result.
 *
 * ## The Ritual question is asked while the unit is being typed
 *
 * ADR-0012 puts the habit-or-outcome distinction at authoring time, and this
 * is that moment. As soon as the unit reads like a rate — `sessions/week`,
 * `3 a month` — the form says so, in place, before the thing exists.
 *
 * It does not block. A key result can legitimately be measured in a rate, and
 * a form that refused one would simply teach people to write `sessions` and
 * mean `sessions per week`. What cannot happen is the question never being
 * put: a habit recorded as a key result is a target never reached and an
 * adherence measure nobody has.
 */
export function AddKeyResultForm({
  objectiveId,
  subObjectives = [],
}: {
  objectiveId: string;
  /** The sub-objectives its key results already use, offered as suggestions (ADR-0039). */
  subObjectives?: readonly string[];
}) {
  const [statement, setStatement] = useState('');
  const [subObjective, setSubObjective] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const parsedTarget = target.trim() === '' ? Number.NaN : Number(target);
  const ready = statement.trim() !== '' && unit.trim() !== '' && Number.isFinite(parsedTarget);

  // The same predicate the list page reads, against the unit as typed — so the
  // question asked here is the one that would be asked a month later.
  const rateLike = unit.trim() !== '' && unitLooksLikeARate(unit);

  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await addKeyResult({
        objectiveId,
        statement: statement.trim(),
        ...(subObjective.trim() === '' ? {} : { subObjective: subObjective.trim() }),
        target: parsedTarget,
        unit: unit.trim(),
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setStatement('');
        setSubObjective('');
        setTarget('');
        setUnit('');
        router.refresh();
      }
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="kr-statement">How would you know this happened?</Label>
        <Input
          id="kr-statement"
          value={statement}
          disabled={pending}
          placeholder="An observable outcome, not an activity"
          onChange={(event) => {
            setStatement(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="kr-sub-objective">Sub-objective (optional)</Label>
        <Input
          id="kr-sub-objective"
          value={subObjective}
          disabled={pending}
          list="kr-sub-objectives"
          placeholder="The group it belongs to, as its task in Todoist reads"
          onChange={(event) => {
            setSubObjective(event.target.value);
          }}
        />
        <datalist id="kr-sub-objectives">
          {subObjectives.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <FieldHint>
          Its task is made beneath the objective task’s subtask that reads the same, so the
          statement need not repeat it.
        </FieldHint>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="kr-target">Target</Label>
          <Input
            id="kr-target"
            type="number"
            inputMode="decimal"
            className="w-28 text-right tabular-nums"
            value={target}
            disabled={pending}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="kr-unit">Unit</Label>
          <Input
            id="kr-unit"
            className="w-48"
            value={unit}
            disabled={pending}
            placeholder="what is counted"
            onChange={(event) => {
              setUnit(event.target.value);
            }}
          />
          {rateLike ? (
            <FieldHint>
              That unit is a rate, which usually means a habit rather than an outcome — and a habit
              belongs in the Ritual lane, where adherence is measured. You can still add it; the
              question is only worth asking once (ADR-0012).
            </FieldHint>
          ) : null}
        </div>
      </div>

      <div>
        <Button onClick={submit} disabled={!ready || pending}>
          {pending ? 'Adding…' : 'Add key result'}
        </Button>
      </div>
    </Card>
  );
}
