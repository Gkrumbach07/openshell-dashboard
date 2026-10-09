// node --test "scripts/**/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LINE_CONSTANT,
  PINS_PATH,
  deriveGatewayLine,
  formatLine,
  lineInGoSource,
  lineOf,
  readGatewayLine,
  sdkInGoMod,
} from './gateway-range.mjs';
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
 * The committed pins after one of the changes a pull request makes to them.
 * Each returns the path of a scratch copy.
 */
function movedPins(t) {
  const dir = tempDir(t);
  const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
  const { tested } = deriveGatewayLine(pins);
  const newest = tested[tested.length - 1];
  const [major, minor, patch] = newest.split('.').map(Number);
  const nextPatch = `${major}.${minor}.${patch + 1}`;
  const nextMinor = `${major}.${minor + 1}.0`;
  const nextSdk = 'v0.0.0-20991231000000-0123456789ab';
  const write = (name, changed) => {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`);
    return path;
  };
  const withNewestAt = (version) => ({
    ...pins,
    lanes: pins.lanes.map((each) => (each.version === newest ? { ...each, version } : each)),
  });
  return {
    tested,
    nextPatch,
    nextMinor,
    nextSdk,
    // Gateway axis (ADR 0006): the newest lane moves to a newer patch release
    // of the same line, the SDK stays.
    gatewayAxis: write('gateway-axis.json', withNewestAt(nextPatch)),
    // The newest lane moves to the first release of the next minor line.
    nextLine: write('next-line.json', withNewestAt(nextMinor)),
    // SDK axis (ADR 0006): the `sdk` field moves (with go.mod), the lanes stay.
    sdkAxis: write('sdk-axis.json', { ...pins, sdk: nextSdk }),
  };
}

test('the line is the major.minor of the newest required lane, whatever their order', () => {
  const declared = deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.2'), lane('0.1.0')] });
  assert.deepEqual(declared, { line: '0.1', tested: ['0.1.0', '0.1.2'], sdk: SDK });
  assert.equal(formatLine(declared.line), '0.1.x');
  assert.equal(lineOf('0.1.2'), '0.1');
  assert.equal(lineOf('1.20.300'), '1.20');
});

test('versions compare as numbers, not as strings', () => {
  const declared = deriveGatewayLine({ sdk: SDK, lanes: [lane('0.9.0'), lane('0.10.0'), lane('0.2.11')] });
  assert.deepEqual(declared.tested, ['0.2.11', '0.9.0', '0.10.0']);
  assert.equal(declared.line, '0.10');
});

test('an advisory lane proves nothing, so it does not move the line or count as tested', () => {
  const declared = deriveGatewayLine({
    sdk: SDK,
    lanes: [lane('0.0.116', false), lane('0.1.0'), lane('0.1.2'), lane('0.2.0', false)],
  });
  assert.equal(declared.line, '0.1');
  assert.deepEqual(declared.tested, ['0.1.0', '0.1.2']);
});

test('a single required lane gives its line', () => {
  const declared = deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.2')] });
  assert.deepEqual(declared, { line: '0.1', tested: ['0.1.2'], sdk: SDK });
});

test('a required lane that is not a release is refused, not read as a line', () => {
  for (const version of ['dev', '0.1.3-dev.84', '0.1.3-pre.4', 'latest', 'v0.1.2', undefined]) {
    assert.throws(
      () => deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.0'), lane(version)] }),
      /not a gateway release/,
      `version ${version}`,
    );
  }
});

test('there is no line without a required lane, and no declaration without the SDK', () => {
  assert.throws(() => deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.2', false)] }), /no lane has "required": true/);
  assert.throws(() => deriveGatewayLine({ sdk: SDK }), /no lane has "required": true/);
  assert.throws(() => deriveGatewayLine({ lanes: [lane('0.1.2')] }), /"sdk" is missing/);
});

test('the committed pins give a line, and name the SDK that backend/go.mod builds against', () => {
  const declared = readGatewayLine();
  assert.match(declared.line, /^\d+\.\d+$/);
  assert.ok(declared.tested.every((release) => /^\d+\.\d+\.\d+$/.test(release)));
  assert.equal(declared.sdk, sdkInGoMod());
});

// The BFF has the line compiled in, so that an image knows it whatever built
// it. That constant restates the pins, and this is what holds it to them.
test('the line compiled into the BFF is the line the committed pins give', () => {
  assert.equal(lineInGoSource(), readGatewayLine().line);
});

test('the built-in line is read from its Go constant, and a source without one is an error', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'gateway_release_line.go');

  writeFileSync(source, `package models\n\n// A comment.\nconst ${LINE_CONSTANT} = "0.2"\n`);
  assert.equal(lineInGoSource(source), '0.2');

  // Renamed, or moved into a const block: the check must stop, not pass.
  writeFileSync(source, 'package models\n\nconst SomethingElse = "0.2"\n');
  assert.throws(() => lineInGoSource(source), /does not declare the built-in gateway release line/);
  writeFileSync(source, `package models\n\nconst (\n\t${LINE_CONSTANT} = "0.2"\n)\n`);
  assert.throws(() => lineInGoSource(source), /does not declare the built-in gateway release line/);
});

test('the README block is replaced in place and everything around it is kept', () => {
  const declared = deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.0'), lane('0.1.2')] });
  const block = renderBlock(declared);
  const readme = `# Title\n\nbefore\n\n${BEGIN}\nstale\n${END}\n\nafter\n`;

  const updated = replaceBlock(readme, block);
  assert.equal(updated, `# Title\n\nbefore\n\n${block}\n\nafter\n`);
  assert.match(updated, /\| Supported gateways \| `0\.1\.x` \|/);
  assert.match(updated, /\| Tested on \| `0\.1\.0`, `0\.1\.2` \|/);
  assert.ok(updated.includes(`| OpenShell Go SDK | \`${SDK}\` |`));
  // Regenerating an up-to-date README changes nothing, which is what --check relies on.
  assert.equal(replaceBlock(updated, block), updated);
});

test('a README without exactly one pair of markers is an error, not a silent no-op', () => {
  const block = renderBlock(deriveGatewayLine({ sdk: SDK, lanes: [lane('0.1.2')] }));
  assert.throws(() => replaceBlock('# Title\n', block), /markers are missing/);
  assert.throws(() => replaceBlock(`${END}\n${BEGIN}\n`, block), /markers are missing or out of order/);
  assert.throws(() => replaceBlock(`${BEGIN}\n${END}\n${BEGIN}\n${END}\n`, block), /more than once/);
});

// --- the two scripts as CI and the sweep's pull requests run them -----------

test('--check holds the sdk field to backend/go.mod', (t) => {
  const moved = movedPins(t);

  // Only the sdk field differs from go.mod.
  const stale = run('gateway-range.mjs', '--check', '--pins', moved.sdkAxis);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /The sdk field must equal the SDK version in backend\/go\.mod/);
  assert.ok(stale.stderr.includes(`builds against ${sdkInGoMod()}`));
  // It must not send anyone to move the gateway pins as well: an SDK-only
  // change is a complete change (ADR 0006).
  assert.match(stale.stderr, /the gateway lanes are not involved/);
  assert.doesNotMatch(stale.stderr, /together/);

  // Deriving the line does not need the two files to agree; only --check does.
  assert.equal(run('gateway-range.mjs', '--pins', moved.sdkAxis).status, 0);
});

test('--check holds the line compiled into the BFF to the newest required lane', (t) => {
  const moved = movedPins(t);
  const built = lineInGoSource();

  // A lane that moves to a newer patch of the same line changes nothing the
  // BFF has compiled in, so it passes on its own.
  const patch = run('gateway-range.mjs', '--check', '--format', 'json', '--pins', moved.gatewayAxis);
  assert.equal(patch.status, 0, patch.stderr);
  assert.deepEqual(JSON.parse(patch.stdout).tested, [...moved.tested.slice(0, -1), moved.nextPatch]);
  assert.equal(JSON.parse(patch.stdout).line, built);

  // A lane that moves to the next minor is a new line, and the constant has to
  // move in the same change. The message says what to do, both ways round.
  const minor = run('gateway-range.mjs', '--check', '--pins', moved.nextLine);
  assert.equal(minor.status, 1);
  assert.ok(minor.stderr.includes(`${LINE_CONSTANT} = "${built}"`), minor.stderr);
  assert.ok(minor.stderr.includes(`gateway ${moved.nextMinor}, which is release line ${lineOf(moved.nextMinor)}`));
  assert.ok(minor.stderr.includes(`set ${LINE_CONSTANT} = "${lineOf(moved.nextMinor)}"`));
  assert.match(minor.stderr, /backend\/pkg\/models\/gateway_release_line\.go/);
  assert.match(minor.stderr, /If the lane moved by mistake, move it back/);

  // Without --check the script only derives, so the same pins print their line.
  const derived = run('gateway-range.mjs', '--format', 'github', '--pins', moved.nextLine);
  assert.equal(derived.status, 0, derived.stderr);
  assert.ok(derived.stdout.startsWith(`line=${lineOf(moved.nextMinor)}\n`));
});

test('--format github prints the outputs the build job reads', () => {
  const declared = readGatewayLine();
  const printed = run('gateway-range.mjs', '--format', 'github');
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, `line=${declared.line}\ntested=${declared.tested.join(',')}\nsdk=${declared.sdk}\n`);
});

// Both of the sweep's pull requests move something the README block restates,
// so each has to regenerate the block or it can never pass the stale check.
// This is the whole of what it needs to run.
test('--write brings the README back in step after either axis moves the pins, and touches only its block', (t) => {
  const moved = movedPins(t);
  const original = readFileSync(README_PATH, 'utf8');
  const outside = (readme) => [readme.slice(0, readme.indexOf(BEGIN)), readme.slice(readme.indexOf(END))];
  const tested = [...moved.tested.slice(0, -1), moved.nextPatch].map((release) => `\`${release}\``).join(', ');

  for (const [pins, expected] of [
    [moved.gatewayAxis, `| Tested on | ${tested} |`],
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
