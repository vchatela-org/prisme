'use client';

import { FieldHint, Input, Label } from '@prisme/ui';
import { useState } from 'react';

/**
 * ADR-0011's three states, as a control.
 *
 * | State | What it means |
 * |---|---|
 * | `none` | No page. Most initiatives need none, and this is the default |
 * | `create` | Make one from the template |
 * | `link` | Bind one that already exists — the adoption path for pages |
 *
 * ## Why this is three radio buttons and not a checkbox plus a field
 *
 * The ADR's whole point is that a page's existence *signals that something is
 * written in it*, and a workspace full of empty pages makes the ones that
 * matter harder to find. A checkbox with an optional identifier beside it
 * makes "I did not think about a page" and "make me a page" the same input —
 * and the API refuses that shape for the same reason (`dto/create.ts`).
 *
 * ## Why `create` says it will not happen yet
 *
 * It records the intention and nothing makes it: no role key names where a
 * page would go, and none carries the capability to create one (ADR-0025).
 * The control says so at the moment of choosing rather than leaving somebody
 * to find out from the ledger — an option that silently does nothing is worse
 * than one that explains itself.
 */

export type PageDecision =
  | { readonly mode: 'none' }
  | { readonly mode: 'create' }
  | { readonly mode: 'link'; readonly externalId: string };

export function PageChoice({
  value,
  onChange,
  disabled = false,
  subject = 'initiative',
}: {
  value: PageDecision;
  onChange: (next: PageDecision) => void;
  disabled?: boolean;
  subject?: 'initiative' | 'project';
}) {
  const [externalId, setExternalId] = useState(value.mode === 'link' ? value.externalId : '');

  const choose = (mode: PageDecision['mode']): void => {
    if (mode === 'link') onChange({ mode: 'link', externalId });
    else onChange({ mode });
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">Narrative page</legend>

      <div className="flex flex-wrap gap-4 text-sm">
        {(['none', 'create', 'link'] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2">
            <input
              type="radio"
              name={`page-mode-${subject}`}
              value={mode}
              checked={value.mode === mode}
              disabled={disabled}
              onChange={() => {
                choose(mode);
              }}
            />
            <span>
              {mode === 'none' ? 'None' : mode === 'create' ? 'Create one' : 'Link one I have'}
            </span>
          </label>
        ))}
      </div>

      {value.mode === 'none' ? (
        <FieldHint>
          Most {subject === 'project' ? 'projects have one' : 'initiatives need none'}. A page that
          exists should mean there is something written in it.
        </FieldHint>
      ) : null}

      {value.mode === 'create' ? (
        <FieldHint>
          Recorded as an intention, and waiting on a decision rather than on a pass: prisme has
          nowhere addressable to create a page yet (ADR-0025). Linking one works today.
        </FieldHint>
      ) : null}

      {value.mode === 'link' ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`page-external-${subject}`}>The page’s identifier</Label>
          <Input
            id={`page-external-${subject}`}
            value={externalId}
            disabled={disabled}
            placeholder="From the document tool"
            onChange={(event) => {
              setExternalId(event.target.value);
              onChange({ mode: 'link', externalId: event.target.value });
            }}
          />
          <FieldHint>
            Binds a page you have already written. Nothing is created, and a page bound to something
            else is refused rather than moved.
          </FieldHint>
        </div>
      ) : null}
    </fieldset>
  );
}
