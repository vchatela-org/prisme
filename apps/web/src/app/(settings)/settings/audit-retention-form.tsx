'use client';

import { Button, Field, FieldHint, Input, Label, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AuditRetention } from '@/lib/contracts';
import { setAuditRetention } from './settings-actions';

/**
 * The retention window of the write audit (ADR-0031): one number, in days,
 * within the bounds the API reports — so the form cannot offer a value the
 * API would refuse, and the API still refuses it if it arrives anyway.
 */
export function AuditRetentionForm({ retention }: { retention: AuditRetention }) {
  const [days, setDays] = useState(String(retention.retentionDays));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const value = Number(days);
  const valid =
    days.trim() !== '' &&
    Number.isInteger(value) &&
    value >= retention.minDays &&
    value <= retention.maxDays;

  const save = (): void => {
    startTransition(async () => {
      const result = await setAuditRetention({ retentionDays: value });
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
        <Label htmlFor="audit-retention">Keep records for (days)</Label>
        <Input
          id="audit-retention"
          type="number"
          min={retention.minDays}
          max={retention.maxDays}
          step={1}
          className="w-32"
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
          }}
        />
        <FieldHint>
          {String(retention.minDays)} to {String(retention.maxDays)} days
          {retention.chosen
            ? ''
            : ` — the default, ${String(retention.defaultDays)}, until you choose`}
          .
        </FieldHint>
      </Field>
      <Button type="submit" disabled={pending || !valid}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
