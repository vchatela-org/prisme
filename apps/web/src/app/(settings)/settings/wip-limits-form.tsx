'use client';

import { Button, Field, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { WipLimits } from '@/lib/contracts';
import { setWipLimits } from './settings-actions';

/**
 * The work-in-progress limits (ADR-0036): two numbers within the bounds the
 * API reports, the per-area one no larger than the overall one — so the form
 * cannot offer a pair the API would refuse, and the API still refuses it if it
 * arrives anyway.
 */
export function WipLimitsForm({ limits }: { limits: WipLimits }) {
  const [overall, setOverall] = useState(String(limits.maxNow));
  const [perArea, setPerArea] = useState(String(limits.maxNowPerArea));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const maxNow = Number(overall);
  const maxNowPerArea = Number(perArea);
  const within = (value: number, bounds: { min: number; max: number }): boolean =>
    Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
  const valid =
    overall.trim() !== '' &&
    perArea.trim() !== '' &&
    within(maxNow, limits.bounds.maxNow) &&
    within(maxNowPerArea, limits.bounds.maxNowPerArea) &&
    maxNowPerArea <= maxNow;

  const save = (): void => {
    startTransition(async () => {
      const result = await setWipLimits({ maxNow, maxNowPerArea });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save();
      }}
    >
      <Field>
        <Label htmlFor="wip-overall">In flight at once</Label>
        <Input
          id="wip-overall"
          type="number"
          min={limits.bounds.maxNow.min}
          max={limits.bounds.maxNow.max}
          step={1}
          className="w-28"
          value={overall}
          onChange={(event) => {
            setOverall(event.target.value);
          }}
        />
        <FieldHint>
          {String(limits.bounds.maxNow.min)} to {String(limits.bounds.maxNow.max)}
        </FieldHint>
      </Field>
      <Field>
        <Label htmlFor="wip-per-area">Per area</Label>
        <Input
          id="wip-per-area"
          type="number"
          min={limits.bounds.maxNowPerArea.min}
          max={limits.bounds.maxNowPerArea.max}
          step={1}
          className="w-28"
          value={perArea}
          onChange={(event) => {
            setPerArea(event.target.value);
          }}
        />
        <FieldHint>
          {maxNowPerArea > maxNow ? 'No more than the overall limit' : 'At most the overall limit'}
        </FieldHint>
      </Field>
      <Button type="submit" disabled={pending || !valid}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
