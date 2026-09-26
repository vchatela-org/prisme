import { z } from 'zod';
import {
  BindingDto,
  BindingListDto,
  checkBindingsBody,
  putBindingBody,
  roleKey,
  TaskLocationsDto,
} from '../dto/settings.js';
import { defineRoute, noQuery, type ApiRoute } from './kit.js';

/**
 * What the Settings screens read and change that is not an area.
 *
 * The bindings used to be loadable only from `seed/bindings.json` by a CLI Job
 * (docs/15-runtime.md §2). The file still works; these are the same table from
 * a screen, with a check that reads the store's title so a binding says what it
 * points at. All three are `admin:settings` — a binding is an identifier from a
 * real workspace.
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
];
