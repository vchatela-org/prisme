import { z } from 'zod';

/**
 * The configuration contract from docs/15-runtime.md §2, as one schema.
 *
 * Every setting in the system is here. Nothing reads `process.env` directly —
 * an ESLint rule enforces that — so this file is the complete, checkable list
 * of what prisme can be configured with.
 *
 * Two rules the spec is emphatic about, both enforced below:
 *
 *   - a required value is never silently defaulted;
 *   - `SYNC_WRITE_ENABLED` defaults to `false`. A fresh deployment that cannot
 *     write outward is harmless; one that writes on first boot is not.
 */

/** The four things that load configuration. Each needs a different subset. */
export const SERVICES = ['web', 'api', 'sync', 'migrate'] as const;
export type Service = (typeof SERVICES)[number];

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} must not be empty`);

const httpUrl = (label: string) =>
  nonEmpty(label).refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: `${label} must be an absolute http(s) URL` },
  );

const postgresUrl = (label: string) =>
  nonEmpty(label).refine(
    (value) => /^postgres(ql)?:\/\//i.test(value),
    // The message names the variable and the expected *shape*. It must never
    // echo the value: a connection string carries a password.
    { message: `${label} must be a postgres:// connection string` },
  );

const boolean = (label: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => ['true', 'false', '1', '0', 'yes', 'no'].includes(value), {
      message: `${label} must be one of true, false, 1, 0, yes, no`,
    })
    .transform((value) => value === 'true' || value === '1' || value === 'yes');

const integer = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => /^-?\d+$/.test(value), { message: `${label} must be a whole number` })
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= min && value <= max, {
      message: `${label} must be between ${min} and ${max}`,
    });

/** `90s`, `10m`, `24h`, `7d`, or a bare number of seconds. Returns seconds. */
const duration = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value);
      if (!match) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} must be a duration such as 30s, 10m, 24h or 7d`,
        });
        return z.NEVER;
      }
      const amount = Number.parseInt(match[1] as string, 10);
      const unit = (match[2] ?? 's').toLowerCase();
      const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
      return amount * seconds;
    });

const csv = (label: string) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .refine((entries) => entries.length > 0, {
      // Spelled out because the failure mode of the alternative is total.
      message: `${label} must list at least one value. An empty allow-list is a boot failure, not "allow everyone"`,
    });

/**
 * Asymmetric algorithms only. `none` and every HMAC variant are rejected here
 * regardless of what the environment asks for — docs/15-runtime.md §2.
 */
const ALLOWED_ALG = /^(RS|PS|ES)(256|384|512)$/;

const algs = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .refine((entries) => entries.length > 0, {
    message: 'AUTH_ALLOWED_ALGS must list at least one algorithm',
  })
  .refine((entries) => entries.every((entry) => ALLOWED_ALG.test(entry)), {
    message:
      'AUTH_ALLOWED_ALGS accepts asymmetric algorithms only (RS/PS/ES 256, 384 or 512). "none" and every HMAC variant are rejected',
  });

/**
 * One entry per environment variable.
 *
 * `required` is by service, so the web tier never needs `DATABASE_URL`: the
 * trust boundaries in docs/14-threat-model.md §2 run browser → web → API →
 * PostgreSQL, and a web process holding database credentials would widen the
 * blast radius of an XSS for no feature gain.
 */
export const VARIABLES = {
  DATABASE_URL: { schema: postgresUrl('DATABASE_URL'), required: ['api', 'sync'] },
  MIGRATION_DATABASE_URL: {
    schema: postgresUrl('MIGRATION_DATABASE_URL'),
    required: ['migrate'],
  },
  PRISME_BASE_URL: { schema: httpUrl('PRISME_BASE_URL'), required: ['web', 'api', 'sync'] },
  PRISME_API_URL: { schema: httpUrl('PRISME_API_URL'), required: ['web'] },
  AUTH_ISSUER_URL: { schema: httpUrl('AUTH_ISSUER_URL'), required: ['api'] },
  AUTH_AUDIENCE: { schema: nonEmpty('AUTH_AUDIENCE'), required: ['api'] },
  AUTH_ALLOWED_SUBJECTS: { schema: csv('AUTH_ALLOWED_SUBJECTS'), required: ['api'] },
  TOKEN_PEPPER: { schema: nonEmpty('TOKEN_PEPPER'), required: ['api'] },
  DOCTOOL_API_TOKEN: { schema: nonEmpty('DOCTOOL_API_TOKEN'), required: ['api', 'sync'] },
  TASKTOOL_API_TOKEN: { schema: nonEmpty('TASKTOOL_API_TOKEN'), required: ['api', 'sync'] },

  PORT: { schema: integer('PORT', 1, 65535), required: [], default: '3000' },
  LOG_LEVEL: {
    schema: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    required: [],
    default: 'info',
  },
  AUTH_JWKS_URL: { schema: httpUrl('AUTH_JWKS_URL'), required: [] },
  AUTH_ASSERTION_HEADER: {
    schema: nonEmpty('AUTH_ASSERTION_HEADER'),
    required: [],
    default: 'X-authentik-jwt',
  },
  AUTH_ALLOWED_ALGS: { schema: algs, required: [], default: 'RS256,ES256' },
  AUTH_CLOCK_SKEW_SECONDS: {
    schema: integer('AUTH_CLOCK_SKEW_SECONDS', 0, 3600),
    required: [],
    default: '60',
  },
  AUTH_ASSERTION_MAX_LIFETIME: {
    schema: duration('AUTH_ASSERTION_MAX_LIFETIME'),
    required: [],
    default: '24h',
  },
  AUTH_JWKS_CACHE_TTL: { schema: duration('AUTH_JWKS_CACHE_TTL'), required: [], default: '10m' },
  SYNC_ENABLED: { schema: boolean('SYNC_ENABLED'), required: [], default: 'true' },
  SYNC_WRITE_ENABLED: { schema: boolean('SYNC_WRITE_ENABLED'), required: [], default: 'false' },
  SYNC_CREATE_THRESHOLD: {
    schema: integer('SYNC_CREATE_THRESHOLD', 0, 10_000),
    required: [],
    default: '0',
  },
  SYNC_WINDOW_START: { schema: integer('SYNC_WINDOW_START', 0, 23), required: [], default: '7' },
  SYNC_WINDOW_END: { schema: integer('SYNC_WINDOW_END', 0, 23), required: [], default: '22' },
  CAPACITY_DEFAULT_TASK_MINUTES: {
    schema: integer('CAPACITY_DEFAULT_TASK_MINUTES', 1, 1440),
    required: [],
    default: '25',
  },
  CAPACITY_WINDOW_WEEKS: {
    schema: integer('CAPACITY_WINDOW_WEEKS', 1, 520),
    required: [],
    default: '4',
  },
  SCORING_ACTIVE_METHOD: {
    schema: nonEmpty('SCORING_ACTIVE_METHOD'),
    required: [],
    default: 'wsjf-balanced',
  },
  TZ: { schema: nonEmpty('TZ'), required: [], default: 'Europe/Paris' },
} as const satisfies Record<
  string,
  { schema: z.ZodType; required: readonly Service[]; default?: string }
>;

export type VariableName = keyof typeof VARIABLES;

export function requiredFor(service: Service): VariableName[] {
  return (Object.keys(VARIABLES) as VariableName[]).filter((name) =>
    (VARIABLES[name].required as readonly Service[]).includes(service),
  );
}
