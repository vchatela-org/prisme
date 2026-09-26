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

/**
 * An absolute http(s) URL with a `{id}` placeholder in it.
 *
 * The placeholder is a literal, not a `URL` template — `new URL` percent-encodes
 * braces, so a template read back through `.href` would carry `%7Bid%7D` and
 * never substitute. Validation parses a copy with the placeholder replaced
 * instead, so the value that reaches the substitution keeps its braces.
 *
 * Required rather than defaulted, because a template without a placeholder is a
 * link to the same page for everything — which looks configured and is never
 * right.
 */
const pageUrlTemplate = (label: string) =>
  httpUrl(label).refine((value) => value.includes('{id}'), {
    message: `${label} must contain {id}, the placeholder a page's identifier is substituted into`,
  });

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
 * Area key → palette slot, as a JSON object: `{"craft":3,"health":1}`.
 *
 * The keys are an instance's area keys, which makes this **instance data** in
 * the strictest sense: this repository is public and may not contain one
 * (docs/17-privacy.md). That is why the pinning arrives as configuration rather
 * than as a table in `packages/ui`.
 *
 * It exists because the palette has eight categorical slots and that ceiling is
 * fixed — a ninth generated hue is indistinguishable from an existing one under
 * colour-vision deficiency. Six areas hashed into eight slots collide most of
 * the time; that is the birthday problem, not a bad hash. Without a pinning map
 * two areas render in the same colour, which is exactly the defect W09 recorded
 * and this key closes.
 *
 * A slot outside `1`–`8` is a **boot failure** rather than a colour nobody
 * chose: a value the palette cannot paint would otherwise be discovered on a
 * chart, by a reader, as a missing swatch.
 */
const areaColorPins = () =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      // Every message below reads as the continuation of `<VARIABLE>: `, which
      // is how `ConfigError` renders a problem — so none of them repeats the
      // variable name.
      const fail = (message: string): typeof z.NEVER => {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      };

      let parsed: unknown;
      try {
        parsed = JSON.parse(value === '' ? '{}' : value);
      } catch {
        return fail(
          'must be a JSON object mapping an area key to a palette slot, e.g. {"craft":3}',
        );
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(
          `must be a JSON object, not ${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
        );
      }

      const pins: Record<string, number> = {};
      for (const [key, slot] of Object.entries(parsed as Record<string, unknown>)) {
        if (key.trim() === '') {
          return fail('has an entry with an empty area key');
        }
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 8) {
          // Names the key it is about, because a caller needs that to fix it,
          // and nothing about any other pin. An area key is instance data, and
          // this message reaches a log.
          return fail(
            `pins "${key}" to a slot that is not a whole number from 1 to 8, the palette's slot count`,
          );
        }
        pins[key] = slot;
      }
      return pins;
    });

/**
 * `OIDC_SCOPES`.
 *
 * Whitespace- or comma-separated, because every provider's documentation writes
 * the list one way and half the deployment repositories write it the other.
 *
 * `openid` is required and not defaulted *into* the value: without it the
 * provider answers with an OAuth2 access token and no ID token, so the callback
 * would have nothing to verify and the login would fail one hop later with a
 * message about a missing claim rather than a missing scope. That is a boot
 * failure here instead.
 */
const scopes = (label: string) =>
  z
    .string()
    .transform((value) =>
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .refine((entries) => entries.length > 0, { message: `${label} must list at least one scope` })
    .refine((entries) => entries.includes('openid'), {
      message:
        `${label} must include "openid". Without it the provider returns no ID token, which is the ` +
        'only thing prisme can verify',
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
  /*
   * Required by the **web tier as well as the API** (W14).
   *
   * The P0 contract marked these `api`-only, on the reading that the web tier
   * merely relays. ADR-0021 rule 6 says otherwise, in terms: the web tier
   * verifies the assertion and forwards the one it verified, and "the web tier
   * is not a trusted hop". A tier that verifies needs the issuer, the audience
   * and the subject allow-list — there is no verification without them.
   *
   * This is not a widening of what the web process holds in any meaningful
   * sense: `AUTH_*` values are configuration rather than credentials
   * (docs/15-runtime.md §2), and the human authentication path holds no secret
   * at all. `DATABASE_URL` is still absent from the web contract, which is the
   * boundary that actually matters (docs/14-threat-model.md §2).
   */
  AUTH_ISSUER_URL: { schema: httpUrl('AUTH_ISSUER_URL'), required: ['web', 'api'] },
  AUTH_AUDIENCE: { schema: nonEmpty('AUTH_AUDIENCE'), required: ['web', 'api'] },
  AUTH_ALLOWED_SUBJECTS: { schema: csv('AUTH_ALLOWED_SUBJECTS'), required: ['web', 'api'] },
  /*
   * The OIDC client the **web tier** logs humans in with (ADR-0026).
   *
   * Required for `web` and for nothing else, which is the whole of the change
   * ADR-0026 makes: the web tier stops inheriting an assertion from a proxy and
   * starts obtaining the ID token itself, so the client registration lives
   * where the login flow lives. The API keeps verifying a JWT it is handed
   * (ADR-0026 rule 5) and is refused these values — a tier that never performs
   * a code exchange has no business holding a client id or a callback URL.
   *
   * **There is deliberately no `OIDC_CLIENT_SECRET` here, and its absence is a
   * property rather than an omission.** The code exchange uses PKCE with
   * `code_challenge_method=S256` (ADR-0026 rule 4), so the client is public and
   * nothing prisme holds can mint a token at the provider. Adding a secret
   * would falsify "the human authentication path holds no secret"
   * (docs/15-runtime.md §2) and would need that claim corrected rather than
   * quietly weakened — which is a decision for a human, not a schema default.
   */
  OIDC_CLIENT_ID: { schema: nonEmpty('OIDC_CLIENT_ID'), required: ['web'] },
  /*
   * Where the provider sends the browser back. Always the absolute public URL
   * of `/auth/callback`, and never derived from a request: a redirect URI taken
   * from an incoming header is one an attacker chooses, and the provider
   * compares it exactly anyway.
   *
   * `loadConfig` additionally requires its **origin** to equal
   * `PRISME_BASE_URL`'s — see the cross-check there for why that is not merely
   * tidiness.
   */
  OIDC_REDIRECT_URI: { schema: httpUrl('OIDC_REDIRECT_URI'), required: ['web'] },
  /*
   * The two ends of the authorization-code flow, both **configuration**.
   *
   * They are given explicitly rather than discovered from the issuer's
   * `/…/openid-configuration`, which is what OIDC usually does and what this
   * deliberately does not. The discovery document is a response body from an
   * external service, and docs/14-threat-model.md §5 classifies those as
   * untrusted input: pointing a code exchange at a URL that arrived over the
   * network is the same mistake as taking the key-set URL from a request
   * header, which ADR-0021 rule 2 refuses a few lines up. Two URLs an operator
   * copies out of the provider's own console are validated at boot instead, and
   * a typo is a failed start rather than a failed login.
   *
   * Note what is *not* affected: the key set is still discovered from
   * `AUTH_ISSUER_URL` when `AUTH_JWKS_URL` is unset, through `@prisme/auth`'s
   * own allow-listed fetch. The trust anchor is untouched.
   */
  OIDC_AUTHORIZATION_ENDPOINT: {
    schema: httpUrl('OIDC_AUTHORIZATION_ENDPOINT'),
    required: ['web'],
  },
  OIDC_TOKEN_ENDPOINT: { schema: httpUrl('OIDC_TOKEN_ENDPOINT'), required: ['web'] },
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
  /*
   * The header the ID token travels in **between the two tiers** — web sets it,
   * API reads it.
   *
   * Its meaning narrowed with ADR-0026 and the default was left alone rather
   * than renamed. It used to name a header a forward-auth proxy injected on the
   * way in; the web tier now obtains the token itself and presents it upstream,
   * so nothing outside prisme writes this header any more. Renaming the default
   * would have been churn in a deployment's configuration for no gain, and the
   * API's verification is identical either way — the name was never the
   * security property.
   */
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
  OIDC_SCOPES: { schema: scopes('OIDC_SCOPES'), required: [], default: 'openid profile email' },
  /*
   * Where a logout ends the *provider's* session, and it is optional because not
   * every provider publishes one.
   *
   * Unset is a working configuration: prisme clears its own session cookie and
   * says so, which ends prisme's session completely — the cookie **is** the
   * session (there is no server-side session to leave behind,
   * docs/15-runtime.md §2). What the end-session endpoint adds is ending the
   * session at the provider too, so the next visit really does start at a login
   * form instead of silently re-authenticating against a session nobody ended.
   */
  OIDC_END_SESSION_ENDPOINT: { schema: httpUrl('OIDC_END_SESSION_ENDPOINT'), required: [] },
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
  /*
   * Read by the **web tier only**: it is the tier that paints an area's colour.
   * Not required anywhere, and the default is `{}` — an instance that pins
   * nothing gets the key-derived fallback, which is what every screen has today.
   */
  AREA_COLOR_PINS: { schema: areaColorPins(), required: [], default: '{}' },
  /*
   * The name of the property a document-tool process page carries its declared
   * duration in — the middle tier of the preference order (W13).
   *
   * **Instance data**, and in configuration for the same reason
   * `AUTH_ALLOWED_SUBJECTS` is: the document tool keys its properties by
   * whatever an instance happens to call them, and no instance's name may be
   * compiled into this repository (docs/17-privacy.md). Unset means the tier is
   * unavailable, and the backfill reports a two-tier estimate rather than
   * passing one off as three-tier.
   */
  DOCTOOL_DURATION_PROPERTY: { schema: nonEmpty('DOCTOOL_DURATION_PROPERTY'), required: [] },
  /*
   * The **API host** each connector calls — not the browser-facing host, and
   * the distinction matters: `https://api.notion.com` serves JSON and a person
   * cannot open a page at it.
   *
   * Unset is the normal case, and it means the client's own vendor default
   * (`packages/connectors`), which is where that hostname belongs — this package
   * depends on nothing but zod, so a second copy here would be a second place to
   * change. What these exist for is the case the defaults cannot cover: pointing
   * a tool at a self-hosted deployment, a proxy, or a stub. Without them,
   * driving the outward path locally means editing a constant inside the
   * connectors and remembering to revert it before committing.
   *
   * Not a credential, but it is deployment detail, so it is configuration rather
   * than anything compiled in (docs/17-privacy.md §1).
   */
  DOCTOOL_BASE_URL: { schema: httpUrl('DOCTOOL_BASE_URL'), required: [] },
  TASKTOOL_BASE_URL: { schema: httpUrl('TASKTOOL_BASE_URL'), required: [] },
  /*
   * Where a page **opens**, which is not where prisme reads it.
   *
   * `DOCTOOL_BASE_URL` above is the API host — a person cannot open a page at
   * it. This is the host their browser visits, and the two are different hosts
   * on every real deployment.
   *
   * It is a **template** rather than a base because turning a page id into a
   * link needs a path shape, and that shape is vendor knowledge this repository
   * deliberately does not hold: `packages/connectors/src/doc-tool` refuses to
   * read the page URL the tool returns on every page, because it identifies the
   * workspace ([`17-privacy.md`](../../docs/17-privacy.md) §1). So the operator
   * supplies the shape and prisme supplies the id — which keeps the workspace
   * out of git *and* keeps a second tier from learning a vendor's URL layout.
   *
   * Unset is every instance's state until somebody sets it, and it means the
   * initiative screen's *Open page* stays a disabled control that says why.
   */
  DOCTOOL_PAGE_URL_TEMPLATE: {
    schema: pageUrlTemplate('DOCTOOL_PAGE_URL_TEMPLATE'),
    required: [],
  },
  /*
   * `DOCTOOL_PAGE_URL_TEMPLATE`'s counterpart for the task tool, and for the
   * same reasons: the browser-facing host and the path shape are vendor
   * knowledge the operator supplies, and prisme supplies only the identifier.
   * It turns a mapped project into a link on the Settings screens. Unset, the
   * project is named and not linked.
   */
  TASKTOOL_PROJECT_URL_TEMPLATE: {
    schema: pageUrlTemplate('TASKTOOL_PROJECT_URL_TEMPLATE'),
    required: [],
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
