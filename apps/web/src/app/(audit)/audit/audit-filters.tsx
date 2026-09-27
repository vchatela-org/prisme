'use client';

import { Badge, Button, cn, FOCUS_RING, Input } from '@prisme/ui';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AUDIT_PERIODS,
  isAuditFiltered,
  toAuditSearchString,
  withAuditChange,
  type AuditPeriod,
  type AuditQuery,
} from '@/lib/audit-query';
import { OPERATION_LABEL, ORIGIN_LABEL, TOOL_LABEL } from '@/lib/audit-view';
import {
  WRITE_AUDIT_OPERATIONS,
  WRITE_AUDIT_ORIGINS,
  WRITE_AUDIT_TOOLS,
  type WriteAuditOutcome,
} from '@/lib/contracts';

/**
 * The audit's filters, which write to the URL — the backlog's pattern
 * (`../../(backlog)/backlog/backlog-filters.tsx`): every control navigates,
 * the server component re-reads the query, and a filtered audit is a link.
 *
 * Tools and operations are multi-select toggles; outcome, origin and period
 * are one-of, and pressing the active one again clears it.
 */

const PERIOD_LABEL: Readonly<Record<AuditPeriod, string>> = {
  day: 'Last 24 hours',
  week: 'Last 7 days',
  month: 'Last 30 days',
  all: 'Everything kept',
};

const OUTCOME_LABEL: Readonly<Record<WriteAuditOutcome, string>> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
};

export function AuditFilters({ query }: { query: AuditQuery }) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search ?? '');

  // The URL is the source of truth: a back button has to be reflected here.
  useEffect(() => {
    setSearch(query.search ?? '');
  }, [query.search]);

  const go = (next: AuditQuery): void => {
    router.push(`/audit${toAuditSearchString(next)}`);
  };

  const toggle = <T extends string>(values: readonly T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          go(withAuditChange(query, { search: search.trim() === '' ? undefined : search.trim() }));
        }}
      >
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search what was sent…"
          aria-label="Search the audit"
          className="h-9 max-w-64"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      <FilterGroup label="Period">
        {AUDIT_PERIODS.map((period) => (
          <FilterChip
            key={period}
            label={PERIOD_LABEL[period]}
            active={query.period === period}
            onToggle={() => {
              go(withAuditChange(query, { period }));
            }}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Tool and outcome">
        {WRITE_AUDIT_TOOLS.map((tool) => (
          <FilterChip
            key={tool}
            label={TOOL_LABEL[tool]}
            active={query.tools.includes(tool)}
            onToggle={() => {
              go(withAuditChange(query, { tools: toggle(query.tools, tool) }));
            }}
          />
        ))}
        {(['succeeded', 'failed'] as const).map((outcome) => (
          <FilterChip
            key={outcome}
            label={OUTCOME_LABEL[outcome]}
            active={query.outcome === outcome}
            onToggle={() => {
              go(
                withAuditChange(query, {
                  outcome: query.outcome === outcome ? undefined : outcome,
                }),
              );
            }}
          />
        ))}
        {WRITE_AUDIT_ORIGINS.map((origin) => (
          <FilterChip
            key={origin}
            label={`By ${ORIGIN_LABEL[origin].toLowerCase()}`}
            active={query.origin === origin}
            onToggle={() => {
              go(withAuditChange(query, { origin: query.origin === origin ? undefined : origin }));
            }}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Operation">
        {WRITE_AUDIT_OPERATIONS.map((operation) => (
          <FilterChip
            key={operation}
            label={OPERATION_LABEL[operation]}
            active={query.operations.includes(operation)}
            onToggle={() => {
              go(withAuditChange(query, { operations: toggle(query.operations, operation) }));
            }}
          />
        ))}

        {isAuditFiltered(query) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              router.push('/audit');
            }}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        ) : null}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

/** A toggle button, as on the backlog: `aria-pressed` announces what is on. */
function FilterChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn('cursor-pointer rounded-full', FOCUS_RING)}
    >
      <Badge variant={active ? 'accent' : 'outline'}>{label}</Badge>
    </button>
  );
}
