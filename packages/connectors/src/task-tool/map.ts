import { isCalendarDate, type CalendarDate, type TaskPriority } from '@prisme/domain';
import { ConnectorError } from '../errors.js';
import { contentHash } from '../hash.js';
import { collectUrls, sanitisePlainText, sanitiseRichText } from '../sanitise.js';
import type {
  Completion,
  ExternalDuration,
  ExternalLabel,
  ExternalProject,
  ExternalSection,
  ExternalTask,
} from './types.js';
import type { WireCompletedItem, WireItem, WireLabel, WireProject, WireSection } from './wire.js';

/**
 * Wire record → typed record. Mapping, and nothing else.
 *
 * Every conversion in this file is one the tool's documentation states or the
 * ownership matrix requires. Where neither does, the value is carried through
 * untouched or left absent — it is never inferred. "Never guess a mapping"
 * (packages/connectors/CLAUDE.md §3) is not about malformed input; it is about
 * the reasonable-looking assumption that turns out to be wrong on row 4,000.
 */

const TOOL = 'task' as const;

/**
 * The tool's four priority levels, in prisme's vocabulary
 * (docs/10-model.md §6). The wire value counts *up* to most urgent, which is
 * the opposite of every ranked list in prisme, and getting it backwards is an
 * easy and quiet mistake — hence a table rather than arithmetic.
 */
const PRIORITY_BY_WIRE_VALUE: Readonly<Record<number, TaskPriority>> = {
  4: 'highest',
  3: 'high',
  2: 'medium',
  1: 'lowest',
};

function mapPriority(wireValue: number, operation: string): TaskPriority {
  const priority = PRIORITY_BY_WIRE_VALUE[wireValue];
  if (priority === undefined) {
    throw new ConnectorError(
      'invalid_shape',
      `priority ${String(wireValue)} is outside the documented range 1–4 and has no mapping`,
      { tool: TOOL, operation },
    );
  }
  return priority;
}

/** Fractional seconds beyond milliseconds, which some tools emit and `Date` does not promise to parse. */
const OVERLONG_FRACTION = /(\.\d{3})\d+/;

export function parseInstant(raw: string, field: string, operation: string): Date {
  const normalised = raw.replace(OVERLONG_FRACTION, '$1');
  const at = new Date(normalised);
  if (Number.isNaN(at.getTime())) {
    // The field is named; the value is not. A timestamp is harmless, but the
    // habit of interpolating response values into errors is not.
    throw new ConnectorError('invalid_shape', `${field} is not a timestamp`, {
      tool: TOOL,
      operation,
    });
  }
  return at;
}

/**
 * The calendar day of a wire date.
 *
 * A time of day is discarded on purpose: prisme compares deadlines as calendar
 * facts, in whole UTC days (packages/domain `entities/calendar.ts`). Keeping
 * the time would put an instant and a calendar date on the two sides of the
 * same comparison, which is how an off-by-one appears at 23:00 and is gone by
 * morning.
 */
export function parseCalendarDay(raw: string, field: string, operation: string): CalendarDate {
  const day = raw.slice(0, 10);
  if (!isCalendarDate(day)) {
    throw new ConnectorError('invalid_shape', `${field} is not a YYYY-MM-DD calendar date`, {
      tool: TOOL,
      operation,
    });
  }
  return day;
}

function mapDuration(
  duration: { amount: number; unit: 'minute' | 'day' } | null | undefined,
): ExternalDuration | undefined {
  return duration == null ? undefined : { amount: duration.amount, unit: duration.unit };
}

/** Minutes, and only for a duration actually measured in minutes — see `ExternalDuration`. */
function minutesOf(duration: ExternalDuration | undefined): number | undefined {
  return duration !== undefined && duration.unit === 'minute' ? duration.amount : undefined;
}

export function mapTask(item: WireItem, operation: string): ExternalTask {
  const description = sanitiseRichText([{ text: item.description ?? '' }]);
  const content = sanitisePlainText(item.content);
  const duration = mapDuration(item.duration);

  const due =
    item.due == null
      ? undefined
      : {
          date: parseCalendarDay(item.due.date, 'due.date', operation),
          isRecurring: item.due.is_recurring ?? false,
        };

  const task = {
    externalId: item.id,
    projectId: item.project_id,
    sectionId: item.section_id ?? undefined,
    parentId: item.parent_id ?? undefined,
    content,
    description,
    labels: [...item.labels].sort(),
    priority: mapPriority(item.priority, operation),
    completed: item.checked,
    completedAt:
      item.completed_at == null
        ? undefined
        : parseInstant(item.completed_at, 'completed_at', operation),
    due,
    deadline:
      item.deadline == null
        ? undefined
        : parseCalendarDay(item.deadline.date, 'deadline.date', operation),
    recordedDuration: duration,
    recordedMinutes: minutesOf(duration),
    order: item.child_order ?? 0,
    // A URL in a title is as fetchable as one in a body, and as untrusted.
    urls: [...new Set([...description.urls, ...collectUrls(content)])],
  } satisfies Omit<ExternalTask, 'contentHash'>;

  return { ...task, contentHash: hashTask(task) };
}

/**
 * The hash that decides whether a task changed.
 *
 * `order` is excluded: dragging a task up a list changes it constantly and
 * means nothing to prisme, and a hash that moves for reasons prisme does not
 * care about is a hash that reports change on every run.
 */
function hashTask(task: Omit<ExternalTask, 'contentHash'>): string {
  return contentHash({
    content: task.content,
    description: task.description.text,
    labels: task.labels,
    priority: task.priority,
    completed: task.completed,
    projectId: task.projectId,
    sectionId: task.sectionId,
    parentId: task.parentId,
    due: task.due,
    deadline: task.deadline,
    duration: task.recordedDuration,
  });
}

export function mapProject(project: WireProject): ExternalProject {
  return {
    externalId: project.id,
    name: sanitisePlainText(project.name),
    parentId: project.parent_id ?? undefined,
    archived: project.is_archived,
    order: project.child_order ?? 0,
  };
}

export function mapSection(section: WireSection): ExternalSection {
  return {
    externalId: section.id,
    projectId: section.project_id,
    name: sanitisePlainText(section.name),
    archived: section.is_archived,
    order: section.section_order ?? 0,
  };
}

export function mapLabel(label: WireLabel): ExternalLabel {
  return {
    externalId: label.id,
    name: sanitisePlainText(label.name),
    order: label.item_order ?? 0,
  };
}

export function mapCompletion(item: WireCompletedItem, operation: string): Completion {
  const duration = mapDuration(item.duration);
  return {
    // The completion endpoint returns the task itself, so its id is `id` —
    // v9's `task_id` field no longer exists on the wire (see `wire.ts`).
    externalTaskId: item.id,
    projectId: item.project_id ?? undefined,
    sectionId: item.section_id ?? undefined,
    completedAt: parseInstant(item.completed_at, 'completed_at', operation),
    recordedMinutes: minutesOf(duration),
    recordedDuration: duration,
  };
}
