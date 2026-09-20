'use client';

import { Button, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setServedBy } from '../objective-actions';

export interface InitiativeChoice {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

/**
 * Which initiatives serve this key result.
 *
 * This is the only editable end of the objective-to-work link, and it is the
 * one the orphan lists are computed from in both directions. The choices are
 * the objective's own area, because allocation happens before ranking and an
 * initiative in another area serving this objective would make the balance
 * figures describe work that is not there.
 *
 * The whole set is submitted rather than a delta — `servedBy` is replaced
 * wholesale upstream, and a delta would need this component to know what it
 * last saw, so two tabs would disagree about the membership.
 */
export function ServedByEditor({
  keyResultId,
  objectiveId,
  servedBy,
  choices,
}: {
  keyResultId: string;
  objectiveId: string;
  servedBy: readonly string[];
  choices: readonly InitiativeChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>(servedBy);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const toggle = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const changed =
    selected.length !== servedBy.length || selected.some((id) => !servedBy.includes(id));

  const save = (): void => {
    startTransition(async () => {
      const result = await setServedBy({
        keyResultId,
        objectiveId,
        servedBy: [...selected],
      });

      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });

      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start px-0"
        onClick={() => {
          setOpen(true);
        }}
      >
        {servedBy.length === 0 ? 'Link work to this key result' : 'Change what serves it'}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-hairline pt-3">
      {choices.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          No open initiative in this area to link. An objective is served by work in its own area —
          allocation happens before ranking, so work from elsewhere would make the balance figures
          describe capacity this area never had.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {choices.map((choice) => (
            <li key={choice.id}>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={selected.includes(choice.id)}
                  disabled={pending}
                  onChange={() => {
                    toggle(choice.id);
                  }}
                />
                <span>{choice.title}</span>
                <span className="text-xs text-ink-muted">{choice.status}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!changed || pending}>
          {pending ? 'Saving…' : 'Save links'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setSelected(servedBy);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
