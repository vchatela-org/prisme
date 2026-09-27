import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../errors.js';
import {
  auditCreationWriter,
  auditDocumentCreationWriter,
  auditTaskToolWriter,
  type AuditOptions,
  type WriteAttempt,
} from './audit.js';
import { createFrozenWriter } from './frozen.js';
import {
  createRecordingCreationWriter,
  createRecordingDocumentCreationWriter,
} from './create/recording.js';
import { createRecordingWriter } from './recording.js';
import type { AnchorDraft } from './types.js';

const DRAFT: AnchorDraft = {
  projectId: 'project-0001',
  content: 'Anchor title',
  description: 'prisme: http://prisme.example/i/init-001',
  labels: ['prisme'],
  priority: 'high',
};

/** A clock that moves 25 ms every time it is read. */
function ticking(start = '2026-03-02T09:00:00.000Z'): () => Date {
  let at = new Date(start).getTime();
  return () => {
    const now = new Date(at);
    at += 25;
    return now;
  };
}

function harness(overrides: Partial<AuditOptions> = {}) {
  const recorded: WriteAttempt[] = [];
  const recordErrors: unknown[] = [];
  const options: AuditOptions = {
    sink: {
      record: (attempt) => {
        recorded.push(attempt);
        return Promise.resolve();
      },
    },
    now: ticking(),
    onRecordError: (error) => {
      recordErrors.push(error);
    },
    ...overrides,
  };
  return { options, recorded, recordErrors };
}

describe('auditTaskToolWriter', () => {
  it('records a successful create with the id the tool handed back', async () => {
    const { options, recorded } = harness();
    const inner = createRecordingWriter({ createdIds: ['task-0042'] });
    const writer = auditTaskToolWriter(inner.writer, options);

    const created = await writer.createTask(DRAFT, 'key-1');

    expect(created.externalId).toBe('task-0042');
    expect(inner.writes).toHaveLength(1);
    expect(recorded).toEqual([
      {
        tool: 'task',
        operation: 'create_anchor',
        request: { ...DRAFT },
        idempotencyKey: 'key-1',
        startedAt: new Date('2026-03-02T09:00:00.000Z'),
        durationMs: 25,
        outcome: 'succeeded',
        externalId: 'task-0042',
      },
    ]);
  });

  it('names the target of an update and a move, and records what was asked for', async () => {
    const { options, recorded } = harness();
    const writer = auditTaskToolWriter(createRecordingWriter().writer, options);

    await writer.updateTask('task-0007', { priority: 'highest', deadline: null }, 'key-2');
    await writer.moveTask('task-0007', { projectId: 'project-0002' }, 'key-3');

    expect(
      recorded.map((attempt) => [attempt.operation, attempt.externalId, attempt.request]),
    ).toEqual([
      ['update_task', 'task-0007', { priority: 'highest', deadline: null }],
      ['move_task', 'task-0007', { projectId: 'project-0002' }],
    ]);
  });

  it('records a failure with its connector kind, and still throws it', async () => {
    const { options, recorded } = harness();
    const writer = auditTaskToolWriter(createFrozenWriter(), options);

    await expect(writer.updateTask('task-0007', { priority: 'high' }, 'key-4')).rejects.toThrow(
      ConnectorError,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      operation: 'update_task',
      externalId: 'task-0007',
      outcome: 'failed',
      failure: 'refused',
    });
    expect(recorded[0]?.error).toContain('no outward write was attempted');
  });

  it('names no object for a create that failed', async () => {
    const { options, recorded } = harness();
    const writer = auditTaskToolWriter(createFrozenWriter(), options);

    await expect(writer.createTask(DRAFT, 'key-5')).rejects.toThrow();

    expect(recorded[0]?.externalId).toBeUndefined();
    expect(recorded[0]?.outcome).toBe('failed');
  });

  it('never records the message of an error that is not a connector error', async () => {
    const { options, recorded } = harness();
    const inner = createRecordingWriter({ failOn: () => true });
    const writer = auditTaskToolWriter(inner.writer, options);

    await expect(
      writer.updateTask('task-0007', { content: 'A real title' }, 'key-6'),
    ).rejects.toThrow('the recording writer was configured to fail on this write');

    expect(recorded[0]?.failure).toBe('unclassified');
    expect(recorded[0]?.error).not.toContain('recording writer');
  });

  it('lets a write stand when its record cannot be written', async () => {
    const sinkFailure = new Error('the database went away');
    const { options, recordErrors } = harness({
      sink: { record: () => Promise.reject(sinkFailure) },
    });
    const inner = createRecordingWriter({ createdIds: ['task-0099'] });
    const writer = auditTaskToolWriter(inner.writer, options);

    // The anchor exists in the tool now. Throwing here would skip the binding
    // that follows, and the next pass would create it a second time.
    await expect(writer.createTask(DRAFT, 'key-7')).resolves.toEqual({ externalId: 'task-0099' });
    expect(recordErrors).toEqual([sinkFailure]);
  });

  it('keeps the original failure when both the write and its record fail', async () => {
    const { options, recordErrors } = harness({
      sink: { record: () => Promise.reject(new Error('sink down')) },
    });
    const writer = auditTaskToolWriter(createFrozenWriter(), options);

    await expect(writer.moveTask('task-0007', { projectId: 'p' }, 'key-8')).rejects.toThrow(
      ConnectorError,
    );
    expect(recordErrors).toHaveLength(1);
  });
});

describe('auditCreationWriter', () => {
  it('records each creating operation under its own name', async () => {
    const { options, recorded } = harness();
    const inner = createRecordingCreationWriter({ createdIds: ['p-1', 's-1', 't-1'] });
    const writer = auditCreationWriter(inner.writer, options);

    await writer.createProject({ name: 'A project' }, 'k-1');
    await writer.createSection({ projectId: 'p-1', name: 'A section', order: 1 }, 'k-2');
    await writer.createLooseTask(
      { projectId: 'p-1', content: 'A capture', description: 'backlink', labels: [] },
      'k-3',
    );

    expect(
      recorded.map((attempt) => [attempt.tool, attempt.operation, attempt.externalId]),
    ).toEqual([
      ['task', 'create_project', 'p-1'],
      ['task', 'create_section', 's-1'],
      ['task', 'create_capture_task', 't-1'],
    ]);
  });
});

describe('auditDocumentCreationWriter', () => {
  it('records a page against the document tool', async () => {
    const { options, recorded } = harness();
    const inner = createRecordingDocumentCreationWriter({ createdIds: ['page-1'] });
    const writer = auditDocumentCreationWriter(inner.writer, options);

    await writer.createPage({ kind: 'initiative', title: 'A page', templateId: 'tpl-1' }, 'k-9');

    expect(recorded[0]).toMatchObject({
      tool: 'document',
      operation: 'create_page',
      externalId: 'page-1',
      request: { kind: 'initiative', title: 'A page', templateId: 'tpl-1' },
      outcome: 'succeeded',
    });
  });
});
