import { readFileSync } from 'node:fs';

/**
 * Where a setting can come from, and which one wins.
 *
 * docs/15-runtime.md §2 records the target cluster as injecting secrets with a
 * Vault agent init container that renders a template to a *file* in the pod.
 * There are therefore no per-key Kubernetes Secrets to read from the
 * environment, and the rendered file is the primary path — not a fallback.
 *
 * Precedence, highest first:
 *
 *   1. plain environment            `DATABASE_URL=…`
 *   2. per-secret file              `DATABASE_URL_FILE=/run/secrets/database-url`
 *   3. rendered env file            `PRISME_ENV_FILE=/vault/secrets/prisme.env`
 *
 * Plain environment on top is what lets a single value be overridden without
 * re-rendering the whole template.
 */

export type RawEnv = Record<string, string>;

export interface SourceOptions {
  /** Defaults to `process.env`. Injected in tests. */
  readonly env?: Record<string, string | undefined>;
  /** Defaults to reading from disk. Injected in tests. */
  readonly readFile?: (path: string) => string;
}

export class ConfigSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigSourceError';
  }
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse a rendered `KEY=value` file.
 *
 * Accepts what a Vault agent template realistically emits: bare values, single-
 * or double-quoted values, `export ` prefixes, `#` comments and blank lines. A
 * line that is none of those is an error rather than a skip — silently ignoring
 * a malformed line is how a required secret ends up missing at 3am.
 */
export function parseEnvFile(contents: string, label = 'env file'): RawEnv {
  const out: RawEnv = {};
  const lines = contents.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) {
      throw new ConfigSourceError(`${label}: line ${index + 1} is not KEY=value`);
    }

    const key = withoutExport.slice(0, eq).trim();
    if (!KEY.test(key)) {
      throw new ConfigSourceError(`${label}: line ${index + 1} has an invalid key name`);
    }

    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      // An unquoted trailing comment is a real convention in rendered files.
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }

    out[key] = value;
  }

  return out;
}

/**
 * Collapse the three input paths into one flat record, highest precedence last.
 *
 * The error messages here never contain a value — only a variable name and a
 * path, both of which are already public (docs/15-runtime.md §2: "Names are
 * public; values never are").
 */
export function collectEnv(options: SourceOptions = {}): RawEnv {
  const env = options.env ?? process.env;
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  const merged: RawEnv = {};

  // 3. The rendered env file, lowest precedence.
  const envFilePath = env['PRISME_ENV_FILE'];
  if (envFilePath !== undefined && envFilePath !== '') {
    let contents: string;
    try {
      contents = read(envFilePath);
    } catch (cause) {
      throw new ConfigSourceError(
        `PRISME_ENV_FILE points at ${envFilePath}, which could not be read. ` +
          'In the target cluster this file is rendered by the Vault agent init container; ' +
          'if the init container has not completed, the application must fail rather than start without its secrets.',
        { cause },
      );
    }
    Object.assign(merged, parseEnvFile(contents, `PRISME_ENV_FILE (${envFilePath})`));
  }

  // 2. Per-secret files.
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_FILE') || key === 'PRISME_ENV_FILE') continue;
    if (value === undefined || value === '') continue;
    const target = key.slice(0, -'_FILE'.length);
    if (target === '') continue;
    let contents: string;
    try {
      contents = read(value);
    } catch (cause) {
      throw new ConfigSourceError(`${key} points at ${value}, which could not be read.`, {
        cause,
      });
    }
    // A file holding a single secret usually ends with a newline. Strip it, or
    // every token comparison fails for a reason nobody can see in a log.
    merged[target] = contents.replace(/\r?\n$/, '');
  }

  // 1. Plain environment, highest precedence.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.endsWith('_FILE')) continue;
    merged[key] = value;
  }

  return merged;
}
