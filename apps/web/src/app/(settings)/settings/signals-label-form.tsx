'use client';

import {
  Button,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SignalsLabel } from '@/lib/contracts';
import { setSignalsLabel } from './settings-actions';

/**
 * The Signals lane label (ADR-0041): a label name and the Signals lane it puts
 * work in. The lane is chosen from the instance's Signals lanes, preselected
 * when there is only one; with none, the form says to create one rather than
 * offering a choice the API would refuse.
 */
export function SignalsLabelForm({ setting }: { setting: SignalsLabel }) {
  const onlyLane = setting.lanes.length === 1 ? (setting.lanes[0]?.key ?? '') : '';
  const [label, setLabel] = useState(setting.label ?? '');
  const [areaKey, setAreaKey] = useState(setting.areaKey ?? onlyLane);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const run = (input: Parameters<typeof setSignalsLabel>[0]): void => {
    startTransition(async () => {
      const result = await setSignalsLabel(input);
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  if (setting.lanes.length === 0) {
    return (
      <p className="max-w-prose text-sm text-ink-secondary">
        There is no Signals lane yet. Create one from <em>New area</em>, as the Signals lane, before
        choosing a label for it.
      </p>
    );
  }

  const valid = label.trim() !== '' && areaKey !== '';

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) run({ label: label.trim(), areaKey });
      }}
    >
      <Field>
        <Label htmlFor="signals-label">Label</Label>
        <Input
          id="signals-label"
          className="w-48"
          maxLength={100}
          placeholder="none"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />
        <FieldHint>As your automations write it in Todoist</FieldHint>
      </Field>
      <Field>
        <Label htmlFor="signals-lane">Signals lane</Label>
        <Select value={areaKey} onValueChange={setAreaKey}>
          <SelectTrigger id="signals-lane" className="w-48" aria-label="Signals lane">
            <SelectValue placeholder="a Signals lane" />
          </SelectTrigger>
          <SelectContent>
            {setting.lanes.map((lane) => (
              <SelectItem key={lane.key} value={lane.key}>
                {lane.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldHint>Where labelled work is counted</FieldHint>
      </Field>
      <Button type="submit" disabled={pending || !valid}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      {setting.label === null ? null : (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            run({ label: null });
          }}
        >
          Turn off
        </Button>
      )}
    </form>
  );
}
