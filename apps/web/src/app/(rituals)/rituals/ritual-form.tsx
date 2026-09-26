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
import { saveRitual } from './ritual-actions';

export interface RitualDraft {
  readonly id?: string | undefined;
  readonly name: string;
  readonly areaKey: string;
  readonly cadence: 'daily' | 'weekly' | 'monthly';
  readonly targetAdherencePct: number;
  readonly page: string;
}

/** Create a ritual, or change one. The area is fixed once it exists. */
export function RitualForm({
  initial,
  areas,
  onDone,
}: {
  initial: RitualDraft;
  areas: readonly { key: string; name: string }[];
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<RitualDraft>(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const editing = initial.id !== undefined;
  const prefix = initial.id ?? 'new';

  const submit = (): void => {
    startTransition(async () => {
      const result = await saveRitual({ ...draft });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) {
        if (!editing) setDraft({ ...initial, name: '', page: '' });
        onDone?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${prefix}-name`}>Name</Label>
          <Input
            id={`${prefix}-name`}
            value={draft.name}
            maxLength={200}
            placeholder="Weekly review"
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
            }}
          />
        </Field>
        <Field>
          <Label htmlFor={`${prefix}-area`}>Area</Label>
          <Select
            value={draft.areaKey}
            disabled={editing}
            onValueChange={(value) => {
              setDraft({ ...draft, areaKey: value });
            }}
          >
            <SelectTrigger id={`${prefix}-area`}>
              <SelectValue placeholder="Choose an area" />
            </SelectTrigger>
            <SelectContent>
              {areas.map((area) => (
                <SelectItem key={area.key} value={area.key}>
                  {area.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <Label htmlFor={`${prefix}-cadence`}>Cadence</Label>
          <Select
            value={draft.cadence}
            onValueChange={(value) => {
              setDraft({ ...draft, cadence: value as RitualDraft['cadence'] });
            }}
          >
            <SelectTrigger id={`${prefix}-cadence`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <Label htmlFor={`${prefix}-target`}>Target adherence (%)</Label>
          <Input
            id={`${prefix}-target`}
            type="number"
            min={0}
            max={100}
            step={5}
            className="w-28"
            value={String(draft.targetAdherencePct)}
            onChange={(event) => {
              setDraft({ ...draft, targetAdherencePct: Number(event.target.value) });
            }}
          />
        </Field>
      </div>
      <Field>
        <Label htmlFor={`${prefix}-page`}>Process page (optional)</Label>
        <Input
          id={`${prefix}-page`}
          value={draft.page}
          placeholder="Link to the page describing how you do it"
          onChange={(event) => {
            setDraft({ ...draft, page: event.target.value });
          }}
        />
        <FieldHint>
          Its duration property, if <code>DOCTOOL_DURATION_PROPERTY</code> names one, becomes this
          ritual&rsquo;s declared duration for capacity.
        </FieldHint>
      </Field>
      <div>
        <Button
          size="sm"
          disabled={pending || draft.name.trim() === '' || draft.areaKey === ''}
          onClick={submit}
        >
          {pending ? 'Saving…' : editing ? 'Save' : 'Define ritual'}
        </Button>
      </div>
    </div>
  );
}
