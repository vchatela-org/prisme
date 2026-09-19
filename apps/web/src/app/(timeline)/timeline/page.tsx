import { Badge, Card, EmptyState, Section, StatRow, StatTile } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaDetailListSchema,
  projectListSchema,
  timelineSchema,
  type TimelineEntry,
} from '@/lib/contracts';
import { BOUND_BY_LABEL } from '@/lib/timeline-view';
import { TimelineBoard } from './timeline-board';

export const metadata = {
  title: 'Timeline · prisme',
  description: 'When each initiative is planned, what it waits on, and what a move would cost.',
};

/**
 * The Timeline.
 *
 * Dependencies only matter if you can see them move. That is the requirement
 * the brief states and it is narrower than "draw a Gantt": **when one thing
 * moves, the things that depend on it move too**, and a deadline that becomes
 * impossible is flagged rather than quietly broken.
 *
 * ## Nothing here computes a date
 *
 * The plan arrives from `GET /timeline`, computed by `packages/domain`'s CPM
 * engine (W02). A drag asks `GET /timeline/replan` what a move would do and
 * renders the answer; committing writes `earliest_start` and nothing else. The
 * temptation the brief warns about is strongest during the drag — working out
 * where the bar "obviously" lands — and giving in to it produces a preview that
 * disagrees with what gets saved.
 *
 * ## Why the table is not an afterthought
 *
 * Three of this screen's encodings are visual — a stroke for the critical path,
 * a marker for a deadline, a wash for a saturated area — and every one of them
 * is a column below. That is the design system's rule for charts
 * (`packages/ui/CLAUDE.md`), and it is also the only way to read the plan with
 * a screen reader, in forced-colours mode, or sorted by slack.
 */
export default async function TimelinePage() {
  const [timeline, areas, projects] = await Promise.all([
    apiFetch({ path: '/timeline', schema: timelineSchema }),
    apiFetch({ path: '/areas', schema: areaDetailListSchema }),
    apiFetch({ path: '/projects', query: { limit: '200' }, schema: projectListSchema }),
  ]);

  if (!timeline.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={timeline} surface="the timeline" />
      </div>
    );
  }

  const plan = timeline.data;

  if (plan.initiatives.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <EmptyState
          title="There is nothing to schedule yet"
          description="The Timeline plans open initiatives — done and dropped work is not scheduled and blocks nothing. Once the backlog holds something open, this is where its dates, its dependencies and its critical path appear."
        />
      </div>
    );
  }

  const criticalCount = plan.criticalPath.length;
  const infeasible = plan.infeasibleDeadlines.length;
  const deadlines = plan.initiatives.filter((entry) => entry.deadline !== null).length;

  // The server owns the clock. A `new Date()` inside the board would be the
  // browser's idea of today, and a plan is computed in UTC working days.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
      <Header
        span={`${plan.projectStart} → ${plan.projectEnd ?? plan.projectStart}`}
        weightYear={plan.weightYear}
      />

      {plan.weightsStale ? (
        <Card className="border-status-warning p-4 text-sm text-ink">
          The capacity behind this plan comes from {plan.weightYear}&rsquo;s weights, which were
          carried forward rather than decided for the year. How many initiatives each area may run
          at once is derived from them, so every date below rests on a decision nobody has made yet.{' '}
          <Link href="/review/year" className="underline">
            Open the Year Review
          </Link>
          .
        </Card>
      ) : null}

      <StatRow>
        <StatTile label="Initiatives planned" value={String(plan.initiatives.length)} />
        <StatTile label="On the critical path" value={String(criticalCount)} />
        <StatTile label="Deadlines" value={deadlines === 0 ? 'None' : `${String(deadlines)} set`} />
        <StatTile label="Deadlines the plan misses" value={String(infeasible)} />
      </StatRow>

      {infeasible > 0 ? (
        <Card className="border-status-critical p-4 text-sm text-ink">
          {infeasible === 1 ? 'One deadline' : `${String(infeasible)} deadlines`} cannot be met by
          this plan. prisme flags that and never moves a deadline to make the arithmetic work
          (ADR-0003) — the answer is to start something sooner, make it smaller, or agree the date
          has changed.
        </Card>
      ) : null}

      {plan.danglingRefs.length > 0 ? (
        <Card className="border-status-warning p-4 text-sm text-ink">
          {plan.danglingRefs.length === 1
            ? 'One dependency'
            : `${String(plan.danglingRefs.length)} dependencies`}{' '}
          point at work that is not in this plan, so nothing holds the dependent back and no edge is
          drawn for it. The plan is optimistic exactly there, which is why it says so rather than
          looking complete.
        </Card>
      ) : null}

      <TimelineBoard
        timeline={plan}
        areas={
          areas.ok
            ? areas.data.items.map((area) => ({ key: area.key, name: area.name, kind: area.kind }))
            : []
        }
        projects={
          projects.ok
            ? projects.data.items.map((project) => ({ id: project.id, name: project.name }))
            : []
        }
        today={today}
      />

      <Section
        title="The same plan, as a table"
        description="Every encoding above is a column here — the critical path, the constraint that set each date, and whether a deadline can be met. In plan order, and readable without colour."
      >
        <PlanTable entries={plan.initiatives} critical={new Set(plan.criticalPath)} />
      </Section>
    </div>
  );
}

/**
 * The table twin.
 *
 * A server-rendered table rather than `<DataTable>`, which is a client
 * component: this is the copy that has to work when the board does not, so it
 * is the copy with no JavaScript in it. Sorting it is a job for the Backlog,
 * which is the screen built for searching.
 */
function PlanTable({
  entries,
  critical,
}: {
  entries: readonly TimelineEntry[];
  critical: ReadonlySet<string>;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Every planned initiative, with its dates, what bound them, and its deadline.
        </caption>
        <thead>
          <tr className="border-b border-border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              Initiative
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Area
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Planned
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Slack
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Bound by
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Deadline
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.initiativeId} className="border-b border-border-hairline last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                <Link href={`/initiative/${entry.initiativeId}`} className="hover:underline">
                  {entry.title}
                </Link>
                {critical.has(entry.initiativeId) ? (
                  <Badge variant="outline" className="ml-2">
                    Critical path
                  </Badge>
                ) : null}
              </th>
              <td className="px-3 py-2 text-ink-secondary">{entry.areaKey}</td>
              <td className="px-3 py-2 tabular-nums text-ink-secondary">
                {entry.plannedStart} → {entry.plannedEnd}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                {entry.slackDays}
              </td>
              <td className="px-3 py-2 text-ink-secondary">{BOUND_BY_LABEL[entry.boundBy]}</td>
              <td className="px-3 py-2 tabular-nums">
                {entry.deadline === null ? (
                  <span className="text-ink-muted">—</span>
                ) : entry.deadlineFeasible ? (
                  <span className="text-ink-secondary">{entry.deadline}</span>
                ) : (
                  <span className="text-status-critical">{entry.deadline} · missed</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Header({ span, weightYear }: { span?: string; weightYear?: number }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Timeline</h1>
        <p className="text-sm text-ink-secondary">
          When each initiative is planned, what it waits on, and what moving one would cost.
        </p>
      </div>
      {span === undefined ? null : (
        <p className="text-xs text-ink-muted tabular-nums">
          {span}
          {weightYear === undefined ? '' : ` · capacity from ${String(weightYear)}'s weights`}
        </p>
      )}
    </header>
  );
}
