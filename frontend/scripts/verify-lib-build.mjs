#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED } from './lib-build-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = false;

for (const rel of REQUIRED) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.error(`verify:lib missing ${rel}`);
    failed = true;
  }
}

const catalogsJs = join(root, 'dist/i18n/catalogs.js');
if (existsSync(catalogsJs)) {
  const text = readFileSync(catalogsJs, 'utf8');
  if (text.includes('.json')) {
    console.error(
      'verify:lib dist/i18n/catalogs.js must not import .json (catalogs should be inlined)',
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`verify:lib ok (${REQUIRED.length} artifacts)`);
