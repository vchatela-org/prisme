import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, API_INFO, createRoutes } from '../routes/index.js';
import { buildOpenApiDocument, toOpenApiPath } from './openapi.js';

/**
 * The OpenAPI document is generated, so what is worth testing is not its
 * content — that is the schemas' business — but the properties a *generated*
 * document can still get wrong: a reference that points at nothing, an
 * operation that forgot to say which scope it needs, a path that kept Hono's
 * syntax instead of OpenAPI's.
 *
 * "OpenAPI generates and validates" is the definition of done. Validating it
 * against the full JSON-Schema meta-schema would mean a validator dependency
 * whose failures are hard to read; these assertions check the things that
 * actually break a client, and they name what broke.
 */

const document = buildOpenApiDocument(createRoutes(), API_INFO, API_BASE_PATH);

interface Operation {
  operationId: string;
  'x-required-scope': string;
  responses: Record<string, { content?: { 'application/json': { schema: unknown } } }>;
  requestBody?: { content: { 'application/json': { schema: { $ref: string } } } };
  parameters?: { name: string; in: string; required: boolean; schema: unknown }[];
}

const paths = document['paths'] as Record<string, Record<string, Operation>>;
const components = document['components'] as { schemas: Record<string, unknown> };

/** Every `$ref` anywhere in the document, however deeply nested. */
function refsOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) refsOf(entry, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$ref' && typeof entry === 'string') found.push(entry);
      else refsOf(entry, found);
    }
  }
  return found;
}

describe('the generated OpenAPI document', () => {
  it('generates without throwing on any schema in the API', () => {
    expect(document['openapi']).toBe('3.0.3');
    expect(Object.keys(paths).length).toBeGreaterThan(20);
  });

  it('resolves every $ref against components.schemas', () => {
    for (const ref of refsOf(document)) {
      expect(ref.startsWith('#/components/schemas/'), `${ref} is not a components ref`).toBe(true);
      const name = ref.slice('#/components/schemas/'.length);
      expect(components.schemas, `${ref} points at nothing`).toHaveProperty(name);
    }
  });

  it('carries no $id, which OpenAPI 3.0 has no use for', () => {
    expect(JSON.stringify(document)).not.toContain('"$id"');
  });

  it('declares the required scope on every operation', () => {
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(
          operation['x-required-scope'],
          `${method.toUpperCase()} ${path} does not say which scope it needs`,
        ).toBeTruthy();
      }
    }
  });

  it('describes a success and the error shape for every operation', () => {
    for (const operations of Object.values(paths)) {
      for (const operation of Object.values(operations)) {
        const statuses = Object.keys(operation.responses);
        expect(statuses.some((status) => status.startsWith('2'))).toBe(true);
        for (const status of ['400', '401', '403', '500']) {
          expect(statuses, `${operation.operationId} omits ${status}`).toContain(status);
        }
      }
    }
  });

  it('rewrites path parameters into OpenAPI syntax and declares each one', () => {
    for (const [path, operations] of Object.entries(paths)) {
      expect(path).not.toContain(':');
      const templated = [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]);
      for (const operation of Object.values(operations)) {
        for (const name of templated) {
          const declared = (operation.parameters ?? []).find(
            (parameter) => parameter.name === name && parameter.in === 'path',
          );
          expect(declared, `${path} does not declare ${String(name)}`).toBeDefined();
          expect(declared?.required).toBe(true);
        }
      }
    }
  });

  it('offers both credentials and prefers neither', () => {
    const security = document['security'] as Record<string, unknown>[];
    expect(security.map((entry) => Object.keys(entry)[0])).toEqual([
      'prismeToken',
      'forwardAuthAssertion',
    ]);
  });

  it('turns a Hono path into an OpenAPI one', () => {
    expect(toOpenApiPath('/areas/:key/weights/:year')).toBe('/areas/{key}/weights/{year}');
    expect(toOpenApiPath('/focus')).toBe('/focus');
  });
});
