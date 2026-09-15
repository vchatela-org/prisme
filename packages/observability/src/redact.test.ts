import { describe, expect, it } from 'vitest';
import { isSecretKey, redact, REDACTED, scrubValue } from './redact.js';

describe('isSecretKey', () => {
  it.each([
    'TOKEN_PEPPER',
    'tokenPepper',
    'token-pepper',
    'DOCTOOL_API_TOKEN',
    'TASKTOOL_API_TOKEN',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'authorization',
    'Set-Cookie',
    'AUTH_ASSERTION_HEADER',
    'clientSecret',
    'password',
  ])('denies %s', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each(['AUTH_ISSUER_URL', 'AUTH_AUDIENCE', 'PRISME_BASE_URL', 'LOG_LEVEL', 'port', 'area'])(
    'allows %s',
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );
});

describe('redact', () => {
  it('replaces a denied value anywhere in the tree', () => {
    const out = redact({ config: { tokenPepper: 'pepper-value', port: 3000 } }) as {
      config: { tokenPepper: string; port: number };
    };
    expect(out.config.tokenPepper).toBe(REDACTED);
    expect(out.config.port).toBe(3000);
  });

  it('survives log.info({ config }) — the case the spec names', () => {
    const config = {
      databaseUrl: 'postgres://app:hunter2@db:5432/prisme',
      tokenPepper: 'pepper',
      doctoolApiToken: 'doctool-token',
      tasktoolApiToken: 'tasktool-token',
      authIssuerUrl: 'https://idp.example.com/application/o/prisme/',
      port: 3000,
    };
    const serialized = JSON.stringify(redact({ config }));
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('pepper');
    expect(serialized).not.toContain('doctool-token');
    expect(serialized).not.toContain('tasktool-token');
    // Configuration, not a credential — it must stay readable.
    expect(serialized).toContain('idp.example.com');
  });

  it('scrubs credentials out of a connection string held under an innocent key', () => {
    const out = redact({ note: 'connecting to postgres://app:hunter2@db:5432/prisme' }) as {
      note: string;
    };
    expect(out.note).not.toContain('hunter2');
    expect(out.note).toContain('postgres://***:***@db:5432/prisme');
  });

  it('handles cycles without throwing', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node['self'] = node;
    expect(() => JSON.stringify(redact(node))).not.toThrow();
    expect(JSON.stringify(redact(node))).toContain('[circular]');
  });

  it('redacts inside arrays, maps and sets', () => {
    const out = redact({
      list: [{ apiKey: 'k' }],
      map: new Map([['secret', 'v']]),
      set: new Set([{ password: 'p' }]),
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('"k"');
    expect(JSON.stringify(out)).not.toContain('"v"');
    expect(JSON.stringify(out)).not.toContain('"p"');
  });

  it('keeps an error readable but scrubbed', () => {
    const error = new Error('failed for postgres://app:hunter2@db/prisme');
    const out = redact(error) as { name: string; message: string };
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain('hunter2');
  });

  it('truncates rather than recursing forever', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i += 1) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });

  it('accepts additional patterns without losing the defaults', () => {
    const out = redact(
      { workspaceId: 'w', token: 't' },
      { additionalPatterns: [/workspaceid/] },
    ) as {
      workspaceId: string;
      token: string;
    };
    expect(out.workspaceId).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
  });
});

describe('scrubValue', () => {
  it('leaves a URL without credentials alone', () => {
    expect(scrubValue('https://example.com/a/b')).toBe('https://example.com/a/b');
  });
});
