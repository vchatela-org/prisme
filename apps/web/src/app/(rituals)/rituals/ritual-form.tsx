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
import type { RecurringTasks } from '@/lib/contracts';
import { ritualTaskChoice } from '@/lib/rituals-view';
import { saveRitual } from './ritual-actions';

/** Radix refuses an empty item value, so "no task" needs a value of its own. */
const NO_TASK = '__none__';
/** The task the ritual has when the tool no longer lists it, shown as the current value. */
const ELSEWHERE = '__elsewhere__';

export interface RitualDraft {
  readonly id?: string | undefined;
  readonly name: string;
  readonly areaKey: string;
  readonly cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  readonly targetAdherencePct: number;
  readonly page: string;
  /** The recurring task it is measured from; null for a habit recorded by hand. */
  readonly task: string | null;
}

/**
 * Create a ritual, or change one. The area is fixed once it exists.
 *
 * Its recurring task is picked from the task tool's open recurring tasks, its
 * own area's first (S2) — the binding adherence is read through. With none, the
 * habit is recorded by hand on its row.
 */
export function RitualForm({
  initial,
  areas,
  tasks,
  ritualNames,
  onDone,
}: {
  initial: RitualDraft;
  areas: readonly { key: string; name: string }[];
  /** `GET /task-tool/recurring-tasks`, or null when it could not be read at all. */
  tasks: RecurringTasks | null;
  ritualNames: Readonly<Record<string, string>>;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<RitualDraft>(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const editing = initial.id !== undefined;
  const prefix = initial.id ?? 'new';
  const choice = ritualTaskChoice(
    { id: initial.id, areaKey: draft.areaKey },
    draft.task,
    tasks,
    (id) => ritualNames[id],
  );

  const submit = (): void => {
    startTransition(async () => {
      const result = await saveRitual({ ...draft });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) {
        if (!editing) setDraft({ ...initial, name: '', page: '', task: null });
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
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
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
      <Field>
        <Label htmlFor={`${prefix}-task`}>Its recurring task</Label>
        {choice.state === 'choose' ? (
          <Select
            value={choice.chosen ?? (choice.elsewhere === null ? NO_TASK : ELSEWHERE)}
            onValueChange={(value) => {
              if (value === ELSEWHERE) return;
              setDraft({ ...draft, task: value === NO_TASK ? null : value });
            }}
          >
            <SelectTrigger id={`${prefix}-task`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choice.elsewhere === null ? null : (
                <SelectItem value={ELSEWHERE} disabled>
                  A task Todoist no longer lists as recurring
                </SelectItem>
              )}
              <SelectItem value={NO_TASK}>None — record it by hand here</SelectItem>
              {choice.options.map((option) => (
                <SelectItem key={option.id} value={option.id} disabled={option.takenBy !== null}>
                  {option.title === '' ? 'Untitled' : option.title}
                  {option.takenBy === null ? '' : ` — held by ${option.takenBy}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <FieldHint>
          {choice.state === 'unreadable'
            ? `Todoist could not be read (${choice.failure}), so the task cannot be chosen now. ${editing ? 'The task this ritual has is kept.' : 'Define it without one and choose it later.'}`
            : 'Adherence counts this task’s completions, from the next daily capacity refresh. Open recurring tasks, this area’s first.'}
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
