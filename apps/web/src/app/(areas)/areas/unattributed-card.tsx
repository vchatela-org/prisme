'use client';

import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { UnattributedRow } from '@/lib/unattributed-view';
import { mapRestOfProject } from './unattributed-actions';

/**
 * Completions counted toward no area, and the mapping that would count them
 * (S9). Server-rendered rows; the only client state is the area each row's
 * select holds.
 */
export function UnattributedCard({
  summary,
  rows,
  areas,
}: {
  summary: string;
  rows: readonly UnattributedRow[];
  areas: readonly { key: string; name: string }[];
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-medium text-ink">{summary}</p>
      <ul className="flex flex-col divide-y divide-border-hairline">
        {rows.map((row) => (
          <Row key={row.key} row={row} areas={areas} />
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        A section&rsquo;s mapping outranks its project&rsquo;s, so mapping the rest of a project
        leaves its mapped sections where they are. New mappings count from the next daily capacity
        refresh.
      </p>
    </Card>
  );
}

function Row({
  row,
  areas,
}: {
  row: UnattributedRow;
  areas: readonly { key: string; name: string }[];
}) {
  const [areaKey, setAreaKey] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const projectId = row.projectId;

  const map = (): void => {
    if (projectId === null || areaKey === '') return;
    startTransition(async () => {
      const result = await mapRestOfProject({ areaKey, projectId });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
      <span className="text-ink">
        {row.where}{' '}
        <span className="text-ink-muted tabular-nums">
          · {String(row.completions)} completion{row.completions === 1 ? '' : 's'}
        </span>
      </span>
      {row.action === null ? (
        <span className="text-xs text-ink-muted">Move these tasks into a mapped project</span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink-secondary">
            {row.action === 'map_rest' ? 'Map the rest of this project to' : 'Map this project to'}
          </span>
          <Select value={areaKey} onValueChange={setAreaKey}>
            <SelectTrigger className="w-40" aria-label={`Area for ${row.where}`}>
              <SelectValue placeholder="an area" />
            </SelectTrigger>
            <SelectContent>
              {areas.map((area) => (
                <SelectItem key={area.key} value={area.key}>
                  {area.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" disabled={pending || areaKey === ''} onClick={map}>
            {pending ? 'Mapping…' : 'Map'}
          </Button>
        </span>
      )}
    </li>
  );
}
