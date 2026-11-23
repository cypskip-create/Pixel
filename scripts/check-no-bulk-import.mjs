#!/usr/bin/env node
/**
 * Mandatory repository scope guard: prevents accidental bulk imports of the
 * Hermes repository tree into Pixel.
 *
 * Fails (without deleting anything) if:
 *  1. Any forbidden nested Hermes directory (`hermes/`, `hermes-agent/`,
 *     `apps/desktop/`, `plugin-catalog/`, `optional-mcps/`, `optional-skills/`)
 *     exists inside the Pixel working tree.
 *  2. More than MAX_UNTRACKED_FILES (50) untracked files appear in `git status`.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const MAX_UNTRACKED_FILES = 50;

const FORBIDDEN_TREES = [
  'hermes',
  'hermes-agent',
  'apps/desktop',
  'apps/shared',
  'plugin-catalog',
  'optional-mcps',
  'optional-skills',
  'tui_gateway',
];

const foundForbidden = FORBIDDEN_TREES.filter((rel) => existsSync(join(repoRoot, rel)));
if (foundForbidden.length > 0) {
  console.error(`BULK_IMPORT_GUARD_FAILED: Forbidden nested Hermes directories detected: ${foundForbidden.join(', ')}`);
  process.exit(1);
}

const rawStatus = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
const untracked = rawStatus
  .split(/\r?\n/)
  .filter((line) => line.startsWith('?? '));

if (untracked.length > MAX_UNTRACKED_FILES) {
  console.error(`BULK_IMPORT_GUARD_FAILED: ${untracked.length} untracked files exceed safety ceiling (${MAX_UNTRACKED_FILES}).`);
  process.exit(1);
}

console.log(`SCOPE_GUARD_OK: 0 forbidden trees, ${untracked.length} untracked file(s).`);
