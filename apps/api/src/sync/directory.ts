import {
  createDocToolClient,
  createFetchTransport,
  createRoleBindings,
  createTaskToolClient,
  type DocStoreDescription,
  type DocTemplate,
  type RoleKey,
  type StoreShape,
  type TaskLocations,
} from '@prisme/connectors';

/**
 * The reads a screen makes of the outside world, as a port.
 *
 * None is part of a pass. Listing the task tool's projects so a person can
 * pick one for an area, and reading a store's title so a binding says what it
 * points at, are questions a screen asks — so they do not take the reconciler's
 * lock, write no state of the reconciler's, and are made from this process
 * rather than a Job.
 *
 * Declared as a port for the reason `port.ts` gives for `POST /sync`: the route,
 * the service and their tests stay free of a network client, and a test can
 * state what the tool answered without a transport.
 */
export interface ExternalDirectory {
  /** Every project and section, archived ones marked. Reads no task. */
  taskLocations(): Promise<TaskLocations>;
  /**
   * What an identifier names — before it is bound, which is why it takes an
   * identifier and not a role. Throws a `ConnectorError` the caller reduces to
   * its failure kind: the message can carry the identifier.
   */
  describe(externalId: string, shape: StoreShape): Promise<DocStoreDescription>;
  /**
   * The templates a page store's database holds (ADR-0030) — for the Settings
   * check, and for the screen that asks for a page. Takes the identifier the
   * caller already holds, for the same reason `describe` does; throws a
   * `ConnectorError` reduced to its failure kind by the caller.
   */
  templates(role: RoleKey, externalId: string): Promise<readonly DocTemplate[]>;
}

export interface ExternalDirectoryOptions {
  readonly docToolToken: string;
  readonly docToolBaseUrl: string | undefined;
  readonly taskToolToken: string;
  readonly taskToolBaseUrl: string | undefined;
}

export function createExternalDirectory(options: ExternalDirectoryOptions): ExternalDirectory {
  return {
    taskLocations() {
      return createTaskToolClient({
        token: options.taskToolToken,
        baseUrl: options.taskToolBaseUrl,
        transport: createFetchTransport(),
      }).fetchLocations();
    },

    describe(externalId, shape) {
      // No bindings: `describe` addresses the identifier it is given, and a
      // client that could resolve a role here would be one a later edit could
      // make read a store's rows from a Settings screen.
      return createDocToolClient({
        token: options.docToolToken,
        baseUrl: options.docToolBaseUrl,
        bindings: createRoleBindings([]),
        transport: createFetchTransport(),
      }).describe(externalId, shape);
    },

    templates(role, externalId) {
      // Exactly one role bound, and it is a page store: the client refuses to
      // list templates on anything that is not (`assertCreatable`), and a
      // client holding only a creating role cannot read a store's rows either —
      // `queryByRole` refuses it. So this door opens on template names only.
      return createDocToolClient({
        token: options.docToolToken,
        baseUrl: options.docToolBaseUrl,
        bindings: createRoleBindings([{ role, externalId }]),
        transport: createFetchTransport(),
      }).listTemplates(role);
    },
  };
}
