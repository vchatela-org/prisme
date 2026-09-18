import { describe, expect, it } from 'vitest';
import { isScope } from '../http/scopes.js';
import { mcpTools } from './index.js';
import { toolManifest } from './manifest.js';
import { confirmationTokenArgument } from './tool.js';

/**
 * **The guard that keeps deny-by-default true as tools multiply.**
 *
 * `routes/contract.test.ts` is the same test for the other front door, and it
 * exists for the same reason: the rule it protects fails *silently*. A tool
 * added with the wrong scope does not throw, does not warn, and does not look
 * different in review — it simply works, for anyone holding a scope that should
 * not have reached it.
 *
 * The strongest assertion here is the last one. `tool-manifest.json` is the
 * generated manifest, checked in, so that changing a tool's scope, its
 * arguments or the description an agent chooses it by shows up as a reviewable
 * diff rather than only as different behaviour in a running process.
 */

/** Exactly the tools the W06 brief names, and nothing else. */
const BRIEF_READ_TOOLS = [
  'focus_now',
  'list_initiatives',
  'area_balance',
  'kpi',
  'objectives',
  'list_takeaways',
  'sync_status',
  'explain_score',
] as const;

const BRIEF_WRITE_TOOLS = [
  'capture',
  'promote_takeaway',
  'score_initiative',
  'set_status',
  'propose_now_set',
  'start_review',
  'record_review_decision',
  'plan_preview',
  'apply',
] as const;

/**
 * The one tool that reads with a write scope, named rather than inferred.
 *
 * `plan_preview` changes nothing, inward or outward — but running a reconciler
 * pass reaches the external tools, which is the capability `write:sync` names,
 * and it is the scope `POST /sync` requires for `mode: plan` for the same
 * reason. Listing it here means a *second* such tool cannot appear quietly.
 */
const READS_BEHIND_A_WRITE_SCOPE = ['plan_preview'];

describe('every tool declares a scope', () => {
  it('offers exactly the tools the brief names', () => {
    expect(mcpTools.map((tool) => tool.name)).toEqual([...BRIEF_READ_TOOLS, ...BRIEF_WRITE_TOOLS]);
  });

  it('gives every tool a scope from the published vocabulary', () => {
    for (const tool of mcpTools) {
      expect(tool.scope, `${tool.name} has no scope`).toBeTruthy();
      expect(isScope(tool.scope), `${tool.name} names an unknown scope`).toBe(true);
    }
  });

  it('never grants a write through a read scope', () => {
    for (const tool of mcpTools) {
      if (tool.kind !== 'write') continue;
      expect(
        tool.scope.startsWith('read:'),
        `${tool.name} writes behind the read-only scope ${tool.scope}`,
      ).toBe(false);
    }
  });

  it('keeps read tools on read scopes, bar the one documented exception', () => {
    const exceptions = mcpTools
      .filter((tool) => tool.kind === 'read' && !tool.scope.startsWith('read:'))
      .map((tool) => tool.name);
    expect(exceptions).toEqual(READS_BEHIND_A_WRITE_SCOPE);
  });

  it('gives every tool a unique snake_case name and a description worth reading', () => {
    const names = mcpTools.map((tool) => tool.name);
    expect(new Set(names).size, 'two tools share a name').toBe(names.length);

    for (const tool of mcpTools) {
      expect(tool.name, `${tool.name} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.title.length, `${tool.name} has no title`).toBeGreaterThan(0);
      // An agent picks a tool by reading this. A one-line description is the
      // reason it picks the wrong one.
      expect(tool.description.length, `${tool.name}'s description is too thin`).toBeGreaterThan(
        120,
      );
    }
  });
});

describe('every tool parses its arguments at the boundary', () => {
  it('refuses an argument it does not accept rather than ignoring it', () => {
    // The allow-list rule, for the MCP surface. Silently dropping a field
    // teaches the caller the call did what it asked (apps/api/CLAUDE.md §4).
    for (const tool of mcpTools) {
      const parsed = tool.input.safeParse({ somethingNobodyOwns: 1 });
      expect(parsed.success, `${tool.name} accepted an unknown argument`).toBe(false);
    }
  });

  it('gives every write tool a confirmationToken and no read tool one', () => {
    for (const tool of mcpTools) {
      const accepts = tool.input.safeParse({ confirmationToken: 'x' }).success;
      if (tool.kind === 'write') continue;
      expect(accepts, `${tool.name} reads but accepts a confirmationToken`).toBe(false);
    }

    for (const tool of mcpTools) {
      if (tool.kind !== 'write') continue;
      const refused = tool.input.safeParse({ confirmationToken: '' });
      // Present, and still validated: an empty string is not a token.
      expect(refused.success, `${tool.name} accepted an empty confirmationToken`).toBe(false);
    }
  });

  it('describes the confirmation argument once, in one place', () => {
    expect(confirmationTokenArgument.description).toContain('dry run');
  });
});

describe('the manifest', () => {
  /**
   * A file snapshot rather than an inline one, because the point is that a
   * human reads the diff. `vitest -u` rewrites it; the reviewer still sees
   * every changed scope and every reworded description in the pull request,
   * which is the only place a tool description is ever really reviewed.
   */
  it('matches the copy checked in beside it', async () => {
    const generated = toolManifest(mcpTools).map((descriptor) => descriptor.tool);
    await expect(`${JSON.stringify(generated, null, 2)}\n`).toMatchFileSnapshot(
      './tool-manifest.json',
    );
  });

  it('names the required scope on every tool, as the OpenAPI document does', () => {
    for (const descriptor of toolManifest(mcpTools)) {
      const meta = descriptor.tool['_meta'] as Record<string, unknown>;
      expect(meta['prisme/requiredScope']).toBe(descriptor.scope);
    }
  });

  it('says nothing is destructive, because nothing here deletes', () => {
    // prisme never completes or deletes a task (docs/11-ownership.md §4). The
    // hint is filled in honestly rather than defensively, and this is what
    // holds it honest if a tool that does delete is ever added.
    for (const descriptor of toolManifest(mcpTools)) {
      const annotations = descriptor.tool['annotations'] as Record<string, unknown>;
      expect(annotations['destructiveHint']).toBe(false);
      expect(annotations['openWorldHint']).toBe(false);
    }
  });
});
