'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FibonacciSelect,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { ArrowRight, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { promoteTakeaway, transitionInitiative } from '@/lib/actions';
import type { Area, Fibonacci, Initiative, Takeaway } from '@/lib/contracts';

/**
 * Triage, in one action each.
 *
 * The inbox is the one screen whose whole purpose is to become empty, so every
 * decision here is a single button: file it for later, queue it next, or drop
 * it. Anything that needs more than that — a deadline, a dependency, a project —
 * is a reason to open the initiative rather than to grow this row.
 *
 * A drop asks for its reason, because an unexplained drop is indistinguishable
 * from a deletion six months later, and that sentence is what the event log
 * keeps.
 */
export function TriageButtons({ initiative }: { initiative: Initiative }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState('');

  const move = (to: 'later' | 'next' | 'dropped', why?: string): void => {
    startTransition(async () => {
      const result = await transitionInitiative(
        why === undefined ? { id: initiative.id, to } : { id: initiative.id, to, reason: why },
      );

      if (result.ok) {
        setDropping(false);
        setReason('');
        toast({ title: result.message, tone: 'success' });
        router.refresh();
      } else {
        toast({ title: result.title, description: result.description, tone: 'error' });
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          move('next');
        }}
      >
        Next
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          move('later');
        }}
      >
        Later
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setDropping(true);
        }}
      >
        <Trash2 aria-hidden />
        Drop
      </Button>

      <Dialog open={dropping} onOpenChange={setDropping}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop “{initiative.title}”?</DialogTitle>
            <DialogDescription>
              It stays in the model with the reason recorded. Nothing is deleted, and nothing is
              written to the task tool.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 text-sm text-ink">
            Why?
            <Input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              placeholder="Superseded by something else"
              maxLength={500}
              autoFocus
            />
          </label>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDropping(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={reason.trim() === '' || pending}
              onClick={() => {
                move('dropped', reason.trim());
              }}
            >
              Drop it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DEFAULT_ESTIMATE: Fibonacci = 3;

/**
 * Promote an action takeaway into an initiative.
 *
 * The title box starts **empty**, and that is the point: the takeaway's text
 * lives in the document tool and prisme never holds it, so promoting means
 * writing what the result will be rather than copying what was noticed. "Fence
 * replaced", not "think about the fence" — an activity has no completion
 * condition, which is how something stays open for two years.
 *
 * The four estimates are asked for here because an initiative cannot be ranked
 * without them, and a promoted item with no estimates sinks to the bottom of
 * every list until somebody notices.
 */
export function PromoteDialog({ takeaway, areas }: { takeaway: Takeaway; areas: readonly Area[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [areaKey, setAreaKey] = useState(takeaway.areaKey ?? '');
  const [estimates, setEstimates] = useState({
    value: DEFAULT_ESTIMATE,
    timeCriticality: DEFAULT_ESTIMATE,
    risk: DEFAULT_ESTIMATE,
    size: DEFAULT_ESTIMATE,
  });

  const submit = (): void => {
    startTransition(async () => {
      const result = await promoteTakeaway({
        id: takeaway.id,
        title: title.trim(),
        areaKey,
        ...estimates,
      });

      if (result.ok) {
        setOpen(false);
        setTitle('');
        toast({ title: result.message, tone: 'success' });
        router.refresh();
      } else {
        toast({ title: result.title, description: result.description, tone: 'error' });
      }
    });
  };

  const fields = [
    { key: 'value' as const, label: 'Value' },
    { key: 'timeCriticality' as const, label: 'Time criticality' },
    { key: 'risk' as const, label: 'Risk / opportunity' },
    { key: 'size' as const, label: 'Size' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Promote
        <ArrowRight aria-hidden />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote into an initiative</DialogTitle>
          <DialogDescription>
            The takeaway itself is not modified and its text is not copied — the document tool owns
            it. Write the result this will produce.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-sm text-ink">
          Title, phrased as a result
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="Fence replaced"
            maxLength={500}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          Area
          <Select value={areaKey} onValueChange={setAreaKey}>
            <SelectTrigger aria-label="Area">
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
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(({ key, label }) => (
            <FibonacciSelect
              key={key}
              label={label}
              value={estimates[key]}
              onValueChange={(next) => {
                setEstimates((current) => ({ ...current, [key]: next }));
              }}
            />
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button disabled={pending || title.trim() === '' || areaKey === ''} onClick={submit}>
            Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
