#!/usr/bin/env node
// Stamp the supported gateway range into a package.json, as
//
//   "openshell": { "gateway": ">=0.1.0 <=0.1.2", "sdk": "v0.0.0-…" }
//
// so that someone holding `openshell-dashboard@x.y.z` can find out which
// gateway it needs without reading this repository (#66):
//
//   npm view openshell-dashboard@x.y.z openshell
//
// The committed frontend/package.json deliberately has no such field, for the
// same reason its version is 0.0.0-semantically-released: a committed copy
// would be a second place to keep in step with deploy/ci/gateway-pins.json.
// The release pipeline calls this in its CI checkout, just before
// `npm publish`, and nothing commits the result.
//
// It is not a prepack/postpack pair, although that would keep a local tree
// clean on its own: `npm publish` re-reads package.json AFTER postpack to build
// the manifest it sends to the registry, so a field that postpack removed would
// be in the tarball but missing from `npm view`.
//
//   node scripts/release/stamp-package.mjs [path/to/package.json]
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGatewayRange } from '../gateway-range.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function stampPackage(pkgPath, range = readGatewayRange()) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.openshell = { gateway: range.range, sdk: range.sdk };
  // Two-space JSON with a trailing newline is how the file is committed and how
  // npm writes it, so the field is the whole diff.
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg.openshell;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pkgPath = process.argv[2] ?? join(repoRoot, 'frontend', 'package.json');
    const stamped = stampPackage(pkgPath);
    process.stdout.write(`stamped ${pkgPath}: openshell = ${JSON.stringify(stamped)}\n`);
  } catch (error) {
    process.stderr.write(`stamp-package: ${error.message}\n`);
    process.exit(1);
  }
}
