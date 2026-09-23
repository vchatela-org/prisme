import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone — a self-contained server with only the modules
  // it actually imports, so the runtime layer needs no package manager and no
  // node_modules tree (docs/15-runtime.md §1).
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  reactStrictMode: true,
  // Never advertise the framework version to an unauthenticated caller.
  poweredByHeader: false,
  //
  // There is deliberately no `eslint` key here. Until Next 16 one was needed to
  // stop `next build` re-linting with rules that disagree with `pnpm lint`, the
  // repository's one configuration. Next 16 removed the option *and* the lint
  // step it controlled, so the key is now rejected with a warning on every
  // build — and leaving it in to keep the build quiet about linting would be a
  // setting that does nothing while looking like it does something.
};

export default nextConfig;
