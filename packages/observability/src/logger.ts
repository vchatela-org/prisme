import { currentRunContext } from './run-context.js';
import { redact, type RedactOptions } from './redact.js';

/**
 * Structured JSON logging, one event per line, on stdout.
 *
 * Deliberately small and dependency-free. The one behaviour that must not be
 * negotiable is redaction (docs/15-runtime.md §5), and owning the serializer is
 * the cheapest way to guarantee it — a logging library's redaction is a
 * configuration option somebody can turn off.
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line it writes. */
  child(fields: LogFields): Logger;
  readonly level: LogLevel;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** `prisme-api`, `prisme-sync`, `prisme-web`, `prisme-migrate`. */
  readonly service: string;
  readonly redaction?: RedactOptions;
  /** Injected for tests. Defaults to a single line on stdout. */
  readonly write?: (line: string) => void;
  /** Injected for tests. `packages/domain` bans ambient time; this is not domain code, but the habit is cheap. */
  readonly now?: () => Date;
}

function defaultWrite(line: string): void {
  process.stdout.write(line + '\n');
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const redaction = options.redaction ?? {};

  function build(bindings: LogFields, loggerLevel: LogLevel): Logger {
    const threshold = SEVERITY[loggerLevel];

    const emit = (entry: LogLevel, message: string, fields?: LogFields): void => {
      if (SEVERITY[entry] < threshold) return;

      const run = currentRunContext();
      const record: LogFields = {
        time: now().toISOString(),
        level: entry,
        service: options.service,
        msg: message,
        ...(run === undefined
          ? {}
          : { runId: run.runId, ...(run.source ? { source: run.source } : {}) }),
        ...bindings,
        ...(fields ?? {}),
      };

      let line: string;
      try {
        line = JSON.stringify(redact(record, redaction));
      } catch {
        // A value that cannot be serialized must not silence the event.
        line = JSON.stringify({
          time: now().toISOString(),
          level: entry,
          service: options.service,
          msg: message,
          serializationError: true,
        });
      }
      write(line);
    };

    const logger: Logger = {
      level: loggerLevel,
      trace: (message, fields) => emit('trace', message, fields),
      debug: (message, fields) => emit('debug', message, fields),
      info: (message, fields) => emit('info', message, fields),
      warn: (message, fields) => emit('warn', message, fields),
      error: (message, fields) => emit('error', message, fields),
      fatal: (message, fields) => emit('fatal', message, fields),
      child: (fields) => build({ ...bindings, ...fields }, loggerLevel),
    };
    return logger;
  }

  return build({}, level);
}
