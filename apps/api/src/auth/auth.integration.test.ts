import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createLogger, createMetrics } from '@prisme/observability';
import type { Config } from '@prisme/config';
import { createApp } from '../app.js';
import { API_BASE_PATH, createRoutes } from '../routes/index.js';
import {
  openTestDatabase,
  describeWithDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import type { Services } from '../services/index.js';
import { createAuthorizer } from './authorizer.js';
import { createConfirmationService, hashPlan } from './confirmation.js';
import { originPolicyFor } from '@prisme/auth';
import { createPostgresAuthStore } from './postgres.js';
import type { AuthStore } from './store.js';
import {
  createTestKeys,
  goodClaims,
  NOW,
  TEST_POLICY,
  type TestKeys,
} from '@prisme/auth/test-support';
import { createTokenService, type TokenService } from './tokens.js';
import { createWriteSwitch, type WriteSwitch } from './write-switch.js';

/**
 * The whole mechanism, against a real PostgreSQL and through the real router.
 *
 * Two kinds of thing are tested here and neither could be tested anywhere else.
 *
 * **What is genuinely SQL's.** A `text[]` round trip, a `NOT NULL` that the
 * application thought it had already checked, and the atomic consume — which is
 * a claim about one statement under concurrency and is simply not a claim a
 * fake can make. W04 and W05 each found two bugs this way; the precedent is the
 * reason this file exists rather than a mock.
 *
 * **What is genuinely the router's.** In particular the definition-of-done item
 * the brief words carefully: *the API rejects an unverifiable assertion even
 * when it arrives from the web tier, proven by a test that calls the API
 * directly.* That is ADR-0021 rule 6 — the web tier is not a trusted hop — and
 * calling the API directly is the only way to prove it, because any test that
 * goes through the web tier is testing the web tier.
 */

const HEADER = 'x-prisme-assertion';
const ORIGIN = 'https://prisme.invalid';

const TEST_CONFIG = {
  service: 'api',
  port: 3000,
  logLevel: 'fatal',
  timezone: 'UTC',
  baseUrl: ORIGIN,
} as unknown as Config;

let database: TestDatabase;
let keys: TestKeys;
let store: AuthStore;
let tokens: TokenService;
let writeSwitch: WriteSwitch;
let app: Hono;

describe.runIf(describeWithDatabase === 'run')('authentication end to end', () => {
  beforeAll(async () => {
    database = await openTestDatabase();
    keys = await createTestKeys();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate();
    store = createPostgresAuthStore(database.client);
    tokens = createTokenService({ store, pepper: 'integration-pepper', now: () => NOW });
    writeSwitch = createWriteSwitch({ store, now: () => NOW });

    app = createApp({
      config: TEST_CONFIG,
      logger: createLogger({ service: 'test', level: 'fatal' }),
      metrics: createMetrics({ collectDefaults: false }),
      readiness: () => Promise.resolve({ state: 'ready', checks: [] } as never),
      isShuttingDown: () => false,
      services: {} as Services,
      auth: { tokens, writeSwitch },
      authorizer: createAuthorizer({
        assertion: { policy: TEST_POLICY, keys: keys.keys, header: HEADER },
        tokens,
        writeSwitch,
        origin: originPolicyFor(ORIGIN),
        now: () => NOW,
        logger: createLogger({ service: 'test', level: 'fatal' }),
      }),
      now: () => NOW,
    });
  });

  // `async`, because Hono types `app.request` as `Response | Promise<Response>`
  // — it answers synchronously in some paths — and an `async` wrapper is what
  // makes that assignable to the `Promise<Response>` the callers await.
  async function call(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    return app.request(`${API_BASE_PATH}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  describe('the web tier is not a trusted hop (ADR-0021 rule 6)', () => {
    it('rejects an unverifiable assertion presented directly to the API', async () => {
      // The web tier would have verified this and refused to forward it. The
      // API is not entitled to assume that happened: anything in the cluster
      // can reach this Service directly, which is the whole reason the
      // assertion is verified rather than trusted (ADR-0021 context, measured).
      const forged = await keys.signWithWrongKey(goodClaims());
      const response = await call('GET', '/tokens', { [HEADER]: forged });

      expect(response.status).toBe(401);
    });

    it('rejects one relayed with every header the web tier would have set', async () => {
      const response = await call('GET', '/tokens', {
        [HEADER]: await keys.signWithWrongKey(goodClaims()),
        'x-forwarded-user': 'owner',
        'x-forwarded-email': 'owner@prisme.invalid',
        'x-forwarded-host': 'prisme.invalid',
        'x-prisme-verified-by': 'web',
      });

      expect(response.status).toBe(401);
    });

    it('accepts one that verifies here, whoever forwarded it', async () => {
      const response = await call('GET', '/tokens', { [HEADER]: await keys.sign(goodClaims()) });
      expect(response.status).toBe(200);
    });
  });

  describe('deny by default, through the real router', () => {
    it('answers 401 on every route when no credential is presented', async () => {
      for (const route of createRoutes()) {
        const path = route.path.replace(/:[A-Za-z0-9_]+/g, 'x');
        const response = await call(
          route.method.toUpperCase(),
          path,
          {},
          route.method === 'get' ? undefined : {},
        );
        expect(response.status, `${route.operationId} answered ${String(response.status)}`).toBe(
          401,
        );
      }
    });

    it('answers 401 on every route when only identity headers are presented', async () => {
      for (const route of createRoutes()) {
        const path = route.path.replace(/:[A-Za-z0-9_]+/g, 'x');
        const response = await call(
          route.method.toUpperCase(),
          path,
          { 'x-forwarded-user': 'owner', 'x-forwarded-email': 'owner@prisme.invalid' },
          route.method === 'get' ? undefined : {},
        );
        expect(response.status, `${route.operationId} answered ${String(response.status)}`).toBe(
          401,
        );
      }
    });
  });

  describe('a read-scoped token', () => {
    it('cannot invoke a write endpoint', async () => {
      const issued = await tokens.issue({
        name: 'reader',
        scopes: ['read:sync', 'read:areas'],
        expiresInSeconds: 3600,
        createdBy: 'owner',
      });
      const auth = { authorization: `Bearer ${issued.token}` };

      // Reading is fine — proven by something other than a 401, so the failure
      // below cannot be "the token does not work at all".
      const read = await call('GET', '/sync', auth);
      expect(read.status).not.toBe(401);
      expect(read.status).not.toBe(403);

      const write = await call('POST', '/sync', auth, { mode: 'plan' });
      expect(write.status).toBe(403);
      expect(((await write.json()) as { error: string }).error).toBe('forbidden');
    });

    it('cannot mint itself a wider one', async () => {
      const issued = await tokens.issue({
        name: 'reader',
        scopes: ['read:focus'],
        expiresInSeconds: 3600,
        createdBy: 'owner',
      });

      const response = await call(
        'POST',
        '/tokens',
        { authorization: `Bearer ${issued.token}` },
        { name: 'wider', scopes: ['admin:settings', 'write:sync'] },
      );
      expect(response.status).toBe(403);
    });
  });

  describe('minting, through the API', () => {
    async function asOwner(): Promise<Record<string, string>> {
      return { [HEADER]: await keys.sign(goodClaims()), origin: ORIGIN };
    }

    it('returns the plaintext exactly once, and it works', async () => {
      const response = await call('POST', '/tokens', await asOwner(), {
        name: 'an agent',
        scopes: ['read:focus'],
      });
      expect(response.status).toBe(201);

      const body = (await response.json()) as { token: string; apiToken: { id: string } };
      expect(body.token.startsWith('prisme_pat_')).toBe(true);

      // It authenticates…
      await expect(tokens.verify(body.token)).resolves.toMatchObject({ kind: 'agent' });

      // …and the listing never shows it again.
      const listed = await call('GET', '/tokens', await asOwner());
      expect(JSON.stringify(await listed.json())).not.toContain(body.token);
    });

    it('survives the round trip through SQL with its scopes intact', async () => {
      const response = await call('POST', '/tokens', await asOwner(), {
        name: 'multi',
        scopes: ['read:focus', 'read:backlog', 'write:initiative'],
      });
      const body = (await response.json()) as { token: string };

      // `text[]`, not `jsonb` — W05 lost an afternoon to a jsonb column that
      // arrived as text and on which every property access yielded `undefined`.
      const principal = await tokens.verify(body.token);
      expect([...principal.scopes].sort()).toEqual([
        'read:backlog',
        'read:focus',
        'write:initiative',
      ]);
    });

    it('refuses a scope outside the vocabulary at the boundary', async () => {
      const response = await call('POST', '/tokens', await asOwner(), {
        name: 'bad',
        scopes: ['write:everything'],
      });
      expect(response.status).toBe(400);
    });

    it('refuses a cross-origin mint even with a valid assertion', async () => {
      const response = await call(
        'POST',
        '/tokens',
        { [HEADER]: await keys.sign(goodClaims()), origin: 'https://evil.invalid' },
        { name: 'sneaky', scopes: ['admin:tokens'] },
      );
      expect(response.status).toBe(403);
    });
  });

  describe('what only a real database can show', () => {
    it('refuses a token row with no expiry', async () => {
      // The NOT NULL is the control behind "expiring by default": the schema
      // has no way to spell "never", so no code path can introduce one.
      await expect(
        database.client`
          INSERT INTO api_token (id, name, scopes, hash, created_at, created_by, expires_at)
          VALUES ('0123456789abcdef', 'forever', ARRAY['read:focus'], '$argon2id$x',
                  now(), 'owner', NULL)`,
      ).rejects.toThrow();
    });

    it('refuses a hash that is not Argon2id', async () => {
      await expect(
        database.client`
          INSERT INTO api_token (id, name, scopes, hash, created_at, created_by, expires_at)
          VALUES ('0123456789abcdef', 'sha', ARRAY['read:focus'], 'sha256:deadbeef',
                  now(), 'owner', now() + interval '1 day')`,
      ).rejects.toThrow();
    });

    it('consumes a confirmation exactly once under concurrency', async () => {
      const confirmations = createConfirmationService({ store, now: () => NOW });
      const diffHash = hashPlan({ actions: [{ id: 'i-1' }] });
      const issued = await confirmations.issue({
        operation: 'sync.apply',
        diffHash,
        subject: 'owner',
      });

      // Ten callers race for the same token. The consume is one statement, so
      // exactly one wins — a read-then-mark pair would let several through, and
      // this is the only place that claim can actually be tested.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () => confirmations.verify(issued.token, diffHash, 'owner')),
      );
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    });

    it('keeps the kill switch across a restart', async () => {
      await writeSwitch.engage({ mode: 'all', by: 'owner', reason: 'integration test' });

      // A fresh switch over the same database: a new process, in effect.
      const restarted = createWriteSwitch({
        store: createPostgresAuthStore(database.client),
        now: () => NOW,
      });
      const current = await restarted.current();
      expect(current.engaged).toBe(true);
      expect(current.mode).toBe('all');
      expect(current.changedBy).toBe('owner');
    });

    it('freezes writes through the API and leaves reads working', async () => {
      const headers = { [HEADER]: await keys.sign(goodClaims()), origin: ORIGIN };
      const engaged = await call('POST', '/write-switch', headers, {
        engaged: true,
        mode: 'outward',
        reason: 'the reconciler is doing something odd',
      });
      expect(engaged.status).toBe(200);

      expect((await call('POST', '/sync', headers, { mode: 'plan' })).status).toBe(423);
      expect((await call('GET', '/write-switch', headers)).status).toBe(200);

      const released = await call('POST', '/write-switch', headers, { engaged: false });
      expect(released.status).toBe(200);
      expect(((await released.json()) as { engaged: boolean }).engaged).toBe(false);
    });

    it('requires a reason to engage', async () => {
      const headers = { [HEADER]: await keys.sign(goodClaims()), origin: ORIGIN };
      const response = await call('POST', '/write-switch', headers, { engaged: true });
      expect(response.status).toBe(400);
    });
  });
});
