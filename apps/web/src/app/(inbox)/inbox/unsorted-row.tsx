'use client';

import {
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adoptUnsorted } from './unsorted-actions';

/**
 * One task sitting unsorted in Todoist's Inbox (S11), with the one move prisme
 * may make for it: adopt it as an initiative of an area. Its title is written
 * here as an outcome, starting from the task's own words.
 */
export function UnsortedRow({
  task,
  areas,
}: {
  task: { id: string; title: string };
  areas: readonly { key: string; name: string }[];
}) {
  const [title, setTitle] = useState(task.title);
  const [areaKey, setAreaKey] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const adopt = (): void => {
    startTransition(async () => {
      const result = await adoptUnsorted({ taskId: task.id, title, areaKey });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-sm text-ink">{task.title === '' ? 'Untitled' : task.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Initiative title for ${task.title}`}
          className="min-w-56 flex-1"
          value={title}
          maxLength={500}
          disabled={pending}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <Select value={areaKey} onValueChange={setAreaKey}>
          <SelectTrigger className="w-40" aria-label={`Area for ${task.title}`}>
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
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || areaKey === '' || title.trim() === ''}
          onClick={adopt}
        >
          {pending ? 'Adopting…' : 'Make it an initiative'}
        </Button>
      </div>
    </Card>
  );
}
