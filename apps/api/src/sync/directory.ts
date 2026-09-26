import {
  createDocToolClient,
  createFetchTransport,
  createRoleBindings,
  createTaskToolClient,
  type DocStoreDescription,
  type StoreShape,
  type TaskLocations,
} from '@prisme/connectors';

/**
 * The two reads a Settings screen makes of the outside world, as a port.
 *
 * Neither is part of a pass. Listing the task tool's projects so a person can
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
  };
}
