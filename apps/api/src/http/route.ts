import type { z } from 'zod';
import type { Identity } from './authorize.js';
import type { NamedSchema, WriteSchema } from './schema.js';
import { parseOrThrow, parseWriteBody } from './schema.js';
import type { Scope } from './scopes.js';

/**
 * One route, declared once.
 *
 * A route is data before it is behaviour: method, path, **scope**, the schemas
 * on either side, and a handler. Three things read that declaration and they
 * must not be able to disagree —
 *
 *   1. the router, which mounts it;
 *   2. the OpenAPI document, which describes it;
 *   3. the contract test, which refuses a route with no scope.
 *
 * Generating all three from one object is what keeps "every route declares a
 * required scope" (docs/14-threat-model.md §3) true as routes multiply, rather
 * than true on the day it was written. `scope` is not optional and has no
 * default: a route that forgets it does not compile.
 */

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface RouteContext<P, Q, B> {
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly identity: Identity;
  /** Injected, never `new Date()` inside a handler — the domain is scored against it. */
  readonly now: Date;
  readonly correlationId: string;
}

export interface RouteDefinition<P, Q, B, R, Deps> {
  /** Unique, and the OpenAPI `operationId`. Lower camel case, verb first. */
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Hono style, `/areas/:key`. Rewritten to `{key}` for OpenAPI. */
  readonly path: string;
  /** **Required.** There is no ambient authority, including for the single user. */
  readonly scope: Scope;
  readonly summary: string;
  readonly description?: string;
  readonly params?: z.ZodType<P>;
  readonly query?: z.ZodType<Q>;
  readonly body?: WriteSchema<B>;
  readonly response: NamedSchema<R>;
  /** Defaults to 200, or 201 on a `post` that creates. */
  readonly status?: number;
  handle(context: RouteContext<P, Q, B>, deps: Deps): Promise<R>;
}

export interface RawInput {
  readonly params: Record<string, string>;
  readonly query: Record<string, string | readonly string[]>;
  readonly body: unknown;
  readonly identity: Identity;
  readonly now: Date;
  readonly correlationId: string;
}

/**
 * A route with its generics erased, which is what a heterogeneous registry can
 * hold. The cast is contained to {@link defineRoute}: everything outside it
 * sees either the typed definition or this.
 */
export interface Route<Deps> {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly scope: Scope;
  readonly summary: string;
  readonly description: string | undefined;
  readonly status: number;
  readonly params: z.ZodType | undefined;
  readonly query: z.ZodType | undefined;
  readonly body: WriteSchema<unknown> | undefined;
  readonly response: NamedSchema<unknown>;
  invoke(input: RawInput, deps: Deps): Promise<unknown>;
}

function defaultStatus(method: HttpMethod, declared: number | undefined): number {
  if (declared !== undefined) return declared;
  return method === 'post' ? 201 : 200;
}

/**
 * Binds the dependency type once, so a route module can write its handler
 * without annotating it.
 *
 * `Deps` appears only in `handle`'s second parameter, and TypeScript cannot
 * infer a type parameter from a position it is also inferring the function's
 * own parameters in — the result is `unknown`, and every `services.…` in every
 * route becomes an error. Fixing `Deps` up front is what lets the route modules
 * read as declarations.
 */
export function defineRouteFor<Deps>() {
  return function bound<P, Q, B, R>(definition: RouteDefinition<P, Q, B, R, Deps>): Route<Deps> {
    return defineRoute(definition);
  };
}

export function defineRoute<P, Q, B, R, Deps>(
  definition: RouteDefinition<P, Q, B, R, Deps>,
): Route<Deps> {
  return {
    operationId: definition.operationId,
    method: definition.method,
    path: definition.path,
    scope: definition.scope,
    summary: definition.summary,
    description: definition.description,
    status: defaultStatus(definition.method, definition.status),
    params: definition.params,
    query: definition.query,
    body: definition.body,
    response: definition.response,

    async invoke(input: RawInput, deps: Deps): Promise<unknown> {
      // Order is deliberate: path, then query, then body. A malformed path
      // should not be reported as a body problem, and the body is the only one
      // of the three that can carry a field somebody else owns.
      const params = (
        definition.params === undefined ? {} : parseOrThrow(definition.params, input.params, 'path')
      ) as P;

      const query = (
        definition.query === undefined ? {} : parseOrThrow(definition.query, input.query, 'query')
      ) as Q;

      const body = (
        definition.body === undefined ? undefined : parseWriteBody(definition.body, input.body)
      ) as B;

      return definition.handle(
        {
          params,
          query,
          body,
          identity: input.identity,
          now: input.now,
          correlationId: input.correlationId,
        },
        deps,
      );
    },
  };
}
