'use client';

import { Button, Card, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ObjectiveType } from '@/lib/contracts';
import { authorObjective } from './objective-actions';

export interface AreaChoice {
  readonly key: string;
  readonly name: string;
}

/**
 * Authoring an objective.
 *
 * ## The period is offered, not typed free
 *
 * Choosing the type sets the period to the one that objective would be
 * authored for — this year for an annual, next month for a monthly. The field
 * stays editable, because authoring next year's objectives in December is a
 * real thing to do, but the default is the common case and the pairing rule
 * is enforced before the round trip rather than arriving back as a 400.
 *
 * The period cannot be changed afterwards. The form says so where the field
 * is, not in a confirmation dialog after the fact: an objective that moves
 * between months is a different objective, and attainment history depends on
 * that being true.
 *
 * ## No key result here
 *
 * The objective is created empty and the detail page adds key results. Two
 * things are being decided — what the period is for, and how you would know
 * it happened — and a single form that collects both encourages inventing a
 * measure to get past the required field.
 */
export function AuthorObjectiveForm({
  areas,
  annualPeriod,
  monthlyPeriod,
}: {
  areas: readonly AreaChoice[];
  annualPeriod: string;
  monthlyPeriod: string;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ObjectiveType>('monthly');
  const [period, setPeriod] = useState(monthlyPeriod);
  const [areaKey, setAreaKey] = useState(areas[0]?.key ?? '');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const chooseType = (next: ObjectiveType): void => {
    setType(next);
    setPeriod(next === 'annual' ? annualPeriod : monthlyPeriod);
  };

  const ready = title.trim() !== '' && areaKey !== '' && period.trim() !== '';

  const submit = (): void => {
    startTransition(async () => {
      const result = await authorObjective({
        title: title.trim(),
        type,
        period: period.trim(),
        areaKey,
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setTitle('');
        router.refresh();
      }
    });
  };

  if (areas.length === 0) {
    return (
      <Card className="p-4 text-sm text-ink-secondary">
        An objective belongs to an area, and there are none yet.
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="objective-title">What is this period for?</Label>
        <Input
          id="objective-title"
          value={title}
          disabled={pending}
          placeholder="An outcome, in the words you would use to explain it"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="objective-type">Type</Label>
          <select
            id="objective-type"
            className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
            value={type}
            disabled={pending}
            onChange={(event) => {
              chooseType(event.target.value === 'annual' ? 'annual' : 'monthly');
            }}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="objective-period">Period</Label>
          <Input
            id="objective-period"
            className="w-32 tabular-nums"
            value={period}
            disabled={pending}
            placeholder={type === 'annual' ? '2026' : '2026-03'}
            onChange={(event) => {
              setPeriod(event.target.value);
            }}
          />
          <FieldHint>
            {type === 'annual' ? 'A year, as 2026.' : 'A month, as 2026-03.'} Fixed once it exists.
          </FieldHint>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="objective-area">Area</Label>
          <select
            id="objective-area"
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
        </div>
      </div>

      <div>
        <Button onClick={submit} disabled={!ready || pending}>
          {pending ? 'Authoring…' : 'Author objective'}
        </Button>
      </div>
    </Card>
  );
}
