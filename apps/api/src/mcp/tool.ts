import { z } from 'zod';
import type { Identity } from '../http/authorize.js';
import type { Scope } from '../http/scopes.js';
import type { Services } from '../services/index.js';

/**
 * The tool kit: one declaration per tool, and the shape of a dry run.
 *
 * This is `http/route.ts` for the MCP surface, and for the same reason. A tool
 * is **data before it is behaviour** — name, scope, schemas, handler — so the
 * dispatcher, the manifest and the conformance test are generated from one
 * object and cannot disagree about which scope a tool needs. `scope` is
 * required and has no default here exactly as it is there: a tool that forgets
 * it does not compile.
 *
 * ### Read and write are different types, not a flag
 *
 * A write tool cannot be declared without a `plan`, and its `execute` cannot be
 * called without one. That is the brief's rule — *every write tool is dry-run
 * by default* — expressed as something the compiler enforces rather than
 * something each tool remembers. There is no way to write a tool here that
 * performs a write on first call, which is the only version of this control
 * worth having.
 *
 * ### No business logic
 *
 * Every handler delegates to `services`. The rule that decides what belongs in
 * a `now` set lives in `packages/domain`; the rule about who may ask lives in
 * `auth/`; what lives here is the projection from a service's answer into
 * something small enough for an agent to read (apps/api/CLAUDE.md §6).
 */

export interface ToolContext {
  readonly services: Services;
  /** The verified caller. Passed through to the services, so the event log gets the right actor. */
  readonly identity: Identity;
  /** Injected, never `new Date()` in a handler — the domain is scored against it. */
  readonly now: Date;
}

/**
 * One change a write tool would make.
 *
 * `before` is what the world holds **right now**, which is what makes a plan
 * state-dependent and therefore what makes a confirmation go stale when the
 * world moves. A diff that reported only `after` would hash identically before
 * and after somebody else's edit, and the confirmation would authorise a change
 * nobody had seen.
 *
 * ### `observe` changes nothing, and is in the diff on purpose
 *
 * Some plans have no `before` of their own. A creation is the obvious one: it
 * describes a row that does not exist, so it hashes identically whatever the
 * world does, and a confirmation for it could never go stale. `observe` is how
 * those plans read the state that *should* invalidate them — the initiatives
 * already carrying this title, the review sessions already open — into the hash.
 *
 * It is a separate `op` rather than a `create` with no `after` because
 * {@link countCreates} feeds the number ADR-0010 guard 3 is about. A probe
 * counted as a creation would inflate exactly the figure a human is reading to
 * decide whether something is about to duplicate their backlog.
 */
export const changeSchema = z.object({
  op: z.enum(['create', 'update', 'status', 'promote', 'reconcile', 'observe']),
  /** `initiative`, `review`, `takeaway`, `sync` — what kind of thing moves. */
  entity: z.string(),
  /** Null for something that does not exist yet. */
  id: z.string().nullable(),
  field: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});

export type Change = z.infer<typeof changeSchema>;

/**
 * What a write tool would do, computed against the world as it is.
 *
 * **Nothing in here may depend on the clock.** The plan is hashed, and the hash
 * is recomputed at execution to check that the world has not moved; a timestamp
 * anywhere inside would make every confirmation stale within a millisecond, and
 * "the plan has changed since it was shown" would become the normal outcome
 * rather than the alarming one. `mcp.integration.test.ts` plans and immediately
 * executes precisely to hold this true.
 */
export interface ToolPlan {
  /** One sentence, written for a person reading a diff at the moment of deciding. */
  readonly summary: string;
  readonly changes: readonly Change[];
  /** Anything the caller should read before confirming. Not a refusal. */
  readonly warnings?: readonly string[];
}

export const planSchema = z.object({
  summary: z.string(),
  changes: z.array(changeSchema),
  warnings: z.array(z.string()),
  /**
   * Creations are counted on their own because they are the number that matters
   * (ADR-0010 guard 3): every other operation is reversible by re-editing, and a
   * spurious create leaves a duplicate somebody has to find.
   */
  creates: z.int(),
});

interface ToolCommon {
  /** Snake case, as the brief names them and as MCP clients display them. */
  readonly name: string;
  readonly title: string;
  /**
   * What it does, **and what it will not do**. The brief is specific about the
   * second half: an agent choosing between two tools is reading these strings,
   * and the failure to design against is a well-meaning agent looping on a
   * misunderstood instruction. Never name a real initiative here — examples
   * come from `fixtures/` (docs/17-privacy.md).
   */
  readonly description: string;
  /** Required. Deny by default reaches the MCP surface through this field. */
  readonly scope: Scope;
}

export interface ReadTool extends ToolCommon {
  readonly kind: 'read';
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  run(input: unknown, context: ToolContext): Promise<unknown>;
}

export interface WriteTool extends ToolCommon {
  readonly kind: 'write';
  /** Includes `confirmationToken`, added by {@link defineWriteTool}. */
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  plan(input: unknown, context: ToolContext): Promise<ToolPlan>;
  execute(input: unknown, plan: ToolPlan, context: ToolContext): Promise<unknown>;
}

export type McpTool = ReadTool | WriteTool;

/**
 * The argument every write tool takes, and the one the dry run hands back.
 *
 * Declared here rather than on each tool so that no write tool can be added
 * without it, and so its description is written once — an agent reads this
 * string seventeen times over a session and it should say the same thing every
 * time.
 */
export const confirmationTokenArgument = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'Omit this to perform a dry run: the tool takes no action and returns the diff it would apply, together with a short-lived token. Send that token back — unchanged, with the same arguments — to execute exactly the diff you were shown. The token is refused if anything it described has since changed.',
  );

export function defineReadTool<I, R>(definition: {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  input: z.ZodType<I>;
  result: z.ZodType<R>;
  run(input: I, context: ToolContext): Promise<R>;
}): ReadTool {
  return {
    kind: 'read',
    name: definition.name,
    title: definition.title,
    description: definition.description,
    scope: definition.scope,
    input: definition.input,
    output: definition.result,
    run: (input, context) => definition.run(input as I, context),
  };
}

/**
 * The envelope every write tool answers with, dry run or not.
 *
 * One shape for both outcomes, because an agent that has to branch on the shape
 * of a response before it can read it will branch wrongly once. `applied` is
 * the field to read: false means nothing happened, whatever else is in the
 * object.
 */
export function writeResult<R>(result: z.ZodType<R>) {
  return z.object({
    tool: z.string(),
    /** False on a dry run, and on a dry run that found nothing to do. */
    applied: z.boolean(),
    plan: planSchema,
    /**
     * Present only on a dry run that found something to do. Absent once
     * executed, and absent when the plan is empty — there is nothing to confirm.
     */
    confirmation: z
      .object({
        token: z.string(),
        expiresAt: z.string(),
        expiresInSeconds: z.int(),
      })
      .nullable(),
    /** The service layer's answer. Null until the plan is executed. */
    result: result.nullable(),
  });
}

export function defineWriteTool<S extends z.ZodObject, R>(definition: {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  /** The tool's own arguments. `confirmationToken` is added here, not there. */
  input: S;
  result: z.ZodType<R>;
  plan(input: z.infer<S>, context: ToolContext): Promise<ToolPlan>;
  execute(input: z.infer<S>, plan: ToolPlan, context: ToolContext): Promise<R>;
}): WriteTool {
  return {
    kind: 'write',
    name: definition.name,
    title: definition.title,
    description: definition.description,
    scope: definition.scope,
    input: definition.input.extend({ confirmationToken: confirmationTokenArgument.optional() }),
    output: writeResult(definition.result),
    plan: (input, context) => definition.plan(input as z.infer<S>, context),
    execute: (input, plan, context) => definition.execute(input as z.infer<S>, plan, context),
  };
}

export function countCreates(changes: readonly Change[]): number {
  return changes.filter((change) => change.op === 'create').length;
}
