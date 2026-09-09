#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

rmSync(join(root, 'dist'), { recursive: true, force: true });
run('tsc -p tsconfig.build.json');
// Node ESM does not resolve extensionless relative imports. Rewrite the emitted
// specifiers to their explicit .js paths so the packed library works outside a
// bundler too.
run('tsc-alias -p tsconfig.build.json --resolve-full-paths');
run('node scripts/verify-lib-build.mjs');
