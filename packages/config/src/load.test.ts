import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.js';
import { requiredFor, VARIABLES } from './schema.js';

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
 * verify with, the OIDC client it logs people in with (ADR-0026), and **no
 * database credential at all** (docs/14-threat-model.md §2).
 *
 * `AUTH_AUDIENCE` and `OIDC_CLIENT_ID` are the same value on purpose: the ID
 * token's `aud` is the client id by specification, and `load.ts` refuses a pair
 * that disagrees.
 */
const WEB: Record<string, string> = {
  PRISME_BASE_URL: 'https://prisme.example.com',
  PRISME_API_URL: 'https://prisme.example.com/api',
  AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme/',
  AUTH_AUDIENCE: 'prisme-client-id',
  AUTH_ALLOWED_SUBJECTS: 'subject-one,subject-two',
  OIDC_CLIENT_ID: 'prisme-client-id',
  OIDC_REDIRECT_URI: 'https://prisme.example.com/auth/callback',
  OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.com/application/o/authorize/',
  OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/application/o/token/',
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

  describe('the browser-facing page URL template', () => {
    it('is unset by default, so Open page is disabled until somebody sets it', () => {
      const config = loadConfig({ env: WEB, service: 'web' });
      expect(config.doctoolPageUrlTemplate).toBeUndefined();
    });

    it('keeps the placeholder rather than percent-encoding it', () => {
      // The trap this variable has and the two above do not: `new URL` encodes
      // braces, so a template read back through `.href` would carry `%7Bid%7D`
      // and substitute nothing. The value must survive validation intact.
      const config = loadConfig({
        env: { ...WEB, DOCTOOL_PAGE_URL_TEMPLATE: 'https://workspace.example.com/p/{id}' },
        service: 'web',
      });
      expect(config.doctoolPageUrlTemplate).toBe('https://workspace.example.com/p/{id}');
    });

    it.each([
      ['a template with no placeholder', 'https://workspace.example.com/pages'],
      ['a bare hostname', 'workspace.example.com/{id}'],
      ['a non-http scheme', 'ftp://workspace.example.com/{id}'],
    ])('refuses %s', (_label, value) => {
      expect(() =>
        loadConfig({ env: { ...WEB, DOCTOOL_PAGE_URL_TEMPLATE: value }, service: 'web' }),
      ).toThrow(/DOCTOOL_PAGE_URL_TEMPLATE/);
    });

    it('is required of no service either', () => {
      expect(requiredFor('web')).not.toContain('DOCTOOL_PAGE_URL_TEMPLATE');
      expect(requiredFor('api')).not.toContain('DOCTOOL_PAGE_URL_TEMPLATE');
    });
  });

  /*
   * ADR-0026 rule 4, as a set of assertions.
   *
   * The decision's stated price is a login flow in exchange for keeping
   * verification where it is, and one half of that bargain is that the human
   * path still **holds no secret**. A `OIDC_CLIENT_SECRET` added later would
   * look like ordinary configuration and would silently falsify the property
   * docs/15-runtime.md §2 states — so the absence is checked here rather than
   * left to a reader's memory.
   */
  describe('the OIDC client', () => {
    it('is assembled for the web tier, which is the only tier that logs anybody in', () => {
      const config = loadConfig({ env: WEB, service: 'web' });
      expect(config.oidc).toEqual({
        clientId: 'prisme-client-id',
        redirectUri: 'https://prisme.example.com/auth/callback',
        authorizationEndpoint: 'https://idp.example.com/application/o/authorize/',
        tokenEndpoint: 'https://idp.example.com/application/o/token/',
        endSessionEndpoint: undefined,
        scopes: ['openid', 'profile', 'email'],
      });
    });

    it('is absent for the API, the reconciler and the migration job', () => {
      // ADR-0026 rule 5: the API tier is unchanged. It verifies a JWT it is
      // handed and never exchanges a code, so it is not given the means to.
      expect(loadConfig({ env: COMPLETE, service: 'api' }).oidc).toBeUndefined();
      expect(loadConfig({ env: COMPLETE, service: 'sync' }).oidc).toBeUndefined();

      for (const service of ['api', 'sync', 'migrate'] as const) {
        for (const name of requiredFor(service)) {
          expect(name.startsWith('OIDC_')).toBe(false);
        }
      }
    });

    it('has no client secret to leak, because there is no such variable', () => {
      const names = Object.keys(VARIABLES).filter((name) => name.startsWith('OIDC_'));
      expect(names.sort()).toEqual([
        'OIDC_AUTHORIZATION_ENDPOINT',
        'OIDC_CLIENT_ID',
        'OIDC_END_SESSION_ENDPOINT',
        'OIDC_REDIRECT_URI',
        'OIDC_SCOPES',
        'OIDC_TOKEN_ENDPOINT',
      ]);
      // Not merely "no SECRET in the name": the one OIDC variable that has a
      // default is a scope list, and nothing that decides *where a credential
      // goes* — or is one — is defaulted at all.
      //
      // `'default' in entry` rather than reading the property directly: the
      // table is a union of row shapes, only some of which declare a default,
      // so reading it off the union is a type error — and the `in` check is
      // also the honest reading of the question, which is *which rows have
      // one*, not which rows have a non-undefined value.
      const defaulted = names.filter((name) => {
        const entry = VARIABLES[name as keyof typeof VARIABLES];
        return 'default' in entry && entry.default !== undefined;
      });
      expect(defaulted).toEqual(['OIDC_SCOPES']);
    });

    it('never defaults the values that decide where a code is sent', () => {
      // A defaulted client id, callback URL or endpoint is a deployment that
      // believes it is configured and sends a code somewhere it chose.
      for (const name of [
        'OIDC_CLIENT_ID',
        'OIDC_REDIRECT_URI',
        'OIDC_AUTHORIZATION_ENDPOINT',
        'OIDC_TOKEN_ENDPOINT',
      ] as const) {
        const { [name]: _omitted, ...rest } = WEB;
        expect(() => loadConfig({ env: rest, service: 'web' })).toThrow(new RegExp(name));
      }
    });

    it.each([
      ['a relative callback', 'auth/callback'],
      ['a scheme and nothing else', 'https://'],
      ['a non-http scheme', 'ftp://prisme.example.com/auth/callback'],
    ])('refuses %s', (_label, value) => {
      expect(() =>
        loadConfig({ env: { ...WEB, OIDC_REDIRECT_URI: value }, service: 'web' }),
      ).toThrow(/OIDC_REDIRECT_URI/);
    });

    describe('OIDC_SCOPES', () => {
      it.each([
        ['whitespace-separated, as providers document it', 'openid profile email'],
        ['comma-separated, as half the deployment repositories write it', 'openid,profile,email'],
        ['both, and repeated spaces', 'openid   profile,email'],
      ])('accepts %s', (_label, value) => {
        const config = loadConfig({ env: { ...WEB, OIDC_SCOPES: value }, service: 'web' });
        expect(config.oidc?.scopes).toEqual(['openid', 'profile', 'email']);
      });

      it('refuses a scope list with no openid in it', () => {
        // Without `openid` the provider returns no ID token, so there would be
        // nothing to verify and the failure would surface one hop later as a
        // missing claim rather than a missing scope.
        expect(() =>
          loadConfig({ env: { ...WEB, OIDC_SCOPES: 'profile email' }, service: 'web' }),
        ).toThrow(/openid/);
      });

      it('refuses an empty list rather than reading it as "the defaults"', () => {
        expect(() => loadConfig({ env: { ...WEB, OIDC_SCOPES: ' , ' }, service: 'web' })).toThrow(
          /OIDC_SCOPES/,
        );
      });
    });

    describe('the pairs that are each valid alone', () => {
      it('refuses a callback on another origin than PRISME_BASE_URL', () => {
        // The session cookie is scoped to the base URL's origin, so a callback
        // elsewhere would be a browser that never sends it back — a login loop
        // with no error anywhere.
        let thrown: ConfigError | undefined;
        try {
          loadConfig({
            env: { ...WEB, OIDC_REDIRECT_URI: 'https://other.example.com/auth/callback' },
            service: 'web',
          });
        } catch (error) {
          thrown = error as ConfigError;
        }
        expect(thrown).toBeInstanceOf(ConfigError);
        expect(thrown!.problems.map((problem) => problem.variable)).toContain('OIDC_REDIRECT_URI');
        // Values are never echoed: a URL is deployment detail (docs/17-privacy.md §1).
        expect(thrown!.message).not.toContain('other.example.com');
      });

      it('accepts a callback on the same origin even when PRISME_BASE_URL carries a path', () => {
        // `PRISME_BASE_URL` may legitimately carry a path; the comparison is
        // by origin, not by string.
        const config = loadConfig({
          env: { ...WEB, PRISME_BASE_URL: 'https://prisme.example.com/anything' },
          service: 'web',
        });
        expect(config.oidc?.redirectUri).toBe('https://prisme.example.com/auth/callback');
      });

      it('refuses an audience that is not the client id', () => {
        // The ID token's `aud` *is* the client id (OIDC Core §2). Disagreeing
        // means a login that succeeds at the provider and is then refused here,
        // as an unexplained 401, one hop from either variable.
        let thrown: ConfigError | undefined;
        try {
          loadConfig({ env: { ...WEB, AUTH_AUDIENCE: 'something-else' }, service: 'web' });
        } catch (error) {
          thrown = error as ConfigError;
        }
        expect(thrown).toBeInstanceOf(ConfigError);
        expect(thrown!.problems.map((problem) => problem.variable)).toContain('AUTH_AUDIENCE');
      });

      it('does not apply either check to a service that has no login flow', () => {
        // The API's audience is its own business: it never sees an ID token.
        expect(() =>
          loadConfig({ env: { ...COMPLETE, AUTH_AUDIENCE: 'the-api-audience' }, service: 'api' }),
        ).not.toThrow();
      });
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
          // …and as of ADR-0026 it runs the login flow too, which is why the
          // OIDC client is required of this service and of no other.
          OIDC_CLIENT_ID: 'prisme',
          OIDC_REDIRECT_URI: 'https://prisme.example.com/auth/callback',
          OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.com/application/o/authorize/',
          OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/application/o/token/',
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
          OIDC_CLIENT_ID: 'prisme',
          OIDC_REDIRECT_URI: 'https://prisme.example.com/auth/callback',
          OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.com/application/o/authorize/',
          OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/application/o/token/',
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
