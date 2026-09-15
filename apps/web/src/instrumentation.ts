/**
 * Configuration is validated once, at boot.
 *
 * Next.js calls `register()` before it serves anything, which is the only hook
 * that behaves like a main function. A web process missing `PRISME_API_URL`
 * must die here, naming the variable, rather than rendering an error page the
 * first time somebody opens it.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;

  const { loadConfigOrExit } = await import('@prisme/config');
  const { createLogger } = await import('@prisme/observability');

  const config = loadConfigOrExit({ service: 'web' });
  const logger = createLogger({ service: 'prisme-web', level: config.logLevel });
  logger.info('configuration loaded', { port: config.port, timezone: config.timezone });
}
