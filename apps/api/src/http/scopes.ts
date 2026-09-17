/**
 * The scope vocabulary.
 *
 * **Deny by default** (docs/14-threat-model.md §3). Every route declares one of
 * these, and a route that declares none cannot be mounted — `defineRoute`
 * refuses it at the type level and `routes.contract.test.ts` refuses it at
 * runtime, by walking what the application actually registered rather than what
 * the registry claims.
 *
 * Authorization belongs to prisme, identity to the identity provider
 * (docs/14-threat-model.md §3, *Why authorization stays in prisme*). These
 * strings are prisme's domain: a new MCP tool adds one here rather than
 * becoming an identity-provider configuration change.
 *
 * Read and write are separate scopes for the same resource, so a read-only
 * agent is genuinely read-only. There is **no wildcard**, and adding one would
 * make every bullet above decorative.
 */

export const SCOPES = {
  'read:areas': 'Areas, lanes, the year-scoped weights, and declared-versus-observed balance',
  'read:backlog': 'Initiatives, projects, their scores and their dependencies',
  'read:focus': 'The now set, the inbox, and what the week is meant to contain',
  'read:objectives': 'Objectives, key results and their measurements',
  'read:tasks': 'The task mirror — the anchor subtree prisme counts and never copies',
  'read:reviews': 'Review sessions and the event log',
  'read:kpi': 'KPI series: throughput, Run hours, Signals volume, ritual adherence',
  'read:timeline': 'The computed schedule, its dependency edges and its critical path',
  'read:adoption': 'The adoption queue and the link decisions behind it',
  'read:sync': 'Reconciliation state: cursor, conflict ledger, last run',
  'read:meta': 'The OpenAPI description and the settings prisme is running under',

  'write:initiative': 'Create and change initiatives, their status and their dependencies',
  'write:project': 'Create and change projects',
  'write:objective': 'Author objectives, key results and measurements',
  'write:review': 'Open, annotate and close review sessions',
  'write:ritual': 'Define rituals and record adherence',
  'write:takeaway': 'Promote an action takeaway into an initiative',
  'write:adoption': 'Decide an entry in the adoption queue',
  'write:sync': 'Trigger a reconciler pass',

  'admin:areas': 'Create areas and set the year weights — the yearly decision (ADR-0007)',
  'admin:settings': 'Read and change instance settings',
} as const satisfies Record<string, string>;

export type Scope = keyof typeof SCOPES;

export const SCOPE_NAMES = Object.keys(SCOPES) as readonly Scope[];

export function isScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}
