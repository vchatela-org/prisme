'use client';

import { Button, Card, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { captureThing } from '../../create-actions';

export interface AreaChoice {
  readonly key: string;
  readonly name: string;
  /** False when the area is mapped nowhere: a capture cannot be filed there. */
  readonly mapped: boolean;
}

/**
 * Quick capture — a small thing, in under ten seconds.
 *
 * ## What is deliberately not on this form
 *
 * No estimates, no status, no deadline, no project. Every one of them is a
 * decision, and the decision is what people avoid by not capturing at all.
 * The brief's target is ten seconds with *decisions deferred*, and each field
 * added here is a second spent and a reason to close the dialog.
 *
 * The area is the one exception, and it is not really a decision: a task has
 * to go somewhere in the task tool, prisme learns where from the area mapping,
 * and an unmapped area has no honest answer. So it is pre-selected and one
 * keystroke away.
 *
 * ## Enter submits, and the field keeps focus
 *
 * Capture is a burst activity — three things arrive at once — so submitting
 * clears the box and leaves the cursor in it rather than navigating away. The
 * toast is the confirmation; the screen does not move.
 *
 * ## The copy does not claim a task exists
 *
 * It says the task appears on the next pass, because it does: this writes
 * prisme rows and a ledger entry, and the converge pass makes the object. A
 * person who opens their task tool expecting it and finds nothing has been
 * lied to by a message, which is worse than waiting.
 */
export function CaptureForm({
  areas,
  autoFocus = true,
  onCaptured,
}: {
  areas: readonly AreaChoice[];
  autoFocus?: boolean;
  /** Called after a successful capture — the dialog closes itself with it. */
  onCaptured?: () => void;
}) {
  const mapped = areas.filter((area) => area.mapped);
  const [title, setTitle] = useState('');
  const [areaKey, setAreaKey] = useState(mapped[0]?.key ?? '');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const ready = title.trim() !== '' && areaKey !== '' && !pending;

  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await captureThing({ title: title.trim(), areaKey });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setTitle('');
        field.current?.focus();
        router.refresh();
        onCaptured?.();
      }
    });
  };

  if (mapped.length === 0) {
    return (
      <Card className="p-4 text-sm text-ink-secondary">
        No area is mapped to a location in the task tool, so a capture has nowhere to go. Map one
        first — prisme works against the structure you already have rather than reorganising it.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="capture-title">What arrived?</Label>
        <Input
          id="capture-title"
          ref={field}
          value={title}
          disabled={pending}
          placeholder="One line. Decide what it is later."
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <FieldHint>
          It becomes a task and stays one. Not everything is an initiative — promote it later if it
          turns out to be.
        </FieldHint>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="capture-area">Area</Label>
          <select
            id="capture-area"
            className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
            value={areaKey}
            disabled={pending}
            onChange={(event) => {
              setAreaKey(event.target.value);
            }}
          >
            {mapped.map((area) => (
              <option key={area.key} value={area.key}>
                {area.name}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={submit} disabled={!ready}>
          {pending ? 'Capturing…' : 'Capture'}
        </Button>
      </div>

      {areas.length > mapped.length ? (
        <p className="text-xs text-ink-tertiary">
          {String(areas.length - mapped.length)} area
          {areas.length - mapped.length === 1 ? ' is' : 's are'} missing from this list because
          nothing maps them to a location in the task tool.
        </p>
      ) : null}
    </div>
  );
}
