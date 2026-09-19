'use client';

import {
  Badge,
  Button,
  cn,
  FOCUS_RING,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  statusLabel,
} from '@prisme/ui';
import { ArrowDownUp, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BACKLOG_SORTS,
  isFiltered,
  toSearchString,
  withChange,
  type BacklogQuery,
  type BacklogSort,
} from '@/lib/backlog-query';
import { INITIATIVE_STATUSES, type Area } from '@/lib/contracts';

/**
 * The backlog's filters, which write to the URL.
 *
 * Every control here navigates rather than setting state: the server component
 * re-reads the query, asks the API for that page, and renders it. So a filtered
 * backlog is a link that can be sent, bookmarked and reloaded, and the address
 * bar never disagrees with the table.
 *
 * The **sort** control belongs here rather than on the table's headers for a
 * reason that is not layout: sorting by score sorts by *rank*, the position in
 * the ordering the active scoring method produced. Letting the table re-sort
 * its own visible page would make a second ordering of the same data, on the
 * one screen where somebody is deciding what to do with their week.
 */

const SORT_LABELS: Readonly<Record<BacklogSort, string>> = {
  score: 'Rank',
  deadline: 'Deadline',
  age: 'Age',
  title: 'Title',
  size: 'Size',
};

export function BacklogFilters({ query, areas }: { query: BacklogQuery; areas: readonly Area[] }) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search ?? '');

  // The URL is the source of truth: a back button, or a link from the command
  // palette, has to be reflected in the box.
  useEffect(() => {
    setSearch(query.search ?? '');
  }, [query.search]);

  const go = (next: BacklogQuery): void => {
    router.push(`/backlog${toSearchString(next)}`);
  };

  const toggle = <T extends string>(values: readonly T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          go(withChange(query, { search: search.trim() === '' ? undefined : search.trim() }));
        }}
      >
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search titles…"
          aria-label="Search the backlog"
          className="h-9 max-w-64"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={query.sort}
            onValueChange={(next) => {
              go(withChange(query, { sort: next as BacklogSort }));
            }}
          >
            <SelectTrigger aria-label="Sort by" className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKLOG_SORTS.map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            aria-label={`Sort ${query.direction === 'asc' ? 'ascending' : 'descending'}. Reverse it.`}
            onClick={() => {
              go(withChange(query, { direction: query.direction === 'asc' ? 'desc' : 'asc' }));
            }}
          >
            <ArrowDownUp aria-hidden />
            {query.direction === 'asc' ? 'Ascending' : 'Descending'}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {areas.map((area) => (
          <FilterChip
            key={area.key}
            label={area.name}
            active={query.areaKeys.includes(area.key)}
            onToggle={() => {
              go(withChange(query, { areaKeys: toggle(query.areaKeys, area.key) }));
            }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {INITIATIVE_STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={statusLabel(status)}
            active={query.statuses.includes(status)}
            onToggle={() => {
              go(withChange(query, { statuses: toggle(query.statuses, status) }));
            }}
          />
        ))}

        <FilterChip
          label="Has a deadline"
          active={query.hasDeadline === true}
          onToggle={() => {
            go(withChange(query, { hasDeadline: query.hasDeadline === true ? undefined : true }));
          }}
        />

        {isFiltered(query) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              router.push('/backlog');
            }}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A filter is a toggle button, not a checkbox in a menu.
 *
 * `aria-pressed` rather than a tick: what is on is then announced by every
 * screen reader without a label that has to describe its own state.
 */
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
