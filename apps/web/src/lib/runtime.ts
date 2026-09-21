import { loadConfig, type Config } from '@prisme/config';
import { createLogger, type Logger } from '@prisme/observability';

/**
 * The web tier's runtime configuration, read on the first request.
 *
 * `next build` evaluates every route's module graph to collect page data, and
 * it does so in an environment that has no runtime configuration — so loading
 * at module scope makes the build demand production secrets to produce a static
 * manifest. The boot-time check that configuration is *present* is
 * `instrumentation.ts`'s job (docs/15-runtime.md §2); this is the same pattern
 * `app/readyz/route.ts` uses.
 *
 * It lives here rather than in `api.ts` because two things now need it — the
 * API client and the area-colour pinning the shell mounts — and a second
 * `loadConfig` call would be a second cache to keep in step with the first.
 */

let runtime: { config: Config; logger: Logger } | undefined;

export function webRuntime(): { config: Config; logger: Logger } {
  if (runtime === undefined) {
    const config = loadConfig({ service: 'web' });
    runtime = {
      config,
      logger: createLogger({ service: 'prisme-web', level: config.logLevel }),
    };
  }
  return runtime;
}
