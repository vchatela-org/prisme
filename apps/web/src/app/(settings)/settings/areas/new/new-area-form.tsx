'use client';

import { Button, Card, Field, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AREA_KEY_PATTERN, keyFromName } from '@/lib/settings-view';
import { createArea } from '../../settings-actions';
import { ColourPicker } from '../colour-picker';

type Kind = 'area' | 'run' | 'signals';

export function NewAreaForm({
  takenBy,
  hasRun,
  hasSignals,
}: {
  takenBy: Readonly<Record<number, readonly string[]>>;
  hasRun: boolean;
  hasSignals: boolean;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [kind, setKind] = useState<Kind>('area');
  const [colorSlot, setColorSlot] = useState<number | null>(null);
  const [budget, setBudget] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const effectiveKey = keyTouched ? key : keyFromName(name);
  const keyValid = AREA_KEY_PATTERN.test(effectiveKey);

  const submit = (): void => {
    startTransition(async () => {
      const result = await createArea({
        key: effectiveKey,
        name,
        kind,
        colorSlot: kind === 'area' ? colorSlot : null,
        runBudgetHoursPerWeek: kind === 'run' && budget.trim() !== '' ? Number(budget) : null,
      });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.push(`/settings/areas/${encodeURIComponent(effectiveKey)}`);
    });
  };

  return (
    <Card className="flex max-w-2xl flex-col gap-5">
      <Field>
        <Label htmlFor="new-name">Name</Label>
        <Input
          id="new-name"
          value={name}
          maxLength={200}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </Field>

      <Field>
        <Label htmlFor="new-key">Key</Label>
        <Input
          id="new-key"
          value={effectiveKey}
          maxLength={64}
          onChange={(event) => {
            setKeyTouched(true);
            setKey(event.target.value);
          }}
        />
        <FieldHint>
          A permanent internal name: lower-case letters, digits and dashes. It can never change,
          because every weight and measurement is stored against it. The name can.
        </FieldHint>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Kind</legend>
        {(
          [
            [
              'area',
              'Area',
              'Gets a yearly share of your capacity; its initiatives are ranked against each other.',
              false,
            ],
            [
              'run',
              'Run lane',
              'Upkeep — chores, admin. Budgeted in hours per week, never ranked.',
              hasRun,
            ],
            [
              'signals',
              'Signals lane',
              'Machine-generated notifications. Counted, never ranked.',
              hasSignals,
            ],
          ] as const
        ).map(([value, label, hint, exists]) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              className="mt-1"
              checked={kind === value}
              disabled={exists}
              onChange={() => {
                setKind(value);
              }}
            />
            <span>
              <span className="text-ink">{label}</span>{' '}
              <span className="text-ink-secondary">
                — {hint}
                {exists ? ' (this instance already has one)' : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === 'area' ? (
        <ColourPicker
          value={colorSlot}
          automatic={null}
          takenBy={takenBy}
          onChange={setColorSlot}
        />
      ) : null}

      {kind === 'run' ? (
        <Field>
          <Label htmlFor="new-budget">Hours per week for upkeep</Label>
          <Input
            id="new-budget"
            type="number"
            min={0}
            max={168}
            step={0.5}
            className="w-32"
            value={budget}
            onChange={(event) => {
              setBudget(event.target.value);
            }}
          />
        </Field>
      ) : null}

      <div>
        <Button onClick={submit} disabled={pending || name.trim() === '' || !keyValid}>
          {pending ? 'Creating…' : 'Create and choose its locations'}
        </Button>
      </div>
    </Card>
  );
}
