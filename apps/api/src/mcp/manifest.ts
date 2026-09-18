import { z } from 'zod';
import type { Scope } from '../http/scopes.js';
import type { McpTool } from './tool.js';

/**
 * The machine-readable tool manifest — W06's contract, item 3.
 *
 * Generated from the same objects the dispatcher calls, exactly as the OpenAPI
 * document is generated from the same objects the router mounts
 * (`http/openapi.ts`). A manifest written by hand is a second source of truth
 * that starts accurate and ends decorative, and the party it misleads is the
 * one furthest from the code: an agent deciding which tool to call and which
 * field to send.
 *
 * `tool-manifest.json` beside this file is the same thing, checked in. It is
 * not read at runtime — `manifest.test.ts` asserts the generated manifest still
 * equals it — so a change to a tool's scope, its arguments or its description
 * shows up in a diff a human reviews rather than only in a running process.
 */

/**
 * `_meta` is the specification's extension point, and the two things prisme
 * puts there are the two a caller cannot otherwise know.
 *
 * `requiredScope` mirrors `x-required-scope` in the OpenAPI document, for the
 * reason given there: deny-by-default is part of the contract, not an
 * implementation detail, and a caller should be able to read which scope a
 * token needs without trying it.
 */
const SCOPE_KEY = 'prisme/requiredScope';
const KIND_KEY = 'prisme/kind';

export interface ToolDescriptor {
  readonly scope: Scope;
  readonly kind: 'read' | 'write';
  /** Exactly what goes on the wire in a `tools/list` result. */
  readonly tool: Record<string, unknown>;
}

/**
 * `$id`, `$schema`, and the one `pattern` that cannot be checked in.
 *
 * Zod renders `z.uuid()` as `format: "uuid"` *and* a regex, and that regex
 * spells out the nil and max UUIDs as literal alternatives. Two of them, per
 * uuid field, seventeen tools — and a literal UUID in a file this repository
 * publishes is exactly what the privacy deny-list refuses, because a workspace
 * id is a UUID (docs/17-privacy.md). The scan caught it on the first commit.
 *
 * Dropping the `pattern` where `format: "uuid"` says the same thing loses a
 * client nothing: `format` is the part a JSON Schema consumer reads, the
 * validation that matters happens in `server.ts` against the Zod schema itself,
 * and the manifest gets shorter. Every other `pattern` — the calendar date, the
 * area key, the objective period — is kept, because none of them says anything
 * that looks like an identifier.
 */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    const isUuid = entries.some(([key, entry]) => key === 'format' && entry === 'uuid');
    return Object.fromEntries(
      entries
        .filter(([key]) => key !== '$id' && key !== '$schema' && !(isUuid && key === 'pattern'))
        .map(([key, entry]) => [key, clean(entry)]),
    );
  }
  return value;
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const generated = clean(z.toJSONSchema(schema, { io, unrepresentable: 'any' })) as Record<
    string,
    unknown
  >;

  // MCP requires `inputSchema.type` to be `object`. Every tool here declares a
  // strict object, so this holds — it is asserted rather than assumed because
  // the day it stops holding, clients fail in ways that do not name the cause.
  if (io === 'input' && generated['type'] !== 'object') {
    throw new Error('an MCP tool input schema must describe an object');
  }
  return generated;
}

/**
 * Annotations, which MCP clients use as **hints** and must treat as untrusted.
 *
 * They are filled in honestly rather than defensively. `destructiveHint` is
 * false everywhere on purpose: no tool here deletes anything, and none of them
 * completes a task — prisme does neither (docs/11-ownership.md §4). What they
 * do is create, move and reconcile, which is what `idempotentHint: false` says.
 */
function annotationsOf(tool: McpTool): Record<string, unknown> {
  return {
    title: tool.title,
    readOnlyHint: tool.kind === 'read' && !tool.scope.startsWith('write:'),
    destructiveHint: false,
    idempotentHint: tool.kind === 'read',
    /**
     * Every tool reaches only prisme's own database and, for the reconciler
     * pair, the two tools prisme is wired to. None reaches the open internet.
     */
    openWorldHint: false,
  };
}

export function toolManifest(tools: readonly McpTool[]): readonly ToolDescriptor[] {
  return tools.map((tool) => ({
    scope: tool.scope,
    kind: tool.kind,
    tool: {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: jsonSchema(tool.input, 'input'),
      outputSchema: jsonSchema(tool.output, 'output'),
      annotations: annotationsOf(tool),
      _meta: { [SCOPE_KEY]: tool.scope, [KIND_KEY]: tool.kind },
    },
  }));
}

export { SCOPE_KEY, KIND_KEY };
