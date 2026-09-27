import type {
  ExternalWrite,
  WriteAuditOperation,
  WriteAuditOrigin,
  WriteAuditTool,
} from './contracts';

/**
 * How the audit screen says what a recorded call was (ADR-0031).
 *
 * Pure, and separate from the page so the wording can be tested: which tool,
 * which operation, what the call was about in one line, and what it sent,
 * field by field. The screen renders what the API recorded and never
 * re-derives it — a request is shown as it was sent, with no claim about what
 * the tool did with it beyond the outcome.
 */

export const TOOL_LABEL: Readonly<Record<WriteAuditTool, string>> = {
  document: 'Notion',
  task: 'Todoist',
};

export const OPERATION_LABEL: Readonly<Record<WriteAuditOperation, string>> = {
  create_anchor: 'Create anchor task',
  update_task: 'Update task',
  move_task: 'Move task',
  create_project: 'Create project',
  create_section: 'Create section',
  create_capture_task: 'Create capture task',
  create_page: 'Create page',
};

export const ORIGIN_LABEL: Readonly<Record<WriteAuditOrigin, string>> = {
  reconciler: 'Sync',
  creation: 'Creation',
};

/** The fields a draft names itself by, in the order they are looked for. */
const NAMING_FIELDS = ['content', 'title', 'name'] as const;

export interface WriteSummary {
  readonly text: string;
  /** `true` when the text is what the call sent; `false` when it is the entity's title now. */
  readonly sent: boolean;
}

/**
 * The one line that says what a call was about.
 *
 * The title, content or name the call **sent**, when it sent one. An update
 * that changed only a priority or a deadline, and a move, send none — for those
 * the line is the entity's title as it is now, and says so, because a title
 * read today is not a title that was sent then. `null` when there is neither.
 */
export function writeSummary(
  write: Pick<ExternalWrite, 'request' | 'entityTitle'>,
): WriteSummary | null {
  for (const field of NAMING_FIELDS) {
    const value = write.request[field];
    if (typeof value === 'string' && value.trim() !== '') return { text: value, sent: true };
  }
  if (write.entityTitle !== null && write.entityTitle.trim() !== '') {
    return { text: write.entityTitle, sent: false };
  }
  return null;
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  content: 'Content',
  title: 'Title',
  name: 'Name',
  description: 'Description',
  labels: 'Labels',
  priority: 'Priority',
  deadline: 'Deadline',
  projectId: 'Project',
  sectionId: 'Section',
  parentId: 'Parent project',
  order: 'Position',
  kind: 'Page kind',
  templateId: 'Template',
};

export interface RequestField {
  readonly label: string;
  readonly value: string;
}

function show(value: unknown): string {
  if (value === null) return 'cleared';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.map((item) => show(item)).join(', ');
  }
  return JSON.stringify(value);
}

/**
 * What the call sent, field by field, in the order prisme built it.
 *
 * `null` is shown as *cleared* because that is what it means on this path: an
 * update with `deadline: null` removes the deadline, and an update that left
 * the deadline alone does not carry the field at all (`TaskPatch`).
 */
export function requestFields(write: Pick<ExternalWrite, 'request'>): readonly RequestField[] {
  return Object.entries(write.request).map(([field, value]) => ({
    label: FIELD_LABEL[field] ?? field,
    value: show(value),
  }));
}

/** "340 ms", "1.2 s" — how long the call took. */
export function durationLabel(milliseconds: number): string {
  return milliseconds < 1000
    ? `${String(Math.round(milliseconds))} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
}
