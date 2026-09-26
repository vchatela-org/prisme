'use client';

import { Button, Input, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { saveDependencies } from '@/lib/actions';

interface Candidate {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

/**
 * Choose what this initiative waits on.
 *
 * The API rejects a cycle and says which path closes it; this editor only
 * collects a set. The schedule — planned dates, the critical path — is
 * recomputed by the API from it, never here.
 */
export function DependencyEditor({
  id,
  current,
  candidates,
}: {
  id: string;
  current: readonly string[];
  candidates: readonly Candidate[];
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(current));
  const [filter, setFilter] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return candidates.filter(
      (candidate) =>
        chosen.has(candidate.id) || needle === '' || candidate.title.toLowerCase().includes(needle),
    );
  }, [candidates, chosen, filter]);

  if (!open) {
    return (
      <div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          Edit dependencies
        </Button>
      </div>
    );
  }

  const save = (): void => {
    startTransition(async () => {
      const result = await saveDependencies({ id, dependsOn: [...chosen] });
      toast(
        result.ok
          ? { title: 'Dependencies saved', description: result.message, tone: 'success' }
          : { title: result.title, description: result.description, tone: 'error' },
      );
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-hairline p-3">
      <Input
        aria-label="Filter initiatives"
        placeholder="Filter by title"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {visible.map((candidate) => (
          <li key={candidate.id}>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={chosen.has(candidate.id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(candidate.id);
                  else next.delete(candidate.id);
                  setChosen(next);
                }}
              />
              {candidate.title}
              <span className="text-xs text-ink-muted">{candidate.status}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : `Save — waits on ${String(chosen.size)}`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setChosen(new Set(current));
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
