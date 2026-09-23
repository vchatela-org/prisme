import { describe, expect, it } from 'vitest';
import { parseCalendarDate, TASK_PRIORITIES, type TaskPriority } from '@prisme/domain';
import { createFixtureTransport } from '../testing/fixture-transport.js';
import { mapTask } from '../task-tool/map.js';
import type { WireItem } from '../task-tool/wire.js';
import { isConnectorError } from '../errors.js';
import { createTaskToolWriter } from './task-tool.js';
import { createFrozenWriter } from './frozen.js';
import { idempotencyKey, isUuid } from './idempotency.js';
import type { AnchorDraft } from './types.js';

const KEY = idempotencyKey({ runId: 'run-1', operation: 'test', subject: 'anchor-1' });

const DRAFT: AnchorDraft = {
  projectId: 'project-0001',
  sectionId: 'section-0001',
  content: 'Anchor title',
  description: 'prisme: http://prisme.example/i/init-001',
  labels: ['prisme'],
  priority: 'high',
  deadline: parseCalendarDate('2026-10-01'),
};

function commandsOf(body: string | undefined): { type: string; uuid: string; args: CommandArgs }[] {
  const form = new URLSearchParams(body ?? '');
  return JSON.parse(form.get('commands') ?? '[]') as {
    type: string;
    uuid: string;
    args: CommandArgs;
  }[];
}

type CommandArgs = Record<string, unknown>;

function respondOk(extra: Record<string, unknown> = {}) {
  return (request: { body?: string | undefined }) => {
    const uuid = commandsOf(request.body)[0]?.uuid ?? '';
    return { body: JSON.stringify({ sync_status: { [uuid]: 'ok' }, ...extra }) };
  };
}

function writerOver(respond: ReturnType<typeof respondOk>) {
  const fixture = createFixtureTransport([{ matches: () => true, respond }]);
  const writer = createTaskToolWriter({ token: 'not-a-real-token', transport: fixture.transport });
  return { fixture, writer };
}

describe('the task-tool writer', () => {
  it('creates an anchor and returns the id the tool assigned', async () => {
    const { fixture, writer } = writerOver((request) => {
      const uuid = commandsOf(request.body)[0]?.uuid ?? '';
      return {
        body: JSON.stringify({
          sync_status: { [uuid]: 'ok' },
          temp_id_mapping: { [uuid]: 'task-9001' },
        }),
      };
    });

    const result = await writer.createTask(DRAFT, KEY);

    expect(result.externalId).toBe('task-9001');
    const command = commandsOf(fixture.requests[0]?.body)[0];
    expect(command?.type).toBe('item_add');
    expect(command?.uuid).toBe(KEY);
    expect(command?.args).toMatchObject({
      content: 'Anchor title',
      project_id: 'project-0001',
      section_id: 'section-0001',
      labels: ['prisme'],
      priority: 3,
      deadline: { date: '2026-10-01' },
    });
  });

  it('sends only the fields an update actually changes', async () => {
    const { fixture, writer } = writerOver(respondOk());

    await writer.updateTask('task-1', { priority: 'highest' }, KEY);

    expect(commandsOf(fixture.requests[0]?.body)[0]?.args).toEqual({
      id: 'task-1',
      priority: 4,
    });
  });

  it('clears a deadline with null and leaves it alone when absent', async () => {
    const { fixture, writer } = writerOver(respondOk());

    await writer.updateTask('task-1', { deadline: null }, KEY);
    await writer.updateTask('task-1', { content: 'renamed' }, KEY);

    expect(commandsOf(fixture.requests[0]?.body)[0]?.args).toEqual({
      id: 'task-1',
      deadline: null,
    });
    expect(commandsOf(fixture.requests[1]?.body)[0]?.args).toEqual({
      id: 'task-1',
      content: 'renamed',
    });
  });

  it('refuses an update that would change nothing', async () => {
    const { writer } = writerOver(respondOk());
    await expect(writer.updateTask('task-1', {}, KEY)).rejects.toThrow(/no decision/);
  });

  it('refuses a key that is not a UUID, because a retry could not be recognised', async () => {
    const { writer } = writerOver(respondOk());
    await expect(writer.updateTask('task-1', { priority: 'high' }, 'not-a-uuid')).rejects.toThrow(
      /idempotency key/,
    );
  });

  it('reports a refused command by code, and never quotes the tool’s message', async () => {
    const { writer } = writerOver((request) => {
      const uuid = commandsOf(request.body)[0]?.uuid ?? '';
      return {
        body: JSON.stringify({
          sync_status: {
            [uuid]: { error_code: 15, error: 'Invalid task: Buy a present for someone real' },
          },
        }),
      };
    });

    const error = await writer
      .updateTask('task-1', { priority: 'high' }, KEY)
      .catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as Error).message).toContain('error code 15');
    expect((error as Error).message).not.toContain('present');
  });

  it('fails when the response does not say what happened to the command', async () => {
    const { writer } = writerOver(() => ({ body: JSON.stringify({ sync_status: {} }) }));
    await expect(writer.updateTask('task-1', { priority: 'high' }, KEY)).rejects.toThrow(
      /no status for the command/,
    );
  });

  it('fails a create whose new id never arrives, rather than linking nothing', async () => {
    const { writer } = writerOver(respondOk());
    await expect(writer.createTask(DRAFT, KEY)).rejects.toThrow(/no id for it/);
  });

  it('moves into a section when there is one, and a project when there is not', async () => {
    const { fixture, writer } = writerOver(respondOk());

    await writer.moveTask('task-1', { projectId: 'project-1', sectionId: 'section-2' }, KEY);
    await writer.moveTask('task-1', { projectId: 'project-1' }, KEY);

    expect(commandsOf(fixture.requests[0]?.body)[0]?.args).toEqual({
      id: 'task-1',
      section_id: 'section-2',
    });
    expect(commandsOf(fixture.requests[1]?.body)[0]?.args).toEqual({
      id: 'task-1',
      project_id: 'project-1',
    });
  });

  /**
   * The rule this package exists to keep: prisme writes `deadline`, never
   * `due` (ADR-0003). Asserted on the wire rather than on the interface,
   * because the interface is only half of the promise.
   */
  it('never sends a due date, whatever it is asked to write', async () => {
    const { fixture, writer } = writerOver(respondOk({ temp_id_mapping: {} }));

    await writer
      .updateTask('task-1', { deadline: parseCalendarDate('2026-10-01') }, KEY)
      .catch(() => undefined);
    await writer.createTask(DRAFT, KEY).catch(() => undefined);
    await writer.moveTask('task-1', { projectId: 'p' }, KEY).catch(() => undefined);

    for (const request of fixture.requests) {
      expect(request.body ?? '').not.toMatch(/"due"/);
    }
  });

  it('maps every priority back to the value the read path maps it from', async () => {
    for (const priority of TASK_PRIORITIES) {
      const wireValue = await wireValueFor(priority);
      const item: WireItem = {
        id: 'task-1',
        project_id: 'project-1',
        content: 'x',
        priority: wireValue,
        labels: [],
        checked: false,
        is_deleted: false,
      };
      expect(mapTask(item, 'test').priority).toBe(priority);
    }
  });
});

/** Reads the value the writer would send, through the writer itself. */
async function wireValueFor(priority: TaskPriority): Promise<number> {
  const { fixture, writer } = writerOver(respondOk());
  await writer.updateTask('task-1', { priority }, KEY);
  return commandsOf(fixture.requests[0]?.body)[0]?.args['priority'] as number;
}

describe('idempotency keys', () => {
  it('are UUID-shaped, so the tool accepts them', () => {
    expect(isUuid(idempotencyKey({ runId: 'r', operation: 'o', subject: 's' }))).toBe(true);
  });

  it('repeat for the same write in the same pass, so a retry cannot apply twice', () => {
    const first = idempotencyKey({ runId: 'r', operation: 'update', subject: 'task-1' });
    const second = idempotencyKey({ runId: 'r', operation: 'update', subject: 'task-1' });
    expect(first).toBe(second);
  });

  it('differ in the next pass, so a later decision is not discarded as a duplicate', () => {
    const first = idempotencyKey({ runId: 'r1', operation: 'update', subject: 'task-1' });
    const second = idempotencyKey({ runId: 'r2', operation: 'update', subject: 'task-1' });
    expect(first).not.toBe(second);
  });

  it('differ for two changes to the same subject in one pass', () => {
    const first = idempotencyKey({
      runId: 'r',
      operation: 'update',
      subject: 'task-1',
      payload: { priority: 'high' },
    });
    const second = idempotencyKey({
      runId: 'r',
      operation: 'update',
      subject: 'task-1',
      payload: { priority: 'lowest' },
    });
    expect(first).not.toBe(second);
  });
});

describe('the frozen writer', () => {
  it('refuses every write, so the freeze does not depend on remembering a flag', async () => {
    const frozen = createFrozenWriter();
    await expect(frozen.createTask(DRAFT, KEY)).rejects.toThrow(/write freeze/);
    await expect(frozen.updateTask('task-1', { priority: 'high' }, KEY)).rejects.toThrow(
      /write freeze/,
    );
    await expect(frozen.moveTask('task-1', { projectId: 'p' }, KEY)).rejects.toThrow(
      /write freeze/,
    );
  });
});
