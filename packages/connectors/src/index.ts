/**
 * `@prisme/connectors` — everything prisme knows about the outside world
 * arrives through here.
 *
 * The **read path** (W03). Wire formats in, typed records out; no decisions, no
 * scores, no writes. The write path, idempotency keys and the reconciler are
 * W04's, and their absence from this file is deliberate.
 *
 * Four rules hold everywhere below, and each has a module that enforces it
 * rather than a comment that asks for it:
 *
 * | Rule | Where it lives |
 * |---|---|
 * | Responses are untrusted input, parsed before anything else sees them | `parse.ts` |
 * | External stores are addressed by role key, never by name or ID | `role-key.ts` |
 * | Never guess a mapping — an unexpected shape fails the run | each tool's `wire.ts` and `map.ts` |
 * | Third-party text is allow-listed; its URLs are collected, never fetched | `sanitise.ts` |
 *
 * And one trap, which has a module to itself because it is the one failure mode
 * that looks like success: change timestamps round **down** to the minute, so
 * `>= last_run` silently loses same-minute edits — `watermark.ts`.
 */

export {
  ConnectorError,
  EXTERNAL_TOOLS,
  isConnectorError,
  type ConnectorErrorInit,
  type ConnectorFailure,
  type ExternalTool,
} from './errors.js';

export {
  assertCreatable,
  assertReadable,
  canCreate,
  createRoleBindings,
  isReadable,
  isTemplateRole,
  PAGE_ROLE_FOR,
  PAGE_ROLES,
  PAGE_TEMPLATE_FOR,
  ROLE_ACCESS,
  ROLE_SHAPE,
  ROLE_KEYS,
  roleBindingSchema,
  roleBindingsSchema,
  roleKeySchema,
  TEMPLATE_ROLES,
  type PageKind,
  type RoleAccess,
  type StoreShape,
  type RoleBinding,
  type RoleBindings,
  type RoleKey,
} from './role-key.js';

export {
  formatIssuePath,
  parseJsonOrThrow,
  parseOrThrow,
  redactPathSegment,
  type ParseContext,
} from './parse.js';

export { contentHash } from './hash.js';

export {
  nextWatermark,
  suppressUnchanged,
  watermarkFloor,
  WATERMARK_OVERLAP_SECONDS,
  type ChangeSet,
  type Hashable,
} from './watermark.js';

export {
  ALLOWED_MARKS,
  collectUrls,
  EMPTY_TEXT,
  isFetchAllowed,
  safeUrl,
  sanitisePlainText,
  sanitiseRichText,
  type FetchPolicy,
  type Mark,
  type RichTextRun,
  type SanitisedText,
  type TextSegment,
} from './sanitise.js';

export { noopMetrics, type ConnectorMetrics, type ExternalRequestSample } from './metrics.js';

export {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  retryAfterMs,
  type RetryPolicy,
} from './http/backoff.js';

export {
  createFetchTransport,
  createRefusingTransport,
  DEFAULT_TIMEOUT_MS,
  type FetchTransportOptions,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from './http/transport.js';

export { executeJson, type RequestOptions } from './http/request.js';

export {
  createTaskToolClient,
  DEFAULT_TASK_TOOL_BASE_URL,
  type TaskToolClientOptions,
} from './task-tool/client.js';

export { collectSubtree, indexByParent, rootsOf } from './task-tool/tree.js';

export type {
  Completion,
  ExternalDue,
  ExternalDuration,
  ExternalLabel,
  ExternalProject,
  ExternalSection,
  ExternalTask,
  ExternalTaskId,
  SyncResult,
  TaskChange,
  TaskLocations,
  TaskSnapshot,
  TaskToolClient,
} from './task-tool/types.js';

export {
  createDocToolClient,
  DEFAULT_DOC_TOOL_API_VERSION,
  DEFAULT_DOC_TOOL_BASE_URL,
  type DocToolClientOptions,
} from './doc-tool/client.js';

export { TEXT_BLOCK_TYPES } from './doc-tool/map.js';

export type {
  DocBlock,
  DocPage,
  DocPropertyValue,
  DocRecord,
  DocStoreDescription,
  DocToolClient,
} from './doc-tool/types.js';
