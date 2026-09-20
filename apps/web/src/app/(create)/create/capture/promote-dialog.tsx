'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FibonacciSelect,
  FieldHint,
  Input,
  Label,
  useToast,
  type Fibonacci,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { promoteCapture } from '../../create-actions';

type EstimateKey = 'value' | 'timeCriticality' | 'risk' | 'size';

/** The same four questions, worded as they are on the new-initiative form. */
const ESTIMATES: readonly {
  key: EstimateKey;
  label: string;
  hint: string;
  sliceAbove?: Fibonacci;
}[] = [
  { key: 'value', label: 'Value', hint: 'What it is worth if it lands.' },
  { key: 'timeCriticality', label: 'Time criticality', hint: 'How fast that value decays.' },
  { key: 'risk', label: 'Risk / opportunity', hint: 'What it unlocks or removes.' },
  { key: 'size', label: 'Size', hint: 'Above 8, slice it.', sliceAbove: 8 },
];

/**
 * *This capture is really an initiative.*
 *
 * ## The title is re-typed, not carried over
 *
 * A capture is a line typed in seconds — "the parking thing" — and an
 * initiative is a **result**: "parking permit renewed". Pre-filling the box
 * with the capture's words is how an activity gets promoted verbatim and then
 * sits open for two years, which is the failure `docs/10-model.md` §5 names.
 * So the field starts empty and the capture's own text is shown beside it as
 * context rather than as a default.
 *
 * ## The four estimates are required here
 *
 * This is the moment they are cheap, and the moment they are normally
 * skipped. An initiative created without them would sit in the inbox
 * indefinitely — the "missing score" backlog the previous system accumulated.
 *
 * ## No second task appears, and the copy says so
 *
 * The new initiative is bound to **this capture's existing task** as its
 * anchor. Somebody who expects a second task in their task tool and does not
 * get one should be told that is correct, not left wondering.
 */
export function PromoteDialog({
  captureId,
  captureTitle,
  disabled,
}: {
  captureId: string;
  captureTitle: string;
  /** True while the capture has no task yet: there is no anchor to reuse. */
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [estimates, setEstimates] = useState<Record<EstimateKey, Fibonacci>>({
    value: 3,
    timeCriticality: 3,
    risk: 3,
    size: 3,
  });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const submit = (): void => {
    if (title.trim() === '' || pending) return;
    startTransition(async () => {
      const result = await promoteCapture({
        captureId,
        title: title.trim(),
        value: estimates.value,
        timeCriticality: estimates.timeCriticality,
        risk: estimates.risk,
        size: estimates.size,
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setOpen(false);
        if (result.href !== undefined) router.push(result.href);
      }
    });
  };

  if (disabled) {
    // Refused before the click rather than after it. The API says the same
    // thing with a 409, but a button that always fails is worse than one that
    // explains itself.
    return <span className="text-xs text-ink-tertiary">promotable once its task exists</span>;
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Promote
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to an initiative</DialogTitle>
            <DialogDescription>
              The initiative is anchored to the task this capture already has. No second task is
              created, and none will be.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`promote-title-${captureId}`}>
                What will be true when this is done?
              </Label>
              <Input
                id={`promote-title-${captureId}`}
                value={title}
                disabled={pending}
                placeholder="A result, not an activity"
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
              <FieldHint>
                You captured “{captureTitle}”. Rephrase it as a result — an activity has no
                completion condition.
              </FieldHint>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {ESTIMATES.map(({ key, label, hint, sliceAbove }) => (
                <div key={key} className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-ink">{label}</span>
                  <FibonacciSelect
                    label={label}
                    value={estimates[key]}
                    onValueChange={(next) => {
                      setEstimates((current) => ({ ...current, [key]: next }));
                    }}
                    disabled={pending}
                    {...(sliceAbove === undefined ? {} : { sliceAbove })}
                  />
                  <p className="text-xs text-ink-muted">{hint}</p>
                </div>
              ))}
            </div>

            <div>
              <Button onClick={submit} disabled={title.trim() === '' || pending}>
                {pending ? 'Promoting…' : 'Promote'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
