import type { Context, Hono } from 'hono';
import type { Logger } from '@prisme/observability';
import type { Authorizer } from './authorize.js';
import { forbidden, holdsScope } from './authorize.js';
import { ApiError, internalErrorBody } from './errors.js';
import type { RawInput, Route } from './route.js';

/**
 * Mounting: the one place a declared route becomes a reachable one.
 *
 * Every request goes through the same four steps in the same order —
 * authorize, check the scope, parse, answer — and the fourth of those is worth
 * saying out loud: **the response is parsed too**.
 *
 * ### Why the response is validated on the way out
 *
 * "Return DTOs, never database rows" (apps/api/CLAUDE.md §3) is a rule that
 * decays quietly. Nobody writes `return row`; someone adds a column, a select
 * grows a `*`, a spread carries a field along, and an internal value is public
 * API from then on — visible to a reviewer only as an absence.
 *
 * What is serialized is the schema's **output**, not the handler's return
 * value, so a field the contract does not describe cannot reach the caller even
 * if a handler produces one. A field the contract *does* describe and the
 * handler got wrong is the other half: that fails the parse and becomes a 500,
 * because answering with a response the OpenAPI document does not describe is
 * worse than not answering.
 */

export interface MountOptions<Deps> {
  readonly authorizer: Authorizer;
  readonly deps: Deps;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** Hono gives repeated parameters as arrays; a single value stays a string. */
function queryOf(c: Context): Record<string, string | readonly string[]> {
  const entries = Object.entries(c.req.queries());
  return Object.fromEntries(
    entries.map(([key, values]) => [key, values.length === 1 ? (values[0] as string) : values]),
  );
}

async function bodyOf(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError('invalid_request', 'the request body is not valid JSON');
  }
}

export function mountRoutes<Deps>(
  app: Hono,
  routes: readonly Route<Deps>[],
  options: MountOptions<Deps>,
): void {
  for (const route of routes) {
    app[route.method](route.path, async (c: Context) => {
      const correlationId = c.res.headers.get('x-request-id') ?? c.req.header('x-request-id') ?? '';

      try {
        const decision = await options.authorizer.authorize({
          scope: route.scope,
          method: route.method.toUpperCase(),
          path: route.path,
          stateChanging: route.method !== 'get',
          header: (name: string) => c.req.header(name),
        });

        if (!decision.ok) throw decision.error;
        if (!holdsScope(decision.identity, route.scope)) throw forbidden(route.scope);

        const input: RawInput = {
          params: c.req.param(),
          query: queryOf(c),
          body: route.body === undefined ? undefined : await bodyOf(c),
          identity: decision.identity,
          now: options.now(),
          correlationId,
        };

        const result = await route.invoke(input, options.deps);

        const checked = route.response.schema.safeParse(result);
        if (!checked.success) {
          // Not a caller error: the handler returned something the contract
          // cannot describe, which means the OpenAPI document is lying.
          options.logger.error('a handler returned a value its response schema refused', {
            operationId: route.operationId,
            issues: checked.error.issues.map((issue) => issue.path.join('.')),
          });
          throw new ApiError('internal_error', 'the request could not be completed');
        }

        return c.json(checked.data as Record<string, unknown>, route.status as 200);
      } catch (error) {
        if (error instanceof ApiError) {
          // Client errors are expected traffic; a 500 that arrived as an
          // ApiError still deserves the log line that explains it.
          if (error.status >= 500) {
            options.logger.error('request failed', { operationId: route.operationId, error });
          }
          // Written at the throw site, never assembled from request data (W14).
          for (const [name, value] of Object.entries(error.headers ?? {})) {
            c.header(name, value);
          }
          return c.json(error.body(correlationId), error.status as 400);
        }

        options.logger.error('unhandled route error', {
          operationId: route.operationId,
          error,
        });
        return c.json(internalErrorBody(correlationId), 500);
      }
    });
  }
}
