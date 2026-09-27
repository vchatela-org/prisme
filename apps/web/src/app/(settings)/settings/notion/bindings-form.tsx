'use client';

import { Badge, Button, Card, Input, Section, useToast } from '@prisme/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Binding } from '@/lib/contracts';
import {
  ACCESS_LABEL,
  checkAdvice,
  roleCopy,
  templateSummary,
  type RoleCopy,
} from '@/lib/settings-view';
import { saveBinding } from '../settings-actions';

type Row = Binding & { readonly href: string | null };

const GROUPS: readonly { id: RoleCopy['group']; title: string; description: string }[] = [
  {
    id: 'read',
    title: 'What prisme reads',
    description: 'Existing databases. prisme reads their rows and never edits them.',
  },
  {
    id: 'pages',
    title: 'Where prisme may add pages',
    description:
      'A database per kind of page. A new page is an entry in it, started from one of the database’s own templates — keep and edit them in Notion. Several kinds may share one database.',
  },
];

export function BindingsForm({ bindings }: { bindings: readonly Row[] }) {
  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => (
        <Section key={group.id} title={group.title} description={group.description}>
          <Card className="flex flex-col divide-y divide-border-hairline p-0">
            {bindings
              .filter((binding) => roleCopy(binding.role).group === group.id)
              .map((binding) => (
                <BindingEditor
                  key={`${binding.role}:${binding.externalId ?? ''}`}
                  binding={binding}
                />
              ))}
          </Card>
        </Section>
      ))}
    </div>
  );
}

function BindingEditor({ binding }: { binding: Row }) {
  const copy = roleCopy(binding.role);
  const [value, setValue] = useState(binding.externalId ?? '');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const advice = binding.bound ? checkAdvice(binding.checkError) : null;
  const held =
    binding.bound && binding.checkError === null ? templateSummary(binding.templates) : null;
  const checked = binding.checkedAt !== null;
  const inputId = `binding-${binding.role}`;

  const submit = (externalId: string | null): void => {
    startTransition(async () => {
      const result = await saveBinding({ role: binding.role, externalId });
      toast({
        title: result.title,
        description: result.description,
        tone: result.ok ? (result.checkError ? 'info' : 'success') : 'error',
      });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="font-medium text-ink">
          {copy.label}
        </label>
        <span className="text-xs text-ink-muted">
          {binding.role} · prisme {ACCESS_LABEL[binding.access]}
        </span>
      </div>
      <p className="text-sm text-ink-secondary">
        {copy.use} <span className="text-ink-muted">{copy.bind}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          className="min-w-72 flex-1"
          placeholder="Link to a database"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button
          size="sm"
          disabled={pending || value.trim() === '' || value.trim() === binding.externalId}
          onClick={() => {
            submit(value.trim());
          }}
        >
          {pending ? 'Checking…' : 'Save'}
        </Button>
        {binding.bound ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setValue('');
              submit(null);
            }}
          >
            Unbind
          </Button>
        ) : null}
      </div>

      {binding.bound ? (
        <p className="text-sm">
          {!checked ? (
            <Badge variant="outline">not checked</Badge>
          ) : binding.checkError === null ? (
            <Badge variant="neutral">found</Badge>
          ) : (
            <Badge variant="outline">not readable</Badge>
          )}{' '}
          {binding.href === null ? (
            <span className="text-ink">{binding.title ?? ''}</span>
          ) : (
            <a
              className="underline underline-offset-2"
              href={binding.href}
              target="_blank"
              rel="noreferrer"
            >
              {binding.title ?? 'Open in Notion'}
            </a>
          )}
        </p>
      ) : (
        <p className="text-xs text-ink-muted">Not set — whatever uses it reports “not read”.</p>
      )}
      {held === null ? null : (
        <p className={held.warning ? 'text-xs text-status-warning' : 'text-xs text-ink-muted'}>
          {held.text}
        </p>
      )}
      {binding.bound && !checked ? (
        <p className="text-xs text-ink-muted">
          Not checked since it was saved — save it again, or use Check again on Settings.
        </p>
      ) : null}
      {advice === null ? null : <p className="text-xs text-status-warning">{advice}</p>}
    </div>
  );
}
