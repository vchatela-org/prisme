'use client';

import { Button, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addMeasurement } from '../objective-actions';

/**
 * Append a measurement.
 *
 * The word is "Append", not "Update" or "Record", and the hint says the series
 * cannot be edited. That is not a warning about a limitation — it is the
 * property that makes a trend trustworthy, and stating it at the point of
 * entry is what stops somebody entering a number they intend to correct later.
 *
 * There is no date field. The API stamps the observation with its own clock,
 * so a measurement says when it was *known*, which is the thing a later review
 * needs. A backdatable series is one that always agrees with the story being
 * told about it.
 */
export function MeasurementForm({
  keyResultId,
  objectiveId,
  unit,
}: {
  keyResultId: string;
  objectiveId: string;
  unit: string;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const parsed = value.trim() === '' ? Number.NaN : Number(value);
  const ready = Number.isFinite(parsed);

  const submit = (): void => {
    if (!ready) return;
    startTransition(async () => {
      const result = await addMeasurement({
        keyResultId,
        objectiveId,
        value: parsed,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setValue('');
        setNote('');
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border-hairline pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`measure-${keyResultId}`} className="text-xs">
            New measurement
          </Label>
          <div className="flex items-center gap-1">
            <Input
              id={`measure-${keyResultId}`}
              type="number"
              inputMode="decimal"
              className="w-24 text-right tabular-nums"
              value={value}
              disabled={pending}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <span className="text-xs text-ink-muted">{unit}</span>
          </div>
        </div>

        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor={`note-${keyResultId}`} className="text-xs">
            Note (optional)
          </Label>
          <Input
            id={`note-${keyResultId}`}
            value={note}
            disabled={pending}
            placeholder="What made it move"
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </div>

        <Button size="sm" onClick={submit} disabled={!ready || pending}>
          {pending ? 'Appending…' : 'Append'}
        </Button>
      </div>
      <FieldHint>
        Appended, never edited. A measurement cannot be changed or removed once it is in the series.
      </FieldHint>
    </div>
  );
}
