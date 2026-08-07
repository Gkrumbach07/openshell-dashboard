#!/usr/bin/env node
/**
 * After tsc emits JS to dist/, copy package-owned static assets that the
 * emitted modules import via relative paths (./Foo.css, ../img.png, …).
 *
 * Usage:
 *   node ./scripts/copy-lib-assets.mjs          # copy from src/ → dist/
 *   node ./scripts/copy-lib-assets.mjs --check  # assert dist files exist (no copy)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(FRONTEND_ROOT, 'src');
const DIST_DIR = path.join(FRONTEND_ROOT, 'dist');

/** Relative import of a static asset: from './x.css' or from "./../y.svg" */
const RELATIVE_ASSET_IMPORT =
  /(?:import|require\s*\()\s*(?:['"])(\.\.?\/[^'"]+\.(?:css|svg|png|jpe?g|gif|webp|woff2?|ttf|eot))['"]/gi;

const checkOnly = process.argv.includes('--check');

function walkJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function collectRelativeAssetImports(jsFile) {
  const source = fs.readFileSync(jsFile, 'utf8');
  const imports = new Set();
  for (const match of source.matchAll(RELATIVE_ASSET_IMPORT)) {
    imports.add(match[1]);
  }
  return [...imports];
}

/** True when candidate resolves inside rootDir (rejects .. escapes and absolute outliers). */
function isInsideDir(rootDir, candidate) {
  const rel = path.relative(rootDir, candidate);
  return (
    rel !== '' &&
    !rel.startsWith(`..${path.sep}`) &&
    rel !== '..' &&
    !path.isAbsolute(rel)
  );
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `copy-lib-assets: dist/ not found at ${DIST_DIR}. Run tsc build first.`,
    );
    process.exit(1);
  }

  const jsFiles = walkJsFiles(DIST_DIR);
  const missing = [];
  const copied = [];
  const seenDest = new Set();

  for (const jsFile of jsFiles) {
    const specs = collectRelativeAssetImports(jsFile);
    for (const spec of specs) {
      const distAsset = path.normalize(path.join(path.dirname(jsFile), spec));
      if (!isInsideDir(DIST_DIR, distAsset)) {
        missing.push({ jsFile, spec, reason: 'resolves outside dist/' });
        continue;
      }
      if (seenDest.has(distAsset)) {
        continue;
      }
      seenDest.add(distAsset);

      const relFromDist = path.relative(DIST_DIR, distAsset);
      const srcAsset = path.join(SRC_DIR, relFromDist);

      if (checkOnly) {
        if (!fs.existsSync(distAsset)) {
          missing.push({ jsFile, spec, distAsset, srcAsset });
        }
        continue;
      }

      if (!fs.existsSync(srcAsset)) {
        missing.push({
          jsFile,
          spec,
          distAsset,
          srcAsset,
          reason: 'source file missing',
        });
        continue;
      }

      fs.mkdirSync(path.dirname(distAsset), { recursive: true });
      fs.copyFileSync(srcAsset, distAsset);
      copied.push(path.relative(FRONTEND_ROOT, distAsset));
    }
  }

  if (!checkOnly && copied.length > 0) {
    console.log(
      `copy-lib-assets: copied ${copied.length} asset(s):\n  ${copied.join('\n  ')}`,
    );
  } else if (!checkOnly) {
    console.log('copy-lib-assets: no relative static asset imports found');
  }

  // Always verify dist has every imported asset after copy (or in --check mode)
  if (!checkOnly) {
    const postMissing = [];
    for (const jsFile of jsFiles) {
      for (const spec of collectRelativeAssetImports(jsFile)) {
        const distAsset = path.normalize(path.join(path.dirname(jsFile), spec));
        if (!isInsideDir(DIST_DIR, distAsset) || !fs.existsSync(distAsset)) {
          postMissing.push({ jsFile, spec, distAsset });
        }
      }
    }
    if (postMissing.length > 0) {
      console.error('copy-lib-assets: missing assets in dist/ after copy:');
      for (const m of postMissing) {
        console.error(
          `  ${path.relative(FRONTEND_ROOT, m.jsFile)} → ${m.spec}`,
        );
      }
      process.exit(1);
    }
  }

  if (missing.length > 0) {
    console.error('copy-lib-assets: failed:');
    for (const m of missing) {
      const from = path.relative(FRONTEND_ROOT, m.jsFile);
      const extra = m.reason ? ` (${m.reason})` : '';
      console.error(`  ${from} → ${m.spec}${extra}`);
    }
    process.exit(1);
  }

  if (checkOnly) {
    console.log(
      `copy-lib-assets: ok (${seenDest.size} relative asset import(s) present in dist/)`,
    );
  }
}

main();
