import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { REDACTED } from './redact.js';
import { withNewRun, withRunContext } from './run-context.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const write = (line: string) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  };
  return { lines, write };
}

describe('createLogger', () => {
  it('writes one JSON object per line with the fixed fields', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', write, now: () => new Date(0) });
    log.info('started', { port: 3000 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      time: '1970-01-01T00:00:00.000Z',
      level: 'info',
      service: 'prisme-api',
      msg: 'started',
      port: 3000,
    });
  });

  it('drops events below the configured level', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', level: 'warn', write });
    log.info('ignored');
    log.debug('ignored');
    log.warn('kept');
    expect(lines.map((l) => l['msg'])).toEqual(['kept']);
  });

  it('redacts a secret even when the whole config object is logged', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', write });
    log.info('config', { config: { tokenPepper: 'pepper', port: 3000 } });
    expect(lines[0]).toMatchObject({ config: { tokenPepper: REDACTED, port: 3000 } });
  });

  it('carries the run ID from async context without being passed one', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-sync', write });

    withRunContext({ runId: 'run-1', source: 'cron' }, () => {
      log.info('pass started');
    });
    log.info('outside');

    expect(lines[0]).toMatchObject({ runId: 'run-1', source: 'cron' });
    expect(lines[1]).not.toHaveProperty('runId');
  });

  it('gives every line of one pass the same run ID', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-sync', write });
    withNewRun('cron', () => {
      log.info('a');
      log.info('b');
    });
    expect(lines[0]!['runId']).toBe(lines[1]!['runId']);
    expect(lines[0]!['runId']).toEqual(expect.any(String));
  });

  it('child bindings appear on every line and are themselves redacted', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', write }).child({
      area: 'health',
      apiToken: 'leaked',
    });
    log.info('ping');
    expect(lines[0]).toMatchObject({ area: 'health', apiToken: REDACTED });
  });

  it('still emits an event when a field cannot be serialized', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', write });

    // A getter that throws is the realistic version of this: an ORM row or a
    // lazily-resolved property. The event must survive it.
    const hostile = {};
    Object.defineProperty(hostile, 'exploding', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });

    log.error('boom', { hostile });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'boom', serializationError: true });
  });

  it('serializes a BigInt rather than throwing on it', () => {
    const { lines, write } = capture();
    const log = createLogger({ service: 'prisme-api', write });
    log.info('counted', { total: 12n });
    expect(lines[0]).toMatchObject({ total: '12' });
  });
});
