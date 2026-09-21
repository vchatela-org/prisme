import { collectEnv, ConfigSourceError, type RawEnv, type SourceOptions } from './sources.js';
import { requiredFor, VARIABLES, type Service, type VariableName } from './schema.js';

/**
 * `loadConfig()` — validated at boot, fails fast and loud.
 *
 * "Loud" is the part that matters. A service that starts with half its
 * configuration missing fails later, further from the cause, and usually in
 * front of the user. So: every problem is collected, reported together, and the
 * message names the variable. A value is never echoed — a message containing a
 * connection string has published a password.
 */

export interface AuthConfig {
  readonly issuerUrl: string;
  readonly audience: string;
  readonly allowedSubjects: readonly string[];
  /** Discovered from the issuer when unset. **Never** taken from a request header. */
  readonly jwksUrl: string | undefined;
  readonly assertionHeader: string;
  readonly allowedAlgs: readonly string[];
  readonly clockSkewSeconds: number;
  readonly assertionMaxLifetimeSeconds: number;
  readonly jwksCacheTtlSeconds: number;
}

export interface SyncConfig {
  readonly enabled: boolean;
  /** Ships off. See docs/13-migration.md. */
  readonly writeEnabled: boolean;
  readonly createThreshold: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}

export interface CapacityConfig {
  readonly defaultTaskMinutes: number;
  readonly windowWeeks: number;
}

export interface Config {
  readonly service: Service;
  readonly port: number;
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly timezone: string;
  readonly baseUrl: string;
  /** Only the web tier has one; it talks to the API, never to the database. */
  readonly apiUrl: string | undefined;
  /** Application role: DML only. Absent for the web tier. */
  readonly databaseUrl: string | undefined;
  /** Migration role: DDL. Present only for the migration job. */
  readonly migrationDatabaseUrl: string | undefined;
  readonly tokenPepper: string | undefined;
  readonly doctoolApiToken: string | undefined;
  readonly tasktoolApiToken: string | undefined;
  readonly auth: AuthConfig | undefined;
  readonly sync: SyncConfig;
  readonly capacity: CapacityConfig;
  readonly scoringActiveMethod: string;
  /**
   * An instance's area key → palette slot pinning (W09's defect, closed).
   *
   * Empty by default, which means the key-derived hash decides — and the hash
   * collides for most six-area sets. **Only the web tier reads it**, and it is
   * typed as plain numbers rather than as the design system's slot union so
   * that `@prisme/config` keeps no dependency on `@prisme/ui`. The schema is
   * what makes the narrowing true: a slot outside 1–8 is a boot failure.
   */
  readonly areaColorPins: Readonly<Record<string, number>>;
}

export interface ConfigProblem {
  readonly variable: string;
  readonly message: string;
}

export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(service: Service, problems: readonly ConfigProblem[]) {
    const lines = problems.map((problem) => `  - ${problem.variable}: ${problem.message}`);
    super(
      `prisme-${service}: configuration is invalid, refusing to start.\n` +
        lines.join('\n') +
        '\n\nEvery variable is documented in docs/15-runtime.md §2. Values may arrive in the plain ' +
        'environment, in a <NAME>_FILE, or in the rendered file named by PRISME_ENV_FILE.',
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export interface LoadConfigOptions extends SourceOptions {
  /** Which subset of the contract is required. Defaults to `api`. */
  readonly service?: Service;
}

function parseOne(
  name: VariableName,
  raw: RawEnv,
  service: Service,
  problems: ConfigProblem[],
): unknown {
  const definition: { schema: { safeParse: (v: unknown) => unknown }; default?: string } =
    VARIABLES[name];
  const present = raw[name];
  const supplied = present !== undefined && present.trim() !== '';

  if (!supplied) {
    if (requiredFor(service).includes(name)) {
      problems.push({
        variable: name,
        message: 'is required and was not supplied (it is not defaulted)',
      });
      return undefined;
    }
    if (definition.default === undefined) return undefined;
  }

  const value = supplied ? present : (definition.default as string);
  const result = VARIABLES[name].schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => issue.message)
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .join('; ');
    problems.push({ variable: name, message });
    return undefined;
  }
  return result.data;
}

/**
 * Read, merge and validate the environment.
 *
 * Throws {@link ConfigError} on anything invalid. Callers are expected not to
 * catch it: an entrypoint prints the message and exits non-zero.
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const service = options.service ?? 'api';

  let raw: RawEnv;
  try {
    raw = collectEnv(options);
  } catch (error) {
    if (error instanceof ConfigSourceError) {
      throw new ConfigError(service, [{ variable: 'PRISME_ENV_FILE', message: error.message }]);
    }
    throw error;
  }

  const problems: ConfigProblem[] = [];
  const parsed = Object.fromEntries(
    (Object.keys(VARIABLES) as VariableName[]).map((name) => [
      name,
      parseOne(name, raw, service, problems),
    ]),
  ) as Record<VariableName, unknown>;

  if (parsed['SYNC_WINDOW_START'] !== undefined && parsed['SYNC_WINDOW_END'] !== undefined) {
    if ((parsed['SYNC_WINDOW_START'] as number) >= (parsed['SYNC_WINDOW_END'] as number)) {
      problems.push({
        variable: 'SYNC_WINDOW_START',
        message: 'must be earlier in the day than SYNC_WINDOW_END',
      });
    }
  }

  if (problems.length > 0) throw new ConfigError(service, problems);

  /*
   * Assembled for the two services that verify assertions (W14).
   *
   * It used to be `service === 'api'`, which was true when only the API
   * verified. ADR-0021 rule 6 gives the web tier the same job, and the failure
   * this caused was worth the walk: with the variables required for `web` but
   * the object still built only for `api`, `config.auth` came back `undefined`,
   * the middleware's defensive fallbacks turned that into an empty policy, and
   * the process died reporting "AUTH_ALLOWED_SUBJECTS is empty" about a
   * variable that was set correctly. The fallbacks are gone too — a default
   * that hides a wiring bug is worse than the crash it prevents.
   */
  const auth: AuthConfig | undefined =
    service === 'api' || service === 'web'
      ? {
          issuerUrl: parsed['AUTH_ISSUER_URL'] as string,
          audience: parsed['AUTH_AUDIENCE'] as string,
          allowedSubjects: parsed['AUTH_ALLOWED_SUBJECTS'] as string[],
          jwksUrl: parsed['AUTH_JWKS_URL'] as string | undefined,
          assertionHeader: parsed['AUTH_ASSERTION_HEADER'] as string,
          allowedAlgs: parsed['AUTH_ALLOWED_ALGS'] as string[],
          clockSkewSeconds: parsed['AUTH_CLOCK_SKEW_SECONDS'] as number,
          assertionMaxLifetimeSeconds: parsed['AUTH_ASSERTION_MAX_LIFETIME'] as number,
          jwksCacheTtlSeconds: parsed['AUTH_JWKS_CACHE_TTL'] as number,
        }
      : undefined;

  return {
    service,
    port: parsed['PORT'] as number,
    logLevel: parsed['LOG_LEVEL'] as Config['logLevel'],
    timezone: parsed['TZ'] as string,
    baseUrl: (parsed['PRISME_BASE_URL'] as string | undefined) ?? '',
    apiUrl: parsed['PRISME_API_URL'] as string | undefined,
    databaseUrl: parsed['DATABASE_URL'] as string | undefined,
    migrationDatabaseUrl: parsed['MIGRATION_DATABASE_URL'] as string | undefined,
    tokenPepper: parsed['TOKEN_PEPPER'] as string | undefined,
    doctoolApiToken: parsed['DOCTOOL_API_TOKEN'] as string | undefined,
    tasktoolApiToken: parsed['TASKTOOL_API_TOKEN'] as string | undefined,
    auth,
    sync: {
      enabled: parsed['SYNC_ENABLED'] as boolean,
      writeEnabled: parsed['SYNC_WRITE_ENABLED'] as boolean,
      createThreshold: parsed['SYNC_CREATE_THRESHOLD'] as number,
      windowStart: parsed['SYNC_WINDOW_START'] as number,
      windowEnd: parsed['SYNC_WINDOW_END'] as number,
    },
    capacity: {
      defaultTaskMinutes: parsed['CAPACITY_DEFAULT_TASK_MINUTES'] as number,
      windowWeeks: parsed['CAPACITY_WINDOW_WEEKS'] as number,
    },
    scoringActiveMethod: parsed['SCORING_ACTIVE_METHOD'] as string,
    areaColorPins: parsed['AREA_COLOR_PINS'] as Readonly<Record<string, number>>,
  };
}

/**
 * Load configuration or exit.
 *
 * Every entrypoint starts with this. The message goes to stderr rather than the
 * JSON logger because the logger's own level comes from the configuration that
 * just failed to load, and a boot failure that is not visible is the worst of
 * both worlds.
 */
export function loadConfigOrExit(options: LoadConfigOptions = {}): Config {
  try {
    return loadConfig(options);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(error.message + '\n');
      process.exit(78); // EX_CONFIG, sysexits.h
    }
    throw error;
  }
}
