import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '@prisme/observability';
import { authorizerFor, identityWith } from '../test-support/app.js';
import { ApiError } from './errors.js';
import { mountRoutes } from './mount.js';
import { defineRoute, type Route } from './route.js';
import { defineWrite, named } from './schema.js';

/**
 * What the router does around a handler: authorize, check the scope, parse both
 * ways, and leak nothing when something goes wrong.
 *
 * The last of those is the one worth a test rather than a comment. An error
 * handler is written once, is exercised only on the unhappy path, and its
 * failure mode — a stack trace, a driver message, a SQL fragment reaching the
 * caller — is invisible until the day it matters.
 */

interface Deps {
  readonly answer: () => Promise<unknown>;
}

const logger = createLogger({ service: 'test', level: 'fatal' });

const echoRoute = defineRoute<{ id: string }, unknown, { note: string }, { id: string }, Deps>({
  operationId: 'echo',
  method: 'post',
  path: '/things/:id',
  scope: 'write:initiative',
  summary: 'echo',
  params: z.strictObject({ id: z.string().min(1) }),
  body: defineWrite('Echo', z.strictObject({ note: z.string() }), {
    due: 'the task tool owns `due`',
  }),
  status: 200,
  response: named('Thing', z.object({ id: z.string() })),
  handle: async (context, deps) => {
    const answer = (await deps.answer()) as { id: string } | undefined;
    return answer ?? { id: context.params.id };
  },
});

function appWith(route: Route<Deps>, deps: Deps, scopes: readonly string[] = ['write:initiative']) {
  const app = new Hono();
  mountRoutes(app, [route], {
    authorizer: authorizerFor(identityWith(scopes as never)),
    deps,
    logger,
    now: () => new Date('2026-09-17T09:00:00.000Z'),
  });
  return app;
}

const OK: Deps = { answer: () => Promise.resolve(undefined) };

async function post(app: Hono, path: string, body: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'run-1' },
    body,
  });
}

describe('mounting', () => {
  it('parses the path, the body and the response', async () => {
    const response = await post(appWith(echoRoute, OK), '/things/abc', '{"note":"hello"}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'abc' });
  });

  it('refuses a caller whose credential lacks the scope', async () => {
    const response = await post(
      appWith(echoRoute, OK, ['read:backlog']),
      '/things/abc',
      '{"note":"hello"}',
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('forbidden');
    expect(body.message).toContain('write:initiative');
  });

  it('refuses a field this endpoint does not own, with 400 and the field named', async () => {
    const response = await post(
      appWith(echoRoute, OK),
      '/things/abc',
      '{"note":"hello","due":"2026-10-01"}',
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      fields: { field: string; reason: string }[];
    };
    expect(body.error).toBe('read_only_field');
    expect(body.fields[0]?.field).toBe('due');
  });

  it('answers a malformed body without quoting it back', async () => {
    const response = await post(appWith(echoRoute, OK), '/things/abc', '{not json');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_request');
    expect(body.message).not.toContain('not json');
  });

  it('returns the correlation id so a caller can quote it', async () => {
    const response = await post(appWith(echoRoute, OK), '/things/abc', '{"note":"hi"}');
    expect(response.headers.get('x-request-id')).toBeDefined();
  });
});

describe('an error leaks nothing', () => {
  it('turns an unexpected failure into a generic 500', async () => {
    const deps: Deps = {
      answer: () =>
        Promise.reject(
          new Error('insert into initiative … violates constraint "finished_work_says_when"'),
        ),
    };

    const response = await post(appWith(echoRoute, deps), '/things/abc', '{"note":"hi"}');
    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('initiative');
    expect(text).not.toContain('constraint');
    expect(text).not.toContain('at Object');
    expect(JSON.parse(text)).toMatchObject({
      error: 'internal_error',
      message: 'the request could not be completed',
    });
  });

  it('passes a deliberate ApiError through with its own status and sentence', async () => {
    const deps: Deps = {
      answer: () => Promise.reject(new ApiError('not_found', 'no thing with id abc')),
    };
    const response = await post(appWith(echoRoute, deps), '/things/abc', '{"note":"hi"}');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('a handler cannot widen the contract', () => {
  it('drops a field the response schema does not describe', async () => {
    const deps: Deps = {
      answer: () =>
        Promise.resolve({ id: 'abc', internalToken: 'prisme_live_do_not_ship', rowVersion: 7 }),
    };

    const response = await post(appWith(echoRoute, deps), '/things/abc', '{"note":"hi"}');
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).not.toContain('internalToken');
    expect(text).not.toContain('prisme_live_do_not_ship');
    expect(JSON.parse(text)).toEqual({ id: 'abc' });
  });

  it('fails loudly when a handler returns something the contract cannot describe', async () => {
    const deps: Deps = { answer: () => Promise.resolve({ id: 42 }) };
    const response = await post(appWith(echoRoute, deps), '/things/abc', '{"note":"hi"}');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'internal_error' });
  });
});
