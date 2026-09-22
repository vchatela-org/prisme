import { describe, expect, it } from 'vitest';
import { createDocToolClient } from './doc-tool/client.js';
import { createTaskToolClient } from './task-tool/client.js';
import { createFixtureTransport } from './testing/fixture-transport.js';
import { createRecordedBindings } from './testing/recorded.js';
import { createCommandSender } from './write/command.js';
import { idempotencyKey } from './write/idempotency.js';

/**
 * The `baseUrl` override, and the reason it now has a test.
 *
 * The option has existed on every client since W03, and nothing read it: each
 * one fell back to its own vendor default, which is correct for every
 * deployment that has not asked for anything else. What changed is that
 * `DOCTOOL_BASE_URL` and `TASKTOOL_BASE_URL` now carry it from configuration
 * (`@prisme/config`), which turns it from an unused seam into a setting a
 * deployment can set — and a setting whose wiring is wrong is worse than one
 * that does not exist, because the deployment believes it took effect.
 *
 * So this file is about the seam itself: a client given a host must send there,
 * on every one of the four constructors that builds a URL. `apps/sync` and
 * `apps/api` are what pass the configured value; what is asserted here is that
 * passing it means what the configuration promises.
 *
 * **The request is recorded before the response is parsed**, so the outcome of
 * each call is deliberately discarded below. An unparseable fixture body would
 * otherwise fail a test about a URL, and the assertion still has teeth: a client
 * that refused to send at all leaves `requests` empty and `requests[0]` undefined.
 */

const OVERRIDE = 'https://self-hosted.example.com';

/** Swallows the parse failure a stub response produces; the request is already recorded. */
const ignoringOutcome = (call: Promise<unknown>): Promise<unknown> => call.catch(() => undefined);

describe('a client given a base URL', () => {
  it('sends the document tool’s read query to it, not to the vendor', async () => {
    const transport = createFixtureTransport([
      { matches: () => true, respond: () => ({ body: '{}' }) },
    ]);

    const client = createDocToolClient({
      token: 'example-token',
      baseUrl: OVERRIDE,
      bindings: createRecordedBindings(),
      transport: transport.transport,
    });

    await ignoringOutcome(client.queryByRole('objectives_db'));

    expect(transport.requests[0]?.url).toContain(`${OVERRIDE}/v1/data_sources/`);
  });

  it('sends the task tool’s sync to it, not to the vendor', async () => {
    const transport = createFixtureTransport([
      { matches: () => true, respond: () => ({ body: '{}' }) },
    ]);

    const client = createTaskToolClient({
      token: 'example-token',
      baseUrl: OVERRIDE,
      transport: transport.transport,
    });

    await ignoringOutcome(client.syncIncremental());

    expect(transport.requests[0]?.url).toBe(`${OVERRIDE}/api/v1/sync`);
  });

  it('sends a task-tool write to it, so a read and its write cannot land on different hosts', async () => {
    // The failure this closes is the quiet one: a deployment that redirected the
    // reader but not the writer would read from the instance it meant to write
    // to and write to the vendor's — and both passes would report success.
    const transport = createFixtureTransport([
      { matches: () => true, respond: () => ({ body: '{}' }) },
    ]);

    const send = createCommandSender({
      token: 'example-token',
      baseUrl: OVERRIDE,
      transport: transport.transport,
    });

    // Derived, never a literal: the sender refuses a key that is not UUID-shaped,
    // and a UUID written into this repository is exactly what the deny-list
    // refuses — it caught the first draft of this line.
    await ignoringOutcome(
      send(
        'item_add',
        idempotencyKey({ runId: 'run-1', operation: 'test', subject: 'anchor-1' }),
        {},
        'test command',
      ),
    );

    expect(transport.requests[0]?.url).toBe(`${OVERRIDE}/api/v1/sync`);
  });

  it('trims a trailing slash, so a host written with one is not a double slash in the path', async () => {
    // `trimTrailing` is the shared helper, and this is the case that reaches it
    // from configuration: an operator writing `https://host/` in a manifest is
    // not making a mistake, and the client must not turn it into `//v1/...`.
    const transport = createFixtureTransport([
      { matches: () => true, respond: () => ({ body: '{}' }) },
    ]);

    const client = createTaskToolClient({
      token: 'example-token',
      baseUrl: `${OVERRIDE}/`,
      transport: transport.transport,
    });

    await ignoringOutcome(client.syncIncremental());

    expect(transport.requests[0]?.url).toBe(`${OVERRIDE}/api/v1/sync`);
  });
});
