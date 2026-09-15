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
  eslint: {
    // Linting is a repository-wide job with one configuration
    // (`pnpm lint`), not something each app re-runs with its own rules.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
