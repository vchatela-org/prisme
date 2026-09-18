import { SCOPE_NAMES, type Scope } from '../http/scopes.js';
import type { AuthStore, WriteSwitchMode, WriteSwitchRecord } from './store.js';

/**
 * The kill switch — W14 item 10: *disable outward writes entirely while leaving
 * reads working.*
 *
 * ### Why it takes scopes away rather than setting a flag somewhere
 *
 * The obvious implementation is a boolean the reconciler consults. It has a
 * quiet problem: it protects the path somebody remembered to wire it into. Every
 * future write route, every MCP write tool W06 adds, every creation flow W15
 * builds is a new place the check has to be repeated, and the one that gets
 * missed is discovered during the incident the switch exists for.
 *
 * Engaging the switch instead **withholds scopes from every principal**, in the
 * authorizer, before any handler runs. There is nothing to remember: a write
 * route is unreachable because the caller no longer holds the scope it declares,
 * and that is enforced by the same `holdsScope` check that enforces everything
 * else. A tool added next year is covered on the day it is written.
 *
 * ### It can only ever subtract
 *
 * `SYNC_WRITE_ENABLED` is deployment configuration and stays the outer gate —
 * `GET /settings` calls it "the write freeze, which a human lifts by working
 * through the migration sequence, not by calling an API" (W05), and that must
 * stay true. So this switch is strictly subtractive: releasing it returns
 * prisme to whatever the configuration already allowed, and no API call can
 * grant a write capability the deployment has not granted. A break-glass that
 * can also un-break the glass is a privilege escalation with a friendly name.
 *
 * ### Two modes
 *
 * | Mode | Withholds | For |
 * |---|---|---|
 * | `outward` | `write:sync` | The reconciler is doing something wrong to the external tools. prisme stays fully usable; nothing reaches outward |
 * | `all` | every `write:*` | Something is wrong and nobody should be changing anything until a human has looked |
 *
 * Neither mode touches `read:*`, which is the requirement, and neither touches
 * `admin:*` — releasing the switch is an `admin:settings` call, and a switch
 * that revokes the authority needed to release it is one that needs a database
 * session to undo.
 */

export const OUTWARD_WRITE_SCOPES: readonly Scope[] = ['write:sync'];

export function withheldScopes(record: WriteSwitchRecord): readonly Scope[] {
  if (!record.engaged) return [];
  if (record.mode === 'outward') return OUTWARD_WRITE_SCOPES;
  return SCOPE_NAMES.filter((scope) => scope.startsWith('write:'));
}

export const RELEASED: WriteSwitchRecord = {
  engaged: false,
  mode: 'outward',
  changedAt: null,
  changedBy: null,
  reason: null,
};

/**
 * How long a replica may serve a stale view of the switch.
 *
 * Short, because this is the one setting whose whole value is how fast it takes
 * effect — but not zero: a database read on the authorization path of every
 * request is a dependency this control does not need. Engaging updates the
 * local view immediately, so the window only applies to *other* replicas.
 */
const CACHE_TTL_MS = 2_000;

export interface WriteSwitchOptions {
  readonly store: AuthStore;
  readonly now: () => Date;
}

export interface WriteSwitch {
  /** Cached for at most {@link CACHE_TTL_MS}. Never throws: see below. */
  current(): Promise<WriteSwitchRecord>;
  engage(input: { mode: WriteSwitchMode; by: string; reason: string }): Promise<WriteSwitchRecord>;
  release(by: string): Promise<WriteSwitchRecord>;
}

export function createWriteSwitch(options: WriteSwitchOptions): WriteSwitch {
  let cached: WriteSwitchRecord | undefined;
  let readAt = 0;

  return {
    async current(): Promise<WriteSwitchRecord> {
      const nowMs = options.now().getTime();
      if (cached !== undefined && nowMs - readAt < CACHE_TTL_MS) return cached;
      try {
        cached = await options.store.readWriteSwitch();
        readAt = nowMs;
        return cached;
      } catch {
        // A database that cannot be read must not become an open switch. If
        // there is a last known state, keep it; if there is none, assume
        // released — the outer `SYNC_WRITE_ENABLED` gate still applies, and
        // failing *closed* here would take reads down with it, which is the
        // one thing item 10 says must keep working.
        return cached ?? RELEASED;
      }
    },

    async engage(input): Promise<WriteSwitchRecord> {
      const now = options.now();
      cached = await options.store.setWriteSwitch({
        engaged: true,
        mode: input.mode,
        changedAt: now,
        changedBy: input.by,
        reason: input.reason,
      });
      readAt = now.getTime();
      return cached;
    },

    async release(by: string): Promise<WriteSwitchRecord> {
      const now = options.now();
      cached = await options.store.setWriteSwitch({
        ...RELEASED,
        changedAt: now,
        changedBy: by,
        reason: 'released',
      });
      readAt = now.getTime();
      return cached;
    },
  };
}
