/**
 * Write dist/main/package.json with {"type":"commonjs"}.
 *
 * The repository root declares "type": "module" for the renderer tooling, but
 * the Electron main and preload bundles are compiled to CommonJS. Node decides
 * a .js file's module system from the nearest package.json, so this marker is
 * what makes dist/main/*.js load as CommonJS. Without it Electron fails on the
 * first `require` in the main bundle.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'dist', 'main');

mkdirSync(target, { recursive: true });
writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`, 'utf8');
console.log('Wrote dist/main/package.json (type: commonjs)');
