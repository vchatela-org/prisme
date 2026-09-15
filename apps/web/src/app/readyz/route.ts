import { loadConfig } from '@prisme/config';

/**
 * Readiness for the web tier.
 *
 * The web tier is ready when the API it renders from is ready. It does not
 * check PostgreSQL, because it cannot reach it and should not be able to.
 *
 * Readiness failing is not liveness failing: an unready pod is taken out of the
 * service and left running, so an API blip drains the web tier rather than
 * restarting it.
 */
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 2000;

export async function GET(): Promise<Response> {
  let apiUrl: string;
  try {
    apiUrl = loadConfig({ service: 'web' }).apiUrl as string;
  } catch {
    // Configuration is validated at boot; reaching here means the process is
    // misconfigured, which is a readiness failure rather than a 500.
    return Response.json(
      { state: 'not-ready', reason: 'configuration is invalid' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const response = await fetch(new URL('/readyz', apiUrl), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const ready = response.ok;
    return Response.json(
      { state: ready ? 'ready' : 'not-ready', api: response.status },
      { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    // No error detail: an upstream message can carry a host name.
    return Response.json(
      { state: 'not-ready', reason: 'the API is not reachable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
