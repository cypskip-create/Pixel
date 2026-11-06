/**
 * Rebrand user-facing references from Cyps to Pixel.
 *
 * Deliberately conservative: only the standalone product name changes. Frozen
 * contract identifiers (CypsBridge, CypsError, CypsErrorCode, isCypsError) and
 * lowercase technical names (window.cyps, cypsShell, 'cyps:' IPC channels,
 * CYPS_* environment variables) are left untouched so nothing regresses.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const targets = ['src', 'tests', 'scripts'];
const extensions = ['.ts', '.tsx'];

/** `Cyps` not followed by an identifier suffix that belongs to the contract. */
const PRODUCT_NAME = /Cyps(?!Error|Bridge)/g;

const changed = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!extensions.some((extension) => path.endsWith(extension))) continue;

    const before = readFileSync(path, 'utf8');
    const after = before.replace(PRODUCT_NAME, 'Pixel');
    if (after !== before) {
      const count = (before.match(PRODUCT_NAME) ?? []).length;
      writeFileSync(path, after, 'utf8');
      changed.push({ file: relative(root, path), count });
    }
  }
}

for (const target of targets) walk(join(root, target));

const total = changed.reduce((sum, item) => sum + item.count, 0);
console.log(`Renamed ${total} user-facing reference(s) in ${changed.length} file(s):`);
for (const item of changed) console.log(`  ${item.file} (${item.count})`);
