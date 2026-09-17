import { z } from 'zod';
import { areaKey, calendarDate, entityId, pagination, year } from '../dto/common.js';
import { defineRouteFor, type Route } from '../http/route.js';
import type { Services } from '../services/index.js';

/**
 * The pieces every route module shares.
 *
 * `ApiRoute` binds the route kit to the service layer once, so a route module
 * never reaches past the services into the store. That is not tidiness: the
 * services are what W06's MCP tools will call, and a route that talks to the
 * store directly is a rule the MCP surface will not have.
 */

export type ApiRoute = Route<Services>;

/** `defineRoute`, with the service layer as its dependency type. */
export const defineRoute = defineRouteFor<Services>();

export const idParam = z.strictObject({ id: entityId });
export const keyParam = z.strictObject({ key: areaKey });

export const pageQuery = z.strictObject({ ...pagination });

export const noQuery = z.strictObject({});

export const yearQuery = z.strictObject({ year: z.coerce.number().pipe(year).optional() });

export const rangeQuery = z.strictObject({
  from: calendarDate,
  to: calendarDate,
});

/**
 * The year a request means when it does not say.
 *
 * Deliberately a function of the *request's* clock rather than a constant: a
 * weight always requires a year (ADR-0007), and defaulting to "the year this
 * request is happening in" is the only default that is not a guess about which
 * year somebody meant.
 */
export function yearOr(now: Date, requested: number | undefined): number {
  return requested ?? now.getUTCFullYear();
}
