import { z } from 'zod';
import {
  AreaPagesDto,
  BindingDto,
  BindingListDto,
  checkBindingsBody,
  putAreaPropertyBody,
  putBindingBody,
  putDatePropertyBody,
  roleKey,
  TaskLocationsDto,
} from '../dto/settings.js';
import { defineRoute, noQuery, type ApiRoute } from './kit.js';

/**
 * What the Settings screens read and change that is not an area.
 *
 * The role bindings are set here and only here (docs/15-runtime.md §2), with a
 * check that reads the store's title so a binding says what it points at. Every
 * binding route is `admin:settings` — a binding is an identifier from a real
 * workspace. The two lists an area is configured from — the task tool's
 * locations and the Life areas store's pages — are `admin:areas`, like the area
 * writes they serve.
 */
export const settingsRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listBindings',
    method: 'get',
    path: '/bindings',
    scope: 'admin:settings',
    summary: 'Every document-tool role, what it is bound to, and what the last check found',
    description:
      'One item per role key, bound or not — an unbound role is a gap a screen must be able to show. `title` and `linkId` come from the last check; `checkError` is a connector failure kind, never an upstream message.',
    query: noQuery,
    response: BindingListDto,
    handle: (_context, services) => services.settings.listBindings(),
  }),

  defineRoute({
    operationId: 'putBinding',
    method: 'put',
    path: '/bindings/:role',
    scope: 'admin:settings',
    summary: 'Bind a role to a store, or unbind it',
    description:
      'Accepts an identifier or a copied link. The store is checked as it is saved: a database given where a data source is wanted is resolved to the one data source inside it. A failed check still saves the binding, with the failure recorded — sharing the store with the integration may simply not have happened yet. `externalId: null` unbinds.',
    params: z.strictObject({ role: roleKey }),
    body: putBindingBody,
    status: 200,
    response: BindingDto,
    handle: (context, services) =>
      services.settings.putBinding(context.params.role, context.body.externalId, context.now),
  }),

  defineRoute({
    operationId: 'putBindingDateProperty',
    method: 'put',
    path: '/bindings/:role/date-property',
    scope: 'admin:settings',
    summary: 'Choose which date property says when a store’s entries run',
    description:
      "Optional, and for a store prisme reads. The adoption queue dates each candidate from this store with the property's period and hides one whose period has ended. The name must be one of the binding's `dateProperties` from its last check — chosen, never typed; `null` clears it.",
    params: z.strictObject({ role: roleKey }),
    body: putDatePropertyBody,
    status: 200,
    response: BindingDto,
    handle: (context, services) =>
      services.settings.setDateProperty(context.params.role, context.body.property),
  }),

  defineRoute({
    operationId: 'putBindingAreaProperty',
    method: 'put',
    path: '/bindings/:role/area-property',
    scope: 'admin:settings',
    summary: 'Choose which relation property says which area a store’s entries belong to',
    description:
      "Optional, and for a store prisme reads (ADR-0033). The adoption scan gives each entry the area whose own page — `externalPageId` on the area — is the one page this property relates it to; none, several or an unknown page is no area. The name must be one of the binding's `relationProperties` from its last check — chosen, never typed; `null` clears it.",
    params: z.strictObject({ role: roleKey }),
    body: putAreaPropertyBody,
    status: 200,
    response: BindingDto,
    handle: (context, services) =>
      services.settings.setAreaProperty(context.params.role, context.body.property),
  }),

  defineRoute({
    operationId: 'checkBindings',
    method: 'post',
    path: '/bindings/check',
    scope: 'admin:settings',
    summary: 'Re-read the title of every bound store',
    description:
      'Reads metadata only — a title, and what a person opens — and never a row or a page body. Never rewrites an identifier.',
    body: checkBindingsBody,
    status: 200,
    response: BindingListDto,
    handle: (context, services) => services.settings.checkBindings(context.now),
  }),

  defineRoute({
    operationId: 'listTaskLocations',
    method: 'get',
    path: '/task-tool/locations',
    scope: 'admin:areas',
    summary: 'The task tool’s projects and sections, by name',
    description:
      'What an area mapping is chosen from. Read live from the task tool — projects and sections only, never a task. When the tool cannot be read the list is empty and `failure` says why, so a screen can still show every mapping by identifier.',
    query: noQuery,
    response: TaskLocationsDto,
    handle: (_context, services) => services.settings.taskLocations(),
  }),

  defineRoute({
    operationId: 'listAreaPages',
    method: 'get',
    path: '/document-tool/area-pages',
    scope: 'admin:areas',
    summary: 'The Life areas store’s entries, by title',
    description:
      'What an area’s own page is picked from (ADR-0033): the entries of the store bound to `areas_db`, each as an identifier and a title and nothing else of the page. Read live. `bound: false` when no store is bound to that role; when it cannot be read the list is empty and `failure` says why, so a screen can still show the page an area already has.',
    query: noQuery,
    response: AreaPagesDto,
    handle: (_context, services) => services.settings.areaPages(),
  }),
];
