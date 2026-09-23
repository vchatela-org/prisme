import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '@prisme/observability';
import { createConfirmationService, type ConfirmationService } from '../auth/confirmation.js';
import { createMemoryAuthStore } from '../auth/memory-store.js';
import { ApiError } from '../http/errors.js';
import type { Authorizer, Identity } from '../http/authorize.js';
import { SCOPE_NAMES, type Scope } from '../http/scopes.js';
import type { Services } from '../services/index.js';
import { mcpTools } from './index.js';
import { mountMcp, MCP_PATH } from './mount.js';
import { JSON_RPC, PROTOCOL_VERSION } from './protocol.js';
import { createMcpServer, PROTOCOL_SCOPE } from './server.js';
import { defineReadTool, defineWriteTool, type McpTool } from './tool.js';

/**
 * The dispatcher and the transport, without a database.
 *
 * The tools used here are **invented for the test**, not prisme's real ones.
 * That is deliberate: what is being checked is the machinery every tool passes
 * through — the dry run, the binding of a confirmation to a diff, the scope
 * check, the transport's status codes — and a two-field fake makes each of
 * those a short test with an obvious diff. The real tools meet a real database
 * in `mcp.integration.test.ts`, which is where the failures a fake cannot have
 * live.
 */

const logger = createLogger({ service: 'mcp-test', level: 'fatal' });

const PINNED_NOW = new Date('2026-09-18T09:00:00.000Z');

/** Mutable, so a test can move the world between a dry run and its confirmation. */
let world = { status: 'next' };

const readOne = defineReadTool({
  name: 'read_one',
  title: 'Read the world',
  description: 'Returns the invented world this test keeps.',
  scope: 'read:focus',
  input: z.strictObject({}),
  result: z.object({ status: z.string() }),
  run: () => Promise.resolve({ status: world.status }),
});

const writeOne = defineWriteTool({
  name: 'write_one',
  title: 'Move the world',
  description: 'Sets the invented status.',
  scope: 'write:initiative',
  input: z.strictObject({ to: z.string() }),
  result: z.object({ status: z.string() }),
  plan: (input) =>
    Promise.resolve({
      summary: `Move from ${world.status} to ${input.to}.`,
      // `before` is a live read. That is what makes the plan go stale.
      changes: [
        {
          op: 'status' as const,
          entity: 'world',
          id: 'the-world',
          field: 'status',
          before: world.status,
          after: input.to,
        },
      ],
    }),
  execute: (input) => {
    world = { status: input.to };
    return Promise.resolve({ status: world.status });
  },
});

const refusingTool = defineWriteTool({
  name: 'refuse_one',
  title: 'Always refuses while planning',
  description: 'Exists to prove a refusal is visible in the dry run.',
  scope: 'write:initiative',
  input: z.strictObject({}),
  result: z.object({}),
  plan: () => Promise.reject(new ApiError('unprocessable', 'that will never work')),
  execute: () => Promise.resolve({}),
});

const convergedTool = defineWriteTool({
  name: 'converged_one',
  title: 'Plans nothing',
  description: 'Exists to prove an empty diff hands back nothing to confirm.',
  scope: 'write:initiative',
  input: z.strictObject({}),
  result: z.object({}),
  plan: () => Promise.resolve({ summary: 'Nothing would change.', changes: [] }),
  execute: () => Promise.resolve({}),
});

const testTools: readonly McpTool[] = [readOne, writeOne, refusingTool, convergedTool];

function identityWith(scopes: readonly Scope[]): Identity {
  return { kind: 'agent', subject: 'token:fixture', scopes };
}

const EVERY_SCOPE = identityWith(SCOPE_NAMES);

function authorizerFor(identity: Identity | ApiError): Authorizer {
  return {
    authorize: () =>
      Promise.resolve(
        identity instanceof ApiError ? { ok: false, error: identity } : { ok: true, identity },
      ),
  };
}

interface Harness {
  readonly app: Hono;
  post(body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown }>;
  call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function harness(options?: {
  identity?: Identity | ApiError;
  tools?: readonly McpTool[];
  confirmations?: ConfirmationService | null;
}): Harness {
  const app = new Hono();
  const confirmations =
    options?.confirmations === null
      ? undefined
      : (options?.confirmations ??
        createConfirmationService({ store: createMemoryAuthStore(), now: () => PINNED_NOW }));

  mountMcp(app, {
    server: createMcpServer({ tools: options?.tools ?? testTools, confirmations, logger }),
    authorizer: authorizerFor(options?.identity ?? EVERY_SCOPE),
    services: {} as Services,
    logger,
    now: () => PINNED_NOW,
  });

  async function post(
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const response = await app.request(MCP_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    };
  }

  return {
    app,
    post,
    async call(name: string, args: Record<string, unknown> = {}) {
      const { body } = await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      return (body as { result: Record<string, unknown> }).result;
    },
  };
}

beforeEach(() => {
  world = { status: 'next' };
});

describe('the lifecycle', () => {
  it('answers initialize with the revision it speaks and tools as its only capability', async () => {
    const { body } = await harness().post({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const result = (body as { result: Record<string, unknown> }).result;

    expect(result['protocolVersion']).toBe(PROTOCOL_VERSION);
    // A capability declared and not implemented is a client making calls that
    // fail. Tools are all prisme has.
    expect(result['capabilities']).toEqual({ tools: { listChanged: false } });
    expect(result['serverInfo']).toMatchObject({ name: 'prisme' });
    expect(String(result['instructions'])).toContain('dry run');
  });

  it('accepts a notification with 202 and no body', async () => {
    const response = await harness().post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response.status).toBe(202);
    expect(response.body).toBeUndefined();
  });

  it('answers ping', async () => {
    const { body } = await harness().post({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect((body as { result: unknown }).result).toEqual({});
  });

  it('says plainly that it implements tools only', async () => {
    const { body } = await harness().post({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    const error = (body as { error: { code: number; message: string } }).error;
    expect(error.code).toBe(JSON_RPC.methodNotFound);
    expect(error.message).toContain('tools only');
  });
});

describe('tools/list', () => {
  it('describes each tool with an object input schema and its required scope', async () => {
    const { body } = await harness().post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (body as { result: { tools: Record<string, unknown>[] } }).result.tools;

    expect(tools.map((tool) => tool['name'])).toEqual(testTools.map((tool) => tool.name));
    for (const tool of tools) {
      expect((tool['inputSchema'] as { type: string }).type).toBe('object');
      expect(tool['outputSchema']).toBeDefined();
      expect(tool['_meta']).toHaveProperty('prisme/requiredScope');
    }
  });

  it('shows a read-only credential only the tools it can actually call', async () => {
    // Not cosmetic: a manifest listing tools the caller may not invoke is a map
    // of things to try, and an agent will spend turns trying them.
    const { body } = await harness({ identity: identityWith(['read:focus', 'read:meta']) }).post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    const tools = (body as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(['read_one']);
  });

  it('advertises confirmationToken on every write tool and on no read tool', async () => {
    const { body } = await harness().post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (body as { result: { tools: Record<string, unknown>[] } }).result.tools;

    const properties = (tool: Record<string, unknown>): Record<string, unknown> =>
      (tool['inputSchema'] as { properties?: Record<string, unknown> }).properties ?? {};

    expect(properties(tools[1] as Record<string, unknown>)).toHaveProperty('confirmationToken');
    expect(properties(tools[0] as Record<string, unknown>)).not.toHaveProperty('confirmationToken');
  });
});

describe('a write tool is a dry run until it is confirmed', () => {
  it('takes no action and returns the diff with a token', async () => {
    const result = await harness().call('write_one', { to: 'now' });
    const structured = result['structuredContent'] as Record<string, unknown>;

    expect(structured['applied']).toBe(false);
    expect(world.status).toBe('next');
    expect((structured['plan'] as { changes: unknown[] }).changes).toHaveLength(1);
    const confirmation = structured['confirmation'] as { token: string; expiresInSeconds: number };
    expect(confirmation.token.startsWith('prisme_cnf_')).toBe(true);
    expect(confirmation.expiresInSeconds).toBeGreaterThan(0);
    expect(structured['result']).toBeNull();
  });

  it('executes exactly once when the token comes back', async () => {
    const test = harness();
    const dry = (await test.call('write_one', { to: 'now' }))['structuredContent'] as {
      confirmation: { token: string };
    };

    const applied = (
      await test.call('write_one', { to: 'now', confirmationToken: dry.confirmation.token })
    )['structuredContent'] as Record<string, unknown>;

    expect(applied['applied']).toBe(true);
    expect(applied['result']).toEqual({ status: 'now' });
    expect(world.status).toBe('now');
  });

  it('refuses the same token a second time', async () => {
    const test = harness();
    const dry = (await test.call('write_one', { to: 'now' }))['structuredContent'] as {
      confirmation: { token: string };
    };
    await test.call('write_one', { to: 'now', confirmationToken: dry.confirmation.token });

    // Replaying is the failure a confirmation must not have: it would apply the
    // same diff twice.
    const replay = await test.call('write_one', {
      to: 'now',
      confirmationToken: dry.confirmation.token,
    });
    expect(replay['isError']).toBe(true);
    expect(JSON.stringify(replay)).toContain('already been used');
  });

  it('refuses a token once the world it described has moved', async () => {
    const test = harness();
    const dry = (await test.call('write_one', { to: 'now' }))['structuredContent'] as {
      confirmation: { token: string };
    };

    // Somebody else changes the thing the diff was about.
    world = { status: 'waiting' };

    const stale = await test.call('write_one', {
      to: 'now',
      confirmationToken: dry.confirmation.token,
    });
    expect(stale['isError']).toBe(true);
    expect(JSON.stringify(stale)).toContain('the plan has changed');
    // And nothing happened.
    expect(world.status).toBe('waiting');
  });

  it('refuses a token issued for different arguments', async () => {
    const test = harness();
    const dry = (await test.call('write_one', { to: 'now' }))['structuredContent'] as {
      confirmation: { token: string };
    };

    // Same tool, same world, different request. A confirmation that did not say
    // which request it came from would be transferable between them.
    const swapped = await test.call('write_one', {
      to: 'later',
      confirmationToken: dry.confirmation.token,
    });
    expect(swapped['isError']).toBe(true);
    expect(world.status).toBe('next');
  });

  it('refuses a token that was never issued', async () => {
    const result = await harness().call('write_one', {
      to: 'now',
      confirmationToken: 'prisme_cnf_aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(result['isError']).toBe(true);
    expect(world.status).toBe('next');
  });

  it('issues no token when the plan would change nothing', async () => {
    // Handing back a token here would teach a caller that an empty diff is
    // something to go and execute.
    const structured = (await harness().call('converged_one'))['structuredContent'] as Record<
      string,
      unknown
    >;
    expect((structured['plan'] as { changes: unknown[] }).changes).toEqual([]);
    expect(structured['confirmation']).toBeNull();
    expect(structured['applied']).toBe(false);
  });

  it('refuses to execute at all when no confirmation service is configured', async () => {
    // Fail closed. The fallback from "cannot issue a confirmation" to "proceed
    // without one" is the control deleting itself.
    const result = await harness({ confirmations: null }).call('write_one', { to: 'now' });
    expect(result['isError']).toBe(true);
    expect(world.status).toBe('next');
  });

  it('surfaces a refusal while planning, before anyone confirms anything', async () => {
    const result = await harness().call('refuse_one');
    expect(result['isError']).toBe(true);
    expect(JSON.stringify(result)).toContain('that will never work');
  });
});

describe('authorization', () => {
  it('answers 401 with a JSON-RPC body when the authorizer refuses', async () => {
    const response = await harness({
      identity: new ApiError('unauthenticated', 'no credential'),
    }).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBe(401);
    expect((response.body as { error: { code: number } }).error.code).toBe(JSON_RPC.requestRefused);
  });

  it('refuses a write tool to a read-only credential, and does not run it', async () => {
    const response = await harness({ identity: identityWith(['read:focus', 'read:meta']) }).post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_one', arguments: { to: 'now' } },
    });

    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toContain('write:initiative');
    expect(world.status).toBe('next');
  });

  it('asks the authorizer for the tool’s own scope, not the endpoint’s', async () => {
    // This is what lets W14's kill switch withhold a scope and make one tool
    // unreachable without W06 writing a check for it.
    const asked: { scope: string; stateChanging: boolean }[] = [];
    const app = new Hono();
    mountMcp(app, {
      server: createMcpServer({
        tools: testTools,
        confirmations: createConfirmationService({
          store: createMemoryAuthStore(),
          now: () => PINNED_NOW,
        }),
        logger,
      }),
      authorizer: {
        authorize: (request) => {
          asked.push({ scope: request.scope, stateChanging: request.stateChanging });
          return Promise.resolve({ ok: true as const, identity: EVERY_SCOPE });
        },
      },
      services: {} as Services,
      logger,
      now: () => PINNED_NOW,
    });

    // `async` for the same reason as `call` in auth.integration.test.ts: Hono
    // types `app.request` as `Response | Promise<Response>`.
    const send = async (body: unknown): Promise<Response> =>
      app.request(MCP_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_one', arguments: {} },
    });
    await send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'write_one', arguments: { to: 'now' } },
    });

    expect(asked).toEqual([
      { scope: PROTOCOL_SCOPE, stateChanging: false },
      { scope: 'read:focus', stateChanging: false },
      { scope: 'write:initiative', stateChanging: true },
    ]);
  });
});

describe('errors the caller can act on', () => {
  it('reports an unknown tool as a protocol error, not as a result', async () => {
    const { body } = await harness().post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    });
    const error = (body as { error: { code: number; message: string } }).error;
    expect(error.code).toBe(JSON_RPC.invalidParams);
    expect(error.message).toContain('no_such_tool');
  });

  it('names the field when the arguments do not parse', async () => {
    const { body } = await harness().post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_one', arguments: { to: 7 } },
    });
    const error = (body as { error: { data: { fields: { field: string }[] } } }).error;
    expect(error.data.fields.map((problem) => problem.field)).toContain('to');
  });

  it('refuses an argument the tool does not accept rather than ignoring it', async () => {
    const { body } = await harness().post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_one', arguments: { to: 'now', due: '2026-10-01' } },
    });
    expect(body).toHaveProperty('error');
  });
});

describe('the transport', () => {
  it('is POST-only, and says so with Allow rather than 404', async () => {
    // A 404 sends a client looking for the deprecated HTTP+SSE transport.
    for (const method of ['GET', 'DELETE']) {
      const response = await harness().app.request(MCP_PATH, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('refuses a protocol version it does not speak', async () => {
    const response = await harness().post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { 'mcp-protocol-version': '1999-01-01' },
    );
    expect(response.status).toBe(400);
  });

  it('accepts the revision assumed when the header is absent', async () => {
    const response = await harness().post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { 'mcp-protocol-version': '2025-03-26' },
    );
    expect(response.status).toBe(200);
  });

  it('answers 400 on a body that is not JSON', async () => {
    const response = await harness().post('{not json');
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: number } }).error.code).toBe(JSON_RPC.parseError);
  });

  it('refuses a body larger than the cap', async () => {
    const response = await harness().post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_one', arguments: { to: 'x'.repeat(300_000) } },
    });
    expect(response.status).toBe(413);
  });

  it('refuses a client that will not take JSON', async () => {
    const response = await harness().post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { accept: 'text/plain' },
    );
    expect(response.status).toBe(406);
  });
});

describe('the real tool registry', () => {
  it('mounts without a duplicate name', () => {
    expect(() =>
      createMcpServer({ tools: mcpTools, confirmations: undefined, logger }),
    ).not.toThrow();
  });

  it('refuses to build a server with two tools of the same name', () => {
    // Which of the two is reachable would otherwise depend on array order.
    expect(() =>
      createMcpServer({ tools: [readOne, readOne], confirmations: undefined, logger }),
    ).toThrow(/share a name/);
  });
});
