import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.js';
import { requiredFor } from './schema.js';

/** A complete, synthetic environment. Fixture values only — this repository is public. */
const COMPLETE: Record<string, string> = {
  DATABASE_URL: 'postgres://prisme_app:example@postgres:5432/prisme',
  PRISME_BASE_URL: 'https://prisme.example.com',
  AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme/',
  AUTH_AUDIENCE: 'prisme-client-id',
  AUTH_ALLOWED_SUBJECTS: 'subject-one,subject-two',
  TOKEN_PEPPER: 'example-pepper',
  DOCTOOL_API_TOKEN: 'example-doctool-token',
  TASKTOOL_API_TOKEN: 'example-tasktool-token',
};

describe('loadConfig', () => {
  it('applies every documented default', () => {
    const config = loadConfig({ env: COMPLETE, service: 'api' });

    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.timezone).toBe('Europe/Paris');
    expect(config.scoringActiveMethod).toBe('wsjf-balanced');
    expect(config.capacity).toEqual({ defaultTaskMinutes: 25, windowWeeks: 4 });
    expect(config.auth).toMatchObject({
      assertionHeader: 'X-authentik-jwt',
      allowedAlgs: ['RS256', 'ES256'],
      clockSkewSeconds: 60,
      assertionMaxLifetimeSeconds: 86400,
      jwksCacheTtlSeconds: 600,
    });
  });

  it('ships the write freeze on', () => {
    const config = loadConfig({ env: COMPLETE, service: 'api' });
    expect(config.sync.enabled).toBe(true);
    expect(config.sync.writeEnabled).toBe(false);
    expect(config.sync.createThreshold).toBe(0);
  });

  it('names every missing required variable, not just the first', () => {
    let thrown: ConfigError | undefined;
    try {
      loadConfig({ env: { PRISME_BASE_URL: 'https://prisme.example.com' }, service: 'api' });
    } catch (error) {
      thrown = error as ConfigError;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    const named = thrown!.problems.map((problem) => problem.variable);
    expect(named).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'AUTH_ISSUER_URL',
        'AUTH_AUDIENCE',
        'AUTH_ALLOWED_SUBJECTS',
        'TOKEN_PEPPER',
        'DOCTOOL_API_TOKEN',
        'TASKTOOL_API_TOKEN',
      ]),
    );
    expect(thrown!.message).toContain('DATABASE_URL');
  });

  it('never silently defaults a required value', () => {
    const { ...withoutDatabase } = COMPLETE;
    delete (withoutDatabase as Record<string, string | undefined>)['DATABASE_URL'];
    expect(() => loadConfig({ env: withoutDatabase, service: 'api' })).toThrow(/DATABASE_URL/);
  });

  it('treats an empty string as absent', () => {
    expect(() => loadConfig({ env: { ...COMPLETE, TOKEN_PEPPER: '   ' }, service: 'api' })).toThrow(
      /TOKEN_PEPPER/,
    );
  });

  it('refuses an empty subject allow-list rather than reading it as "allow everyone"', () => {
    expect(() =>
      loadConfig({ env: { ...COMPLETE, AUTH_ALLOWED_SUBJECTS: ' , ' }, service: 'api' }),
    ).toThrow(/AUTH_ALLOWED_SUBJECTS/);
  });

  it.each(['none', 'HS256', 'HS512'])('rejects %s in AUTH_ALLOWED_ALGS', (alg) => {
    expect(() =>
      loadConfig({ env: { ...COMPLETE, AUTH_ALLOWED_ALGS: `RS256,${alg}` }, service: 'api' }),
    ).toThrow(/AUTH_ALLOWED_ALGS/);
  });

  it('never echoes a value in the error message', () => {
    let message = '';
    try {
      loadConfig({
        env: { ...COMPLETE, DATABASE_URL: 'mysql://app:hunter2@db/prisme' },
        service: 'api',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });

  it('parses durations in the units the spec writes them in', () => {
    const config = loadConfig({
      env: { ...COMPLETE, AUTH_ASSERTION_MAX_LIFETIME: '1h', AUTH_JWKS_CACHE_TTL: '90s' },
      service: 'api',
    });
    expect(config.auth?.assertionMaxLifetimeSeconds).toBe(3600);
    expect(config.auth?.jwksCacheTtlSeconds).toBe(90);
  });

  it('rejects a sync window that runs backwards', () => {
    expect(() =>
      loadConfig({
        env: { ...COMPLETE, SYNC_WINDOW_START: '22', SYNC_WINDOW_END: '7' },
        service: 'api',
      }),
    ).toThrow(/SYNC_WINDOW_START/);
  });

  describe('per-service requirements', () => {
    it('the web tier needs no database credential', () => {
      expect(requiredFor('web')).not.toContain('DATABASE_URL');
      const config = loadConfig({
        env: {
          PRISME_BASE_URL: 'https://prisme.example.com',
          PRISME_API_URL: 'http://prisme-api:3000',
        },
        service: 'web',
      });
      expect(config.databaseUrl).toBeUndefined();
      expect(config.apiUrl).toBe('http://prisme-api:3000');
    });

    it('the migration job needs the DDL role and nothing else', () => {
      expect(requiredFor('migrate')).toEqual(['MIGRATION_DATABASE_URL']);
      const config = loadConfig({
        env: { MIGRATION_DATABASE_URL: 'postgres://prisme_migrate:example@postgres:5432/prisme' },
        service: 'migrate',
      });
      expect(config.migrationDatabaseUrl).toContain('postgres://');
    });

    it('the reconciler needs both external tokens', () => {
      expect(requiredFor('sync')).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'DOCTOOL_API_TOKEN', 'TASKTOOL_API_TOKEN']),
      );
    });
  });

  describe('input paths', () => {
    const rendered = Object.entries(COMPLETE)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    it('accepts the whole contract from a rendered env file', () => {
      const config = loadConfig({
        env: { PRISME_ENV_FILE: '/vault/secrets/prisme.env' },
        readFile: () => rendered,
        service: 'api',
      });
      expect(config.databaseUrl).toContain('postgres://');
    });

    it('lets the plain environment override one value without re-rendering', () => {
      const config = loadConfig({
        env: { PRISME_ENV_FILE: '/vault/secrets/prisme.env', LOG_LEVEL: 'debug' },
        readFile: () => rendered,
        service: 'api',
      });
      expect(config.logLevel).toBe('debug');
    });

    it('reports an unreadable env file as a configuration failure', () => {
      expect(() =>
        loadConfig({
          env: { PRISME_ENV_FILE: '/vault/secrets/prisme.env' },
          readFile: () => {
            throw new Error('ENOENT');
          },
          service: 'api',
        }),
      ).toThrow(/PRISME_ENV_FILE/);
    });
  });
});
