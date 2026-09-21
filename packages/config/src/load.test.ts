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

/**
 * The web tier's own contract: the API's URL, the three auth values it must
 * verify with, and **no database credential at all**
 * (docs/14-threat-model.md §2).
 */
const WEB: Record<string, string> = {
  PRISME_BASE_URL: 'https://prisme.example.com',
  PRISME_API_URL: 'https://prisme.example.com/api',
  AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme/',
  AUTH_AUDIENCE: 'prisme-client-id',
  AUTH_ALLOWED_SUBJECTS: 'subject-one,subject-two',
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

  describe('AREA_COLOR_PINS', () => {
    it('defaults to no pinning, which is the key-derived hash every screen has today', () => {
      expect(loadConfig({ env: WEB, service: 'web' }).areaColorPins).toEqual({});
    });

    it('reads an area key to a palette slot, as a number', () => {
      const config = loadConfig({
        env: { ...WEB, AREA_COLOR_PINS: '{"craft":3,"health":1}' },
        service: 'web',
      });
      // Numbers, not the strings a JSON parser is not being asked for: the
      // value reaches `colorSlotClass`, whose table is keyed by integers.
      expect(config.areaColorPins).toEqual({ craft: 3, health: 1 });
      expect(typeof config.areaColorPins['craft']).toBe('number');
    });

    it('accepts an area key that is not an identifier, because keys are instance data', () => {
      const config = loadConfig({
        env: { ...WEB, AREA_COLOR_PINS: '{"a key with spaces":8}' },
        service: 'web',
      });
      expect(config.areaColorPins).toEqual({ 'a key with spaces': 8 });
    });

    it.each([
      ['0', '{"craft":0}', /1 to 8/],
      ['9', '{"craft":9}', /1 to 8/],
      ['a fraction', '{"craft":1.5}', /1 to 8/],
      ['a string slot', '{"craft":"3"}', /1 to 8/],
      ['an empty key', '{"  ":1}', /empty area key/],
    ])('refuses %s', (_label, value, message: RegExp) => {
      // A slot the palette cannot paint is a boot failure rather than a missing
      // swatch discovered on a chart. The ceiling is eight because that is the
      // palette's slot count, and it is fixed.
      expect(() => loadConfig({ env: { ...WEB, AREA_COLOR_PINS: value }, service: 'web' })).toThrow(
        message,
      );
    });

    it.each([
      ['not JSON at all', 'craft=3'],
      ['an array', '["craft"]'],
      ['a bare string', '"craft"'],
    ])('refuses %s', (_label, value) => {
      expect(() => loadConfig({ env: { ...WEB, AREA_COLOR_PINS: value }, service: 'web' })).toThrow(
        /AREA_COLOR_PINS/,
      );
    });

    it('names the offending area key but never a neighbouring slot', () => {
      // An area key is instance data and this message reaches a log, so the
      // message may name the key it is about — a caller needs that to fix it —
      // and nothing about any other pin.
      let message = '';
      try {
        loadConfig({
          env: { ...WEB, AREA_COLOR_PINS: '{"craft":2,"health":99}' },
          service: 'web',
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('health');
      expect(message).not.toContain('craft');
    });

    it('is read by the web tier, which holds no database credential', () => {
      // A key carrying instance data must not be the reason a database
      // credential enters the web process: it is the one thing the web tier
      // must never hold (docs/14-threat-model.md §2).
      const config = loadConfig({
        env: { ...WEB, AREA_COLOR_PINS: '{"health":1}' },
        service: 'web',
      });
      expect(config.areaColorPins).toEqual({ health: 1 });
      expect(config.databaseUrl).toBeUndefined();
    });
  });

  describe('the outward API hosts', () => {
    it('defaults to nothing, so the vendor hostname lives in the connectors alone', () => {
      // The point of leaving these unset rather than defaulting them here: a
      // default in this package would be a second copy of a hostname that
      // `packages/connectors` already owns, and two copies drift.
      const config = loadConfig({ env: COMPLETE, service: 'api' });
      expect(config.doctoolBaseUrl).toBeUndefined();
      expect(config.tasktoolBaseUrl).toBeUndefined();
    });

    it('overrides either API host when an instance names one', () => {
      const config = loadConfig({
        env: {
          ...COMPLETE,
          DOCTOOL_BASE_URL: 'https://doctool.internal.example.com',
          TASKTOOL_BASE_URL: 'https://tasktool.internal.example.com',
        },
        service: 'api',
      });
      expect(config.doctoolBaseUrl).toBe('https://doctool.internal.example.com');
      expect(config.tasktoolBaseUrl).toBe('https://tasktool.internal.example.com');
    });

    it.each([
      ['a bare hostname', 'doctool.internal.example.com'],
      ['a non-http scheme', 'ftp://doctool.example.com'],
      ['a scheme and nothing else', 'https://'],
    ])('refuses %s', (_label, value) => {
      expect(() =>
        loadConfig({ env: { ...COMPLETE, DOCTOOL_BASE_URL: value }, service: 'api' }),
      ).toThrow(/DOCTOOL_BASE_URL/);
    });

    it('reads an empty value as unset rather than as a malformed host', () => {
      // The schema's rule for every optional variable: a Vault template that
      // emits `DOCTOOL_BASE_URL=` for an instance that has not overridden one
      // must not stop the boot. Reaching the client as `undefined` is what puts
      // the vendor default back, which is the behaviour intended.
      const config = loadConfig({
        env: { ...COMPLETE, DOCTOOL_BASE_URL: '', TASKTOOL_BASE_URL: '  ' },
        service: 'api',
      });
      expect(config.doctoolBaseUrl).toBeUndefined();
      expect(config.tasktoolBaseUrl).toBeUndefined();
    });

    it('is required of no service, because the client default covers every instance', () => {
      // Marking one `required` would make it mandatory for a deployment that is
      // perfectly configured without it — which is every deployment today.
      expect(requiredFor('api')).not.toContain('DOCTOOL_BASE_URL');
      expect(requiredFor('sync')).not.toContain('TASKTOOL_BASE_URL');
      expect(requiredFor('web')).not.toContain('DOCTOOL_BASE_URL');
    });
  });

  describe('per-service requirements', () => {
    it('the web tier needs no database credential', () => {
      expect(requiredFor('web')).not.toContain('DATABASE_URL');
      const config = loadConfig({
        env: {
          PRISME_BASE_URL: 'https://prisme.example.com',
          PRISME_API_URL: 'http://prisme-api:3000',
          // Required of the web tier as of W14: ADR-0021 rule 6 gives it the
          // same verification job as the API. This is the boundary that
          // matters, and it is unchanged — `DATABASE_URL` is still absent.
          AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme',
          AUTH_AUDIENCE: 'prisme',
          AUTH_ALLOWED_SUBJECTS: 'abc123',
        },
        service: 'web',
      });
      expect(config.databaseUrl).toBeUndefined();
      expect(config.apiUrl).toBe('http://prisme-api:3000');
    });

    it('gives the web tier an assertion policy, because it verifies too', () => {
      // The web tier used to get `auth: undefined` whatever it was configured
      // with, because the object was built only for the API. That produced a
      // boot failure reporting an empty subject allow-list about a variable
      // that was set — see the note in `load.ts`.
      const config = loadConfig({
        env: {
          PRISME_BASE_URL: 'https://prisme.example.com',
          PRISME_API_URL: 'http://prisme-api:3000',
          AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme',
          AUTH_AUDIENCE: 'prisme',
          AUTH_ALLOWED_SUBJECTS: 'abc123, def456',
        },
        service: 'web',
      });

      expect(config.auth?.issuerUrl).toBe('https://idp.example.com/application/o/prisme');
      expect(config.auth?.allowedSubjects).toEqual(['abc123', 'def456']);
      // …and still no credential of any kind on this path (ADR-0021).
      expect(config.tokenPepper).toBeUndefined();
      expect(config.doctoolApiToken).toBeUndefined();
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
