'use client';

import { FieldHint, Input, Label } from '@prisme/ui';
import { useState } from 'react';
import type { PageTemplates } from '@/lib/contracts';
import { pageTemplateHint, templateChoice } from '@/lib/create-view';

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
 * ## Why `create` says when it can stall
 *
 * It records the intention and a converge pass makes it, from one of the
 * templates the kind's Notion database holds (ADR-0030). So what the copy owes
 * the person choosing is what the pass will find: a database with a template
 * gets the page on the next pass, and one that is unbound or holds none gets a
 * plan reporting it blocked with that reason. Saying so at the moment of
 * choosing is better than leaving somebody to find out from the ledger — an
 * option that silently does nothing is worse than one that explains itself.
 *
 * ## Why a template choice appears only sometimes
 *
 * The database's templates are the choice, and ADR-0030 shows it **when, and
 * only when, there are several** — one template is not a decision, and a
 * select with one option is a control that asks for nothing. The default the
 * database marks is pre-selected; with none marked nothing is, and the form
 * waits for a choice rather than taking the first (`pageChoiceComplete`).
 */

export type PageDecision =
  | { readonly mode: 'none' }
  | { readonly mode: 'create'; readonly templateId?: string | undefined }
  | { readonly mode: 'link'; readonly externalId: string };

export function PageChoice({
  value,
  onChange,
  disabled = false,
  subject = 'initiative',
  templates = null,
}: {
  value: PageDecision;
  onChange: (next: PageDecision) => void;
  disabled?: boolean;
  subject?: 'initiative' | 'project';
  /** What this kind's database offers, read by the server component; `null` if it could not be. */
  templates?: PageTemplates | null;
}) {
  const [externalId, setExternalId] = useState(value.mode === 'link' ? value.externalId : '');
  const choice = templateChoice(templates);
  const hint = pageTemplateHint(templates);

  const choose = (mode: PageDecision['mode']): void => {
    if (mode === 'link') onChange({ mode: 'link', externalId });
    else if (mode === 'create') onChange({ mode: 'create', templateId: choice.preselected });
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

      {value.mode === 'create' && choice.show && templates !== null ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`page-template-${subject}`}>Template</Label>
          <select
            id={`page-template-${subject}`}
            className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm text-ink"
            value={value.templateId ?? ''}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                mode: 'create',
                templateId: event.target.value === '' ? undefined : event.target.value,
              });
            }}
          >
            {choice.preselected === undefined ? (
              <option value="" disabled>
                Choose a template…
              </option>
            ) : null}
            {templates.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.isDefault ? `${template.name} (default)` : template.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {value.mode === 'create' ? (
        <FieldHint>
          {hint ??
            'Recorded as an intention and made by the converge pass from a template its Notion database holds — if none is bound, or it holds none, the plan reports it blocked with that reason (ADR-0030).'}{' '}
          Linking one works today.
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
