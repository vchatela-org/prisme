'use client';

import { AreaBadge, Button } from '@prisme/ui';
import { useState } from 'react';
import { RitualForm, type RitualDraft } from './ritual-form';

export function RitualRow({
  draft,
  areaName,
  latestAdherencePct,
  pageHref,
  areas,
}: {
  draft: RitualDraft & { id: string };
  areaName: string;
  latestAdherencePct: number | null;
  pageHref: string | null;
  areas: readonly { key: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-ink">{draft.name}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            <AreaBadge areaKey={draft.areaKey} name={areaName} size="sm" />
            {draft.cadence} · target {String(draft.targetAdherencePct)}% · latest{' '}
            {latestAdherencePct === null ? 'not measured yet' : `${latestAdherencePct.toFixed(0)}%`}
            {pageHref === null ? null : (
              <a
                className="underline underline-offset-2"
                href={pageHref}
                target="_blank"
                rel="noreferrer"
              >
                process page
              </a>
            )}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(!editing);
          }}
        >
          {editing ? 'Close' : 'Edit'}
        </Button>
      </div>
      {editing ? (
        <RitualForm
          initial={draft}
          areas={areas}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
}
