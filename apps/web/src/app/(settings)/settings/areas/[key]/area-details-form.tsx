'use client';

import { Button, Card, Field, FieldHint, Input, Label, Section, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SettingsArea } from '@/lib/contracts';
import { updateArea } from '../../settings-actions';
import { ColourPicker } from '../colour-picker';

/**
 * Name, colour, active, and the Run lane's weekly budget.
 *
 * Deactivating is the way to retire an area: it disappears from ranking and
 * from the Year Review, and everything measured against it stays. There is no
 * delete, on purpose — a deleted area would orphan every score and capacity
 * week that names its key.
 */
export function AreaDetailsForm({
  area,
  currentSlot,
  takenBy,
}: {
  area: SettingsArea;
  currentSlot: number | null;
  takenBy: Readonly<Record<number, readonly string[]>>;
}) {
  const [name, setName] = useState(area.name);
  const [active, setActive] = useState(area.active);
  const [colorSlot, setColorSlot] = useState<number | null>(area.colorSlot);
  const [budget, setBudget] = useState(
    area.runBudgetHoursPerWeek === null ? '' : String(area.runBudgetHoursPerWeek),
  );
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const save = (): void => {
    startTransition(async () => {
      const result = await updateArea({
        key: area.key,
        name,
        active,
        colorSlot,
        ...(area.kind === 'run'
          ? { runBudgetHoursPerWeek: budget.trim() === '' ? null : Number(budget) }
          : {}),
      });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  return (
    <Section title="Name and colour">
      <Card className="flex flex-col gap-5">
        <Field>
          <Label htmlFor="area-name">Name</Label>
          <Input
            id="area-name"
            value={name}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <FieldHint>Shown on every screen. Renaming changes nothing else.</FieldHint>
        </Field>

        {area.kind === 'area' ? (
          <ColourPicker
            value={colorSlot}
            automatic={area.colorSlot === null ? currentSlot : null}
            takenBy={takenBy}
            onChange={setColorSlot}
          />
        ) : (
          <p className="text-sm text-ink-secondary">
            Lanes are drawn in grey on purpose: they are context, not competitors for your time.
          </p>
        )}

        {area.kind === 'run' ? (
          <Field>
            <Label htmlFor="area-budget">Hours per week for upkeep</Label>
            <Input
              id="area-budget"
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
            <FieldHint>The Run lane is budgeted in hours, not as a share of capacity.</FieldHint>
          </Field>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => {
              setActive(event.target.checked);
            }}
          />
          Active
          <span className="text-ink-secondary">
            — an inactive area is left out of ranking and of the Year Review; its history stays.
          </span>
        </label>

        <div>
          <Button onClick={save} disabled={pending || name.trim() === ''}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>
    </Section>
  );
}
