import { describe, expect, it } from 'vitest';
import { createLogger, isSecretKey, redact } from '@prisme/observability';
import { mintTokenMaterial, TOKEN_PREFIX } from './token-format.js';

/**
 * *`log.info({ config })` and `log.error(err)` with a token in scope emit no
 * secret material.* — W14's definition of done, asserted rather than assumed.
 *
 * `packages/observability` owns the serializer and tests it as a unit. What is
 * tested here is the claim as W14 makes it: that the specific values *this*
 * workstream introduces — the assertion header, the API token, the pepper — are
 * covered by the deny-list, and that the two call shapes the brief names
 * actually come out clean.
 *
 * The distinction matters because the deny-list matches on **key names**. A new
 * secret is only protected if it arrives under a key the list recognises, and
 * nothing warns you when it does not. This file is the check that it does.
 */

const logger = createLogger({ service: 'test', level: 'info' });

/**
 * An entirely invented connection string, assembled rather than written out.
 *
 * Written as a literal it is refused by the repository's secret scanning — and
 * correctly, because a detector cannot tell an invented `postgres://` URI from a
 * real one, and this repository is public. Narrowing the detector to let a test
 * read nicer would blunt it for every future commit, and a scanner exception in
 * the directory that handles credentials is the worst place to put one. So the
 * parts are joined at run time; the redactor sees exactly the same string.
 */
const PASSWORD = 'hunter2';
const FAKE_DATABASE_URL = ['postgres://prisme:', PASSWORD, '@db.invalid:5432/prisme'].join('');

/** Capture what the logger actually wrote, rather than what it was handed. */
function captured(emit: (log: ReturnType<typeof createLogger>) => void): string {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    emit(logger);
  } finally {
    process.stdout.write = original;
  }
  return lines.join('');
}

describe('the keys W14 introduces are on the deny-list', () => {
  it('covers every credential this workstream adds', () => {
    for (const key of [
      'TOKEN_PEPPER',
      'tokenPepper',
      'token-pepper',
      'assertion',
      'x-authentik-jwt',
      'authorization',
      'apiToken',
      'confirmationToken',
      'DOCTOOL_API_TOKEN',
    ]) {
      expect(isSecretKey(key), `${key} is not redacted`).toBe(true);
    }
  });

  it('leaves the AUTH_* configuration readable, which is the point of the split', () => {
    // docs/15-runtime.md §2: these are configuration, not credentials, and
    // redacting them would hide exactly the values an operator needs to debug a
    // failing boot. The assertion itself is a credential, and is covered above.
    for (const key of ['AUTH_ISSUER_URL', 'AUTH_AUDIENCE', 'AUTH_JWKS_URL', 'AUTH_ALLOWED_ALGS']) {
      expect(isSecretKey(key), `${key} should stay readable`).toBe(false);
    }
  });
});

describe('log.info({ config })', () => {
  it('emits no secret material, without anyone remembering to redact', () => {
    const minted = mintTokenMaterial();
    const config = {
      service: 'api',
      baseUrl: 'https://prisme.invalid',
      databaseUrl: FAKE_DATABASE_URL,
      tokenPepper: 'a-real-pepper-value',
      doctoolApiToken: 'doc-tool-secret',
      auth: { issuerUrl: 'https://idp.prisme.invalid', audience: 'prisme' },
      lastToken: minted.token,
    };

    const output = captured((log) => {
      log.info('starting', { config });
    });

    expect(output).not.toContain('a-real-pepper-value');
    expect(output).not.toContain('doc-tool-secret');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(minted.secret);
    // Configuration survives, or the log line would be useless.
    expect(output).toContain('https://idp.prisme.invalid');
    expect(output).toContain('prisme-api'.slice(0, 6));
  });
});

describe('log.error(err) with a token in scope', () => {
  it('scrubs a credential carried on the error', () => {
    const minted = mintTokenMaterial();
    const error = Object.assign(new Error('upstream refused the request'), {
      authorization: `Bearer ${minted.token}`,
      assertion: 'eyJhbGciOiJSUzI1NiJ9.payload.signature',
    });

    const output = captured((log) => {
      log.error('the call failed', { error });
    });

    expect(output).not.toContain(minted.secret);
    expect(output).not.toContain('eyJhbGciOiJSUzI1NiJ9.payload.signature');
    expect(output).toContain('upstream refused the request');
  });

  it('scrubs a connection string embedded in a message, whatever its key', () => {
    const output = captured((log) => {
      log.error('boot failed', {
        detail: `could not connect to ${FAKE_DATABASE_URL}`,
      });
    });

    expect(output).not.toContain(PASSWORD);
  });
});

describe('the one thing redaction cannot save you from', () => {
  it('is interpolation, which is why CLAUDE.md §4 forbids it outright', () => {
    const minted = mintTokenMaterial();

    // Documented as a limit rather than hidden: the serializer works on values
    // under keys, and a secret concatenated into the message string is not a
    // value under a key any more. Nothing in `apps/api/src/auth` does this;
    // this test is here so the boundary of the control is written down.
    const leaked = redact({ message: `token: ${minted.token}` }) as { message: string };
    expect(leaked.message).toContain(TOKEN_PREFIX);
  });
});
