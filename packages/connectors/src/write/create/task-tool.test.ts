import { describe, expect, it } from 'vitest';
import { isConnectorError } from '../../errors.js';
import { createFixtureTransport } from '../../testing/fixture-transport.js';
import { idempotencyKey } from '../idempotency.js';
import { createFrozenCreationWriter } from './frozen.js';
import { createRecordingCreationWriter } from './recording.js';
import { createTaskToolCreationWriter } from './task-tool.js';
import type { LooseTaskDraft } from './types.js';

type CommandArgs = Record<string, unknown>;

const KEY = idempotencyKey({ runId: 'intent-1', operation: 'create', subject: 'project-1' });

function commandsOf(body: string | undefined): { type: string; uuid: string; args: CommandArgs }[] {
  const form = new URLSearchParams(body ?? '');
  return JSON.parse(form.get('commands') ?? '[]') as {
    type: string;
    uuid: string;
    args: CommandArgs;
  }[];
}

/** Answers `ok` and hands back `made-…` for whatever temp id was sent. */
function respondCreated(externalId: string) {
  return (request: { body?: string | undefined }) => {
    const uuid = commandsOf(request.body)[0]?.uuid ?? '';
    return {
      body: JSON.stringify({
        sync_status: { [uuid]: 'ok' },
        temp_id_mapping: { [uuid]: externalId },
      }),
    };
  };
}

function writerOver(respond: (request: { body?: string | undefined }) => { body: string }) {
  const fixture = createFixtureTransport([{ matches: () => true, respond }]);
  return {
    fixture,
    writer: createTaskToolCreationWriter({
      token: 'not-a-real-token',
      transport: fixture.transport,
    }),
  };
}

describe('the task-tool creating writer', () => {
  it('creates a project and returns the id the tool assigned', async () => {
    const { fixture, writer } = writerOver(respondCreated('project-9001'));

    const result = await writer.createProject({ name: 'A large effort' }, KEY);

    expect(result.externalId).toBe('project-9001');
    const command = commandsOf(fixture.requests[0]?.body)[0];
    expect(command?.type).toBe('project_add');
    expect(command?.uuid).toBe(KEY);
    expect(command?.args).toEqual({ name: 'A large effort' });
  });

  it('nests under a parent only when one was asked for', async () => {
    const { fixture, writer } = writerOver(respondCreated('project-9002'));

    await writer.createProject({ name: 'Nested', parentId: 'project-0001' }, KEY);

    expect(commandsOf(fixture.requests[0]?.body)[0]?.args).toEqual({
      name: 'Nested',
      parent_id: 'project-0001',
    });
  });

  /**
   * The order is sent rather than left to the tool. prisme's sections are an
   * ordered list, and a converge pass resuming after a failure creates only
   * the ones still missing — so position cannot come from call order.
   */
  it('sends a section’s position, so a resumed run does not renumber the rest', async () => {
    const { fixture, writer } = writerOver(respondCreated('section-9001'));

    await writer.createSection({ projectId: 'project-9001', name: 'Third', order: 2 }, KEY);

    const command = commandsOf(fixture.requests[0]?.body)[0];
    expect(command?.type).toBe('section_add');
    expect(command?.args).toEqual({
      name: 'Third',
      project_id: 'project-9001',
      section_order: 2,
    });
  });

  /**
   * The capture shape's whole point, asserted on the wire: no priority, no
   * deadline, and no anchor label. A `priority` here would be a rank no
   * scoring method produced; the anchor label would make the reconciler adopt
   * this task as an initiative's anchor on its next pass.
   */
  it('creates a capture as a plain task, with no priority and no deadline', async () => {
    const { fixture, writer } = writerOver(respondCreated('task-9100'));

    const draft: LooseTaskDraft = {
      projectId: 'project-0001',
      sectionId: 'section-0001',
      content: 'Something small',
      description: 'prisme: http://prisme.example/capture/c-1',
      labels: ['prisme-capture'],
    };
    await writer.createLooseTask(draft, KEY);

    const command = commandsOf(fixture.requests[0]?.body)[0];
    expect(command?.type).toBe('item_add');
    expect(command?.args).toEqual({
      content: 'Something small',
      description: 'prisme: http://prisme.example/capture/c-1',
      project_id: 'project-0001',
      section_id: 'section-0001',
      labels: ['prisme-capture'],
    });
    expect(command?.args).not.toHaveProperty('priority');
    expect(command?.args).not.toHaveProperty('deadline');
  });

  it('sends the key as the command id and as the temporary id', async () => {
    const { fixture, writer } = writerOver(respondCreated('project-9003'));

    await writer.createProject({ name: 'Keyed' }, KEY);

    const raw = JSON.parse(
      new URLSearchParams(fixture.requests[0]?.body ?? '').get('commands') ?? '[]',
    ) as { uuid: string; temp_id: string }[];
    expect(raw[0]?.uuid).toBe(KEY);
    expect(raw[0]?.temp_id).toBe(KEY);
  });

  it('refuses a key that is not UUID-shaped rather than sending an unrecognisable retry', async () => {
    const { fixture, writer } = writerOver(respondCreated('project-9004'));

    await expect(writer.createProject({ name: 'Bad key' }, 'not-a-uuid')).rejects.toSatisfy(
      (error: unknown) => isConnectorError(error) && error.failure === 'refused',
    );
    expect(fixture.requests).toHaveLength(0);
  });

  /**
   * A create the tool accepted but did not name is the orphan the whole ledger
   * exists to prevent: an object in the workspace nothing points at. It has to
   * throw, because the alternative is recording a satisfied intent with no id.
   */
  it('fails when the tool accepts a create without naming what it made', async () => {
    const { writer } = writerOver((request) => {
      const uuid = commandsOf(request.body)[0]?.uuid ?? '';
      return { body: JSON.stringify({ sync_status: { [uuid]: 'ok' } }) };
    });

    await expect(
      writer.createSection({ projectId: 'p', name: 's', order: 0 }, KEY),
    ).rejects.toSatisfy(
      (error: unknown) => isConnectorError(error) && error.failure === 'invalid_shape',
    );
  });

  it('surfaces the tool’s error code and never its prose', async () => {
    const { writer } = writerOver((request) => {
      const uuid = commandsOf(request.body)[0]?.uuid ?? '';
      return {
        body: JSON.stringify({
          sync_status: {
            [uuid]: { error_code: 43, error: 'Project "Renovate the actual house" is invalid' },
          },
        }),
      };
    });

    await expect(writer.createProject({ name: 'Anything' }, KEY)).rejects.toSatisfy(
      (error: unknown) =>
        isConnectorError(error) &&
        error.failure === 'refused' &&
        error.message.includes('43') &&
        !error.message.includes('Renovate'),
    );
  });
});

describe('the frozen creating writer', () => {
  it('refuses every creation, so a mistaken branch cannot reach an API', async () => {
    const frozen = createFrozenCreationWriter();

    for (const attempt of [
      () => frozen.createProject({ name: 'x' }, KEY),
      () => frozen.createSection({ projectId: 'p', name: 's', order: 0 }, KEY),
      () =>
        frozen.createLooseTask({ projectId: 'p', content: 'c', description: 'd', labels: [] }, KEY),
    ]) {
      await expect(attempt()).rejects.toSatisfy(
        (error: unknown) => isConnectorError(error) && error.failure === 'refused',
      );
    }
  });
});

describe('the recording creating writer', () => {
  it('replays the same id for a repeated key, the way the tool does', async () => {
    const recording = createRecordingCreationWriter({ replayById: true });

    const first = await recording.writer.createProject({ name: 'Once' }, KEY);
    const again = await recording.writer.createProject({ name: 'Once' }, KEY);

    expect(again.externalId).toBe(first.externalId);
    expect(recording.creations).toHaveLength(2);
  });

  it('hands back distinct ids for distinct keys', async () => {
    const recording = createRecordingCreationWriter({ replayById: true });
    const other = idempotencyKey({ runId: 'intent-2', operation: 'create', subject: 'project-2' });

    const first = await recording.writer.createProject({ name: 'One' }, KEY);
    const second = await recording.writer.createProject({ name: 'Two' }, other);

    expect(second.externalId).not.toBe(first.externalId);
  });
});
