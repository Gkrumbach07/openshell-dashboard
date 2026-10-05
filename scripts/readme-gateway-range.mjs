#!/usr/bin/env node
// Keeps the README's statement of the CURRENT supported gateway range in step
// with deploy/ci/gateway-pins.json.
//
// The README is where people look first, and a range written there by hand goes
// stale the day the pins move — at which point it contradicts the release
// notes, the package and the image, which are all derived. So the few lines
// that restate the range sit between two marker comments and are generated,
// and CI fails when they are out of date.
//
//   node scripts/readme-gateway-range.mjs --write   regenerate the block
//   node scripts/readme-gateway-range.mjs --check   exit 1 when it is stale (CI)
//
// Whatever moves the pins runs --write in the same change. That includes the
// compat sweep's automated pull requests: one moves the ceiling lane and the
// other the SDK, the block restates both, and a pull request that left it stale
// could never pass --check. --write changes nothing outside the markers and is
// a no-op when the block is already right, so it is safe to run every time.
//
// Only the part between the markers is generated. The prose around it —
// including the hand-written facts about older dashboard releases — is never
// touched.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { readGatewayRange } from './gateway-range.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const README_PATH = join(repoRoot, 'README.md');
export const BEGIN =
  '<!-- gateway-range:begin (generated from deploy/ci/gateway-pins.json by scripts/readme-gateway-range.mjs; do not edit) -->';
export const END = '<!-- gateway-range:end -->';

export function renderBlock(range) {
  return [
    BEGIN,
    '| | |',
    '|---|---|',
    `| Oldest supported gateway | \`${range.floor}\` |`,
    `| Newest tested gateway | \`${range.ceiling}\` |`,
    `| Declared as | \`${range.range}\` |`,
    `| OpenShell Go SDK | \`${range.sdk}\` |`,
    END,
  ].join('\n');
}

/** Returns the document with the generated block replaced. */
export function replaceBlock(readme, block) {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`the markers are missing or out of order; expected\n  ${BEGIN}\n  …\n  ${END}`);
  }
  if (readme.indexOf(BEGIN, begin + 1) !== -1 || readme.indexOf(END, end + 1) !== -1) {
    throw new Error('the markers appear more than once');
  }
  return readme.slice(0, begin) + block + readme.slice(end + END.length);
}

function main() {
  const { values } = parseArgs({
    options: {
      write: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      readme: { type: 'string', default: README_PATH },
      pins: { type: 'string' },
    },
  });
  if (values.write === values.check) {
    throw new Error('pass exactly one of --write or --check');
  }

  const block = renderBlock(readGatewayRange(values.pins));
  const current = readFileSync(values.readme, 'utf8');
  const wanted = replaceBlock(current, block);

  if (current === wanted) {
    process.stdout.write(`${values.readme}: the supported gateway range is up to date\n`);
    return;
  }
  if (values.write) {
    writeFileSync(values.readme, wanted);
    process.stdout.write(`${values.readme}: regenerated the supported gateway range\n`);
    return;
  }
  throw new Error(
    `${values.readme} is stale: it does not state the range that deploy/ci/gateway-pins.json ` +
      `now gives. It should read:\n\n${block}\n\n` +
      'Run `node scripts/readme-gateway-range.mjs --write` and commit the result.',
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`readme-gateway-range: ${error.message}\n`);
    process.exit(1);
  }
}
