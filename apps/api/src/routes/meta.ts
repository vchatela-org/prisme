import { OpenApiDocumentDto } from '../dto/ops.js';
import { defineRoute, noQuery, type ApiRoute } from './kit.js';

/**
 * The API describing itself.
 *
 * It declares a scope like everything else. An OpenAPI document is not a
 * secret, but "everything except this one" is how deny-by-default stops being
 * true — the exception is always defensible, and there is always a next one.
 * `read:meta` costs a caller nothing and keeps the rule absolute.
 *
 * The document is built once, on first request, from the same route objects the
 * router mounted. It cannot describe a route that is not mounted, and it cannot
 * miss one that is.
 */
export function metaRoutes(document: () => Record<string, unknown>): readonly ApiRoute[] {
  return [
    defineRoute({
      operationId: 'getOpenApiDocument',
      method: 'get',
      path: '/openapi.json',
      scope: 'read:meta',
      summary: 'The OpenAPI description of this API',
      query: noQuery,
      response: OpenApiDocumentDto,
      handle: () => Promise.resolve(document()),
    }),
  ];
}
