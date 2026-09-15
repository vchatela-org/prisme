import { describe, expect, it } from 'vitest';
import { collectEnv, ConfigSourceError, parseEnvFile } from './sources.js';

describe('parseEnvFile', () => {
  it('reads the shapes a rendered template actually produces', () => {
    const parsed = parseEnvFile(
      [
        '# rendered by the vault agent',
        '',
        'DATABASE_URL=postgres://app:pw@db:5432/prisme',
        'export TOKEN_PEPPER="quoted value"',
        "SCORING_ACTIVE_METHOD='wsjf-balanced'",
        'PORT=3000 # the http port',
        'AUTH_AUDIENCE=prisme',
      ].join('\n'),
    );

    expect(parsed).toEqual({
      DATABASE_URL: 'postgres://app:pw@db:5432/prisme',
      TOKEN_PEPPER: 'quoted value',
      SCORING_ACTIVE_METHOD: 'wsjf-balanced',
      PORT: '3000',
      AUTH_AUDIENCE: 'prisme',
    });
  });

  it('unescapes inside double quotes, which is where a PEM-ish value would land', () => {
    expect(parseEnvFile('K="a\\nb"')['K']).toBe('a\nb');
  });

  it('refuses a malformed line rather than skipping it', () => {
    expect(() => parseEnvFile('DATABASE_URL')).toThrow(ConfigSourceError);
    expect(() => parseEnvFile('9BAD=x')).toThrow(ConfigSourceError);
  });
});

describe('collectEnv precedence', () => {
  const files: Record<string, string> = {
    '/vault/secrets/prisme.env': ['PORT=1111', 'TOKEN_PEPPER=from-env-file'].join('\n'),
    '/run/secrets/pepper': 'from-per-secret-file\n',
  };
  const readFile = (path: string) => {
    const contents = files[path];
    if (contents === undefined) throw new Error('ENOENT');
    return contents;
  };

  it('plain environment beats a per-secret file, which beats the rendered env file', () => {
    const merged = collectEnv({
      env: {
        PRISME_ENV_FILE: '/vault/secrets/prisme.env',
        TOKEN_PEPPER_FILE: '/run/secrets/pepper',
        PORT: '3000',
      },
      readFile,
    });

    expect(merged['PORT']).toBe('3000');
    expect(merged['TOKEN_PEPPER']).toBe('from-per-secret-file');
  });

  it('falls back to the rendered env file when nothing overrides it', () => {
    const merged = collectEnv({ env: { PRISME_ENV_FILE: '/vault/secrets/prisme.env' }, readFile });
    expect(merged['PORT']).toBe('1111');
    expect(merged['TOKEN_PEPPER']).toBe('from-env-file');
  });

  it('strips the trailing newline a per-secret file almost always has', () => {
    const merged = collectEnv({ env: { TOKEN_PEPPER_FILE: '/run/secrets/pepper' }, readFile });
    expect(merged['TOKEN_PEPPER']).toBe('from-per-secret-file');
  });

  it('fails when PRISME_ENV_FILE points at nothing — the init container has not finished', () => {
    expect(() =>
      collectEnv({ env: { PRISME_ENV_FILE: '/vault/secrets/missing' }, readFile }),
    ).toThrow(ConfigSourceError);
  });
});
