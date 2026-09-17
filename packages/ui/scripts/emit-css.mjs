#!/usr/bin/env node
/**
 * Writes the generated stylesheet into `dist` after tsc has compiled the
 * package.
 *
 * The tokens are TypeScript, because that is where they can be typed and
 * tested; the browser needs CSS. Rather than maintain both and hope they
 * agree, the CSS is produced from the compiled tokens on every build, and
 * `dist/prisme.css` is what `apps/web` imports. It is a build artefact and is
 * not committed.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(packageRoot, 'dist');

/** @type {{ themeCss: () => string }} */
const tokens = await import(join(distRoot, 'tokens', 'theme-css.js'));

await mkdir(distRoot, { recursive: true });
await writeFile(join(distRoot, 'prisme.css'), tokens.themeCss(), 'utf8');
