import { Badge, Button, Card, cn, EmptyState, relativeTime, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  isAuditFiltered,
  parseAuditQuery,
  toAuditApiQuery,
  toAuditSearchString,
  withAuditChange,
} from '@/lib/audit-query';
import {
  durationLabel,
  OPERATION_LABEL,
  ORIGIN_LABEL,
  requestFields,
  TOOL_LABEL,
  writeSummary,
} from '@/lib/audit-view';
import { pagePosition, type RawSearchParams } from '@/lib/backlog-query';
import {
  auditRetentionSchema,
  externalWritePageSchema,
  instanceSettingsSchema,
  type ExternalWrite,
} from '@/lib/contracts';
import { pageUrl } from '@/lib/page-link';
import { webRuntime } from '@/lib/runtime';
import { AuditFilters } from './audit-filters';

export const metadata = {
  title: 'Audit · prisme',
  description: 'Every call prisme made to Notion or Todoist, and whether it worked.',
};

/**
 * The audit of outward writes (ADR-0031).
 *
 * Every call prisme made that could change Notion or Todoist, one row each,
 * failures included — the reconciler's updates and moves, and the creation
 * ledger's projects, sections, captures and pages. It is where you go when
 * something in either tool changed and you want to know whether prisme did it.
 *
 * **Read-only.** Nothing here writes anywhere: the records are made by the
 * writers as the calls happen and deleted by the daily pass once they are older
 * than the window chosen in Settings. There is no button that edits one.
 *
 * **What was sent is shown as it was sent.** A row says what prisme asked for
 * and whether the tool accepted it. It does not say what the object looks like
 * now — that is the tool's to answer, and the link opens it there.
 *
 * Every title and identifier below is **instance data**. It renders in a
 * browser and never in this repository (docs/17-privacy.md).
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAuditQuery(await searchParams);
  const now = new Date();

  const [writes, retention, settings] = await Promise.all([
    apiFetch({
      path: '/audit/writes',
      query: toAuditApiQuery(query, now),
      schema: externalWritePageSchema,
    }),
    apiFetch({ path: '/audit/retention', schema: auditRetentionSchema }),
    apiFetch({ path: '/settings', schema: instanceSettingsSchema }),
  ]);

  const frozen = settings.ok ? !settings.data.sync.writeEnabled : false;
  const kept = retention.ok ? `Kept ${String(retention.data.retentionDays)} days.` : '';

  if (!writes.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header subtitle={kept} />
        <ApiFailureState failure={writes} surface="the audit of outward writes" />
      </div>
    );
  }

  const data = writes.data;
  const position = pagePosition(data.offset, data.limit, data.total);
  const config = webRuntime().config;
  const links = {
    page: config.doctoolPageUrlTemplate,
    project: config.tasktoolProjectUrlTemplate,
  };

  return (
    <div className="flex flex-col gap-6">
      <Header
        subtitle={`${String(data.total)} ${data.total === 1 ? 'call' : 'calls'} recorded. ${kept}`}
      />

      {frozen ? (
        <Card className="text-sm text-ink-secondary">
          <span className="font-medium text-ink">Outward writes are frozen.</span> prisme attempts
          nothing while <code>SYNC_WRITE_ENABLED</code> is off, so nothing new is recorded here
          until it is lifted.
        </Card>
      ) : null}

      <AuditFilters query={query} />

      {data.items.length === 0 ? (
        isAuditFiltered(query) ? (
          <EmptyState
            title="Nothing matches these filters"
            description="Every recorded call is still there; none of them matches what is selected above."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/audit">Clear the filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="prisme has not written anything"
            description={
              frozen
                ? 'Nothing has been sent to Notion or Todoist: the write freeze is on. Once it is lifted, every call prisme makes appears here, whether it worked or not.'
                : 'Nothing has been sent to Notion or Todoist yet — or everything that was is older than the retention window. Every call prisme makes appears here, whether it worked or not.'
            }
          />
        )
      ) : (
        <Section
          title="Calls"
          description="Most recent first. Open a row to see exactly what was sent."
        >
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Every call prisme made to Notion or Todoist, most recent first.
              </caption>
              <thead>
                <tr className="border-b border-border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tool
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    What
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((write) => (
                  <WriteRow key={write.id} write={write} now={now} links={links} />
                ))}
              </tbody>
            </table>
          </Card>

          <nav
            aria-label="Audit pages"
            className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-secondary"
          >
            <span className="tabular-nums">
              {position.from}–{position.to} of {position.total}
            </span>
            <div className="flex gap-2">
              <Button asChild variant="ghost" size="sm" disabled={!position.hasPrevious}>
                <Link
                  href={`/audit${toAuditSearchString(withAuditChange(query, { offset: Math.max(0, query.offset - query.limit) }))}`}
                  aria-disabled={!position.hasPrevious}
                >
                  Newer
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" disabled={!position.hasNext}>
                <Link
                  href={`/audit${toAuditSearchString(withAuditChange(query, { offset: query.offset + query.limit }))}`}
                  aria-disabled={!position.hasNext}
                >
                  Older
                </Link>
              </Button>
            </div>
          </nav>
        </Section>
      )}
    </div>
  );
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">Audit</h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          Every call prisme made to Notion or Todoist, whether it worked or not. {subtitle ?? ''}
        </p>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link href="/settings#audit">Retention</Link>
      </Button>
    </header>
  );
}

function WriteRow({
  write,
  now,
  links,
}: {
  write: ExternalWrite;
  now: Date;
  links: { page: string | undefined; project: string | undefined };
}) {
  const summary = writeSummary(write);
  const fields = requestFields(write);
  const at = new Date(write.occurredAt);
  const open = openLink(write, links);

  return (
    <tr className="border-b border-border-hairline align-top last:border-b-0">
      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
        <time dateTime={write.occurredAt} title={write.occurredAt}>
          {relativeTime(at, now)}
        </time>
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline">{TOOL_LABEL[write.tool]}</Badge>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-ink">{OPERATION_LABEL[write.operation]}</div>
        <div className="max-w-md truncate text-ink-secondary">
          {summary === null ? (
            <span className="text-ink-muted">no title sent</span>
          ) : summary.sent ? (
            summary.text
          ) : (
            <>
              {summary.text}{' '}
              <span
                className="text-xs text-ink-muted"
                title="No title was sent; this is the title now"
              >
                (title now)
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {open === undefined ? null : (
            <a
              className="underline underline-offset-2"
              href={open}
              target="_blank"
              rel="noreferrer"
            >
              Open in {TOOL_LABEL[write.tool]}
            </a>
          )}
          {write.entityKind === 'initiative' && write.entityId !== null ? (
            <Link
              className="underline underline-offset-2"
              href={`/initiative/${encodeURIComponent(write.entityId)}`}
            >
              Open the initiative
            </Link>
          ) : null}
        </div>
        <details className="mt-1 text-xs text-ink-secondary">
          <summary className="cursor-pointer text-ink-muted">What was sent</summary>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            {fields.map((field) => (
              <FieldLine key={field.label} label={field.label} value={field.value} />
            ))}
            <FieldLine label="Object" value={write.externalId ?? 'none — nothing was made'} />
            <FieldLine label="Took" value={durationLabel(write.durationMs)} />
            <FieldLine label="Run" value={write.runId} />
          </dl>
        </details>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            'font-medium',
            write.outcome === 'succeeded' ? 'text-status-good' : 'text-status-critical',
          )}
        >
          {write.outcome === 'succeeded' ? 'Succeeded' : 'Failed'}
        </span>
        {write.outcome === 'failed' ? (
          <p className="mt-1 max-w-xs text-xs text-ink-secondary">
            {write.failure === null ? null : <code>{write.failure}</code>} {write.error ?? ''}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2 text-ink-secondary">{ORIGIN_LABEL[write.origin]}</td>
    </tr>
  );
}

function FieldLine({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="break-words whitespace-pre-wrap text-ink">{value}</dd>
    </>
  );
}

/**
 * Where the object can be opened, when the web tier knows how to build a link
 * to it: a Notion page, or a Todoist project. A task has no link template in
 * this deployment's configuration, so it is named by id in the detail instead.
 */
function openLink(
  write: ExternalWrite,
  links: { page: string | undefined; project: string | undefined },
): string | undefined {
  if (write.externalId === null) return undefined;
  if (write.operation === 'create_page') return pageUrl(links.page, write.externalId);
  if (write.operation === 'create_project') return pageUrl(links.project, write.externalId);
  return undefined;
}
