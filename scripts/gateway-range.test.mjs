// node --test "scripts/**/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PINS_PATH, deriveGatewayRange, formatRange, readGatewayRange, sdkInGoMod } from './gateway-range.mjs';
import { BEGIN, END, README_PATH, renderBlock, replaceBlock } from './readme-gateway-range.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const SDK = 'v0.0.0-20260928030816-6648bd0c290e';
const lane = (version, required = true) => ({ version, label: version, required });

/** Runs one of the scripts the way CI and the sweep's pull requests do. */
const run = (script, ...args) => spawnSync(process.execPath, [join(scripts, script), ...args], { encoding: 'utf8' });

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openshell-dashboard-range-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The committed pins after one of the two changes an automated pull request
 * makes to them (ADR 0006). Each returns the path of a scratch copy.
 */
function movedPins(t) {
  const dir = tempDir(t);
  const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
  const { ceiling } = deriveGatewayRange(pins);
  const [major, minor, patch] = ceiling.split('.').map(Number);
  const nextCeiling = `${major}.${minor}.${patch + 1}`;
  const nextSdk = 'v0.0.0-20991231000000-0123456789ab';
  const write = (name, changed) => {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`);
    return path;
  };
  return {
    nextCeiling,
    nextSdk,
    // Gateway axis: the ceiling lane moves to a newer release, the SDK stays.
    gatewayAxis: write('gateway-axis.json', {
      ...pins,
      lanes: pins.lanes.map((each) => (each.version === ceiling ? { ...each, version: nextCeiling } : each)),
    }),
    // SDK axis: the `sdk` field moves (with go.mod), the lanes stay.
    sdkAxis: write('sdk-axis.json', { ...pins, sdk: nextSdk }),
  };
}

test('the floor is the lowest required lane and the ceiling the highest, whatever their order', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2'), lane('0.1.0')] });
  assert.deepEqual(range, {
    floor: '0.1.0',
    ceiling: '0.1.2',
    range: '>=0.1.0 <=0.1.2',
    sdk: SDK,
    tested: ['0.1.0', '0.1.2'],
  });
  assert.equal(formatRange(range), '0.1.0 – 0.1.2');
});

test('versions compare as numbers, not as strings', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.9.0'), lane('0.10.0'), lane('0.2.11')] });
  assert.equal(range.floor, '0.2.11');
  assert.equal(range.ceiling, '0.10.0');
});

test('an advisory lane proves nothing, so it does not widen the range', () => {
  const range = deriveGatewayRange({
    sdk: SDK,
    lanes: [lane('0.0.116', false), lane('0.1.0'), lane('0.1.2'), lane('0.1.3-dev.84', false)],
  });
  assert.equal(range.range, '>=0.1.0 <=0.1.2');
});

test('a single required lane is a range of one release', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2')] });
  assert.equal(range.range, '>=0.1.2 <=0.1.2');
  assert.equal(formatRange(range), '0.1.2');
});

test('a required lane that is not a release is refused, not folded into the range', () => {
  for (const version of ['dev', '0.1.3-dev.84', '0.1.3-pre.4', 'latest', 'v0.1.2', undefined]) {
    assert.throws(
      () => deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.0'), lane(version)] }),
      /not a gateway release/,
      `version ${version}`,
    );
  }
});

test('there is no range without a required lane, and no declaration without the SDK', () => {
  assert.throws(
    () => deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2', false)] }),
    /no lane has "required": true/,
  );
  assert.throws(() => deriveGatewayRange({ sdk: SDK }), /no lane has "required": true/);
  assert.throws(() => deriveGatewayRange({ lanes: [lane('0.1.2')] }), /"sdk" is missing/);
});

test('the committed pins give a range, and name the SDK that backend/go.mod builds against', () => {
  const range = readGatewayRange();
  assert.match(range.floor, /^\d+\.\d+\.\d+$/);
  assert.match(range.ceiling, /^\d+\.\d+\.\d+$/);
  assert.equal(range.sdk, sdkInGoMod());
});

test('the README block is replaced in place and everything around it is kept', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.0'), lane('0.1.2')] });
  const block = renderBlock(range);
  const readme = `# Title\n\nbefore\n\n${BEGIN}\nstale\n${END}\n\nafter\n`;

  const updated = replaceBlock(readme, block);
  assert.equal(updated, `# Title\n\nbefore\n\n${block}\n\nafter\n`);
  assert.match(updated, /\| Oldest supported gateway \| `0\.1\.0` \|/);
  assert.match(updated, /\| Newest tested gateway \| `0\.1\.2` \|/);
  // Regenerating an up-to-date README changes nothing, which is what --check relies on.
  assert.equal(replaceBlock(updated, block), updated);
});

test('a README without exactly one pair of markers is an error, not a silent no-op', () => {
  const block = renderBlock(deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2')] }));
  assert.throws(() => replaceBlock('# Title\n', block), /markers are missing/);
  assert.throws(() => replaceBlock(`${END}\n${BEGIN}\n`, block), /markers are missing or out of order/);
  assert.throws(() => replaceBlock(`${BEGIN}\n${END}\n${BEGIN}\n${END}\n`, block), /more than once/);
});

// --- the two scripts as CI and the sweep's pull requests run them -----------

test('--check holds the sdk field to backend/go.mod, and to nothing else', (t) => {
  const moved = movedPins(t);

  // Only the sdk field differs from go.mod: that is the whole invariant.
  const stale = run('gateway-range.mjs', '--check', '--pins', moved.sdkAxis);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /The sdk field must equal the SDK version in backend\/go\.mod/);
  assert.ok(stale.stderr.includes(`builds against ${sdkInGoMod()}`));
  // It must not send anyone to move the gateway pins as well: an SDK-only
  // change is a complete change (ADR 0006).
  assert.match(stale.stderr, /the gateway lanes are not involved/);
  assert.doesNotMatch(stale.stderr, /together/);

  // Deriving the range does not need the two files to agree; only --check does.
  assert.equal(run('gateway-range.mjs', '--pins', moved.sdkAxis).status, 0);

  // And a lane that moves on its own, with the SDK where it was, passes.
  const laneOnly = run('gateway-range.mjs', '--check', '--format', 'json', '--pins', moved.gatewayAxis);
  assert.equal(laneOnly.status, 0, laneOnly.stderr);
  assert.equal(JSON.parse(laneOnly.stdout).ceiling, moved.nextCeiling);
});

// Both of the sweep's pull requests move something the README block restates,
// so each has to regenerate the block or it can never pass the stale check.
// This is the whole of what it needs to run.
test('--write brings the README back in step after either axis moves the pins, and touches only its block', (t) => {
  const moved = movedPins(t);
  const original = readFileSync(README_PATH, 'utf8');
  const outside = (readme) => [readme.slice(0, readme.indexOf(BEGIN)), readme.slice(readme.indexOf(END))];

  for (const [pins, expected] of [
    [moved.gatewayAxis, `| Newest tested gateway | \`${moved.nextCeiling}\` |`],
    [moved.sdkAxis, `| OpenShell Go SDK | \`${moved.nextSdk}\` |`],
  ]) {
    const readme = join(tempDir(t), 'README.md');
    writeFileSync(readme, original);
    const readmeRange = (mode) => run('readme-gateway-range.mjs', mode, '--readme', readme, '--pins', pins);

    const before = readmeRange('--check');
    assert.equal(before.status, 1, 'the committed README is stale once the pins move');
    assert.match(before.stderr, /is stale/);
    assert.ok(before.stderr.includes(expected), 'and the check says what it should read');
    assert.equal(readFileSync(readme, 'utf8'), original, '--check never writes');

    assert.equal(readmeRange('--write').status, 0);
    assert.equal(readmeRange('--check').status, 0);

    const regenerated = readFileSync(readme, 'utf8');
    assert.ok(regenerated.includes(expected));
    assert.deepEqual(outside(regenerated), outside(original), 'nothing outside the markers changed');
    // A second --write is a no-op, so running it when nothing moved is harmless.
    assert.equal(readmeRange('--write').status, 0);
    assert.equal(readFileSync(readme, 'utf8'), regenerated);
  }
});
