import { z } from 'zod';
import type { Route } from './route.js';
import { SCOPES } from './scopes.js';

/**
 * The OpenAPI document, **generated from the schemas** (W05 brief §6).
 *
 * Written by hand, an API description is a second source of truth that starts
 * accurate and ends decorative — and the people it misleads are the ones
 * furthest from the code: the typed client, the MCP tools, an agent deciding
 * which field to send. Generated from the same objects the router and the
 * validator use, it cannot drift without the route drifting with it.
 *
 * Two things this document says that a generated description usually does not:
 *
 *   - **`x-required-scope` on every operation.** Deny by default is part of the
 *     contract, not an implementation detail, and a caller should be able to
 *     read which scope a token needs without trying it.
 *   - **A single error shape**, referenced by every non-2xx response, because
 *     there is only one (see `errors.ts`).
 */

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description: string;
}

const ERROR_SCHEMA_NAME = 'Error';

const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
  correlationId: z.string(),
  fields: z.array(z.object({ field: z.string(), reason: z.string() })).optional(),
});

/** `/areas/:key` → `/areas/{key}`. Hono's syntax is not OpenAPI's. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

interface JsonSchemaObject {
  readonly type?: string;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '$id')
        .map(([key, entry]) => [key, stripIds(entry)]),
    );
  }
  return value;
}

function parameterize(
  schema: z.ZodType,
  location: 'path' | 'query',
): readonly Record<string, unknown>[] {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchemaObject;

  const properties = json.properties ?? {};
  const required = new Set(json.required ?? []);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    // A path parameter is required by definition; a query parameter says so.
    required: location === 'path' ? true : required.has(name),
    schema: stripIds(propertySchema),
  }));
}

/**
 * Every named schema a route mentions, keyed by name.
 *
 * A name registered twice with two different schemas is a bug that would
 * otherwise show up as one of the two silently winning, so it throws.
 */
function collectSchemas<Deps>(routes: readonly Route<Deps>[]): Map<string, z.ZodType> {
  const byName = new Map<string, z.ZodType>();

  function add(name: string, schema: z.ZodType): void {
    const existing = byName.get(name);
    if (existing !== undefined && existing !== schema) {
      throw new Error(`two different schemas are both named "${name}" in the OpenAPI document`);
    }
    byName.set(name, schema);
  }

  add(ERROR_SCHEMA_NAME, errorSchema);
  for (const route of routes) {
    add(route.response.name, route.response.schema);
    if (route.body !== undefined) add(route.body.name, route.body.schema);
  }
  return byName;
}

const ERROR_RESPONSES: Readonly<Record<string, string>> = {
  '400':
    'The request did not parse, named an unknown field, or named a field this endpoint does not own',
  '401': 'No verified identity or valid token was presented',
  '403': 'The credential does not hold the required scope',
  '404': 'No such entity',
  '500': 'The request could not be completed. The correlation ID identifies the log line',
};

export function buildOpenApiDocument<Deps>(
  routes: readonly Route<Deps>[],
  info: OpenApiInfo,
  basePath: string,
): Record<string, unknown> {
  const byName = collectSchemas(routes);

  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of byName) registry.add(schema, { id: name });

  const generated = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    io: 'output',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });

  const schemas = Object.fromEntries(
    Object.entries(generated.schemas).map(([name, schema]) => [name, stripIds(schema)]),
  );

  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const path = `${basePath}${toOpenApiPath(route.path)}`;
    const operations = (paths[path] ??= {});

    const parameters = [
      ...(route.params === undefined ? [] : parameterize(route.params, 'path')),
      ...(route.query === undefined ? [] : parameterize(route.query, 'query')),
    ];

    operations[route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      ...(route.description === undefined ? {} : { description: route.description }),
      'x-required-scope': route.scope,
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(route.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${route.body.name}` },
                },
              },
            },
          }),
      responses: {
        [String(route.status)]: {
          description: route.summary,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${route.response.name}` },
            },
          },
        },
        ...Object.fromEntries(
          Object.entries(ERROR_RESPONSES).map(([status, description]) => [
            status,
            {
              description,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${ERROR_SCHEMA_NAME}` },
                },
              },
            },
          ]),
        ),
      },
    };
  }

  return {
    openapi: '3.0.3',
    info,
    paths,
    components: {
      schemas,
      securitySchemes: {
        // Humans: the identity provider's signed assertion, verified rather
        // than trusted (ADR-0021). The header name is configurable; the default
        // is the one in packages/config.
        forwardAuthAssertion: {
          type: 'apiKey',
          in: 'header',
          name: 'X-authentik-jwt',
          description:
            'The identity provider assertion, forwarded by the gateway and verified on every request (ADR-0021). Plaintext identity headers are never a fallback.',
        },
        // Agents, MCP clients and scripts: a prisme-issued scoped token.
        prismeToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A prisme-issued scoped token. Presenting both this and an assertion is rejected rather than resolved by precedence.',
        },
      },
    },
    security: [{ prismeToken: [] }, { forwardAuthAssertion: [] }],
    'x-scopes': SCOPES,
  };
}
