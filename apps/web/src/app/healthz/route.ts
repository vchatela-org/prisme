/**
 * Liveness for the web tier. No dependencies — not the database, and not the
 * API either (docs/15-runtime.md §1).
 *
 * The web tier has no database credential at all: the trust boundaries in
 * docs/14-threat-model.md §2 run browser → web → API → PostgreSQL, so
 * `DATABASE_URL` is not even part of this service's configuration contract.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'prisme-web' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
