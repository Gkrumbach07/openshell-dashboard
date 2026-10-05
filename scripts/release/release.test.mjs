// node --test "scripts/**/*.test.mjs"
//
// The release pipeline only runs for real on main, and its last step talks to a
// container registry. These tests cover the parts that decide things — what the
// notes say, what gets stamped, whether a release was cut, which tags move —
// with no network, no registry and no docker daemon: retag-image.sh is run
// against a stand-in `docker` that records what it was asked to do.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readGatewayRange } from '../gateway-range.mjs';
import { generateNotes, prepare, supportedGatewaysNotes } from './gateway-range-plugin.mjs';
import { releaseAt } from './released-version.mjs';
import { stampPackage } from './stamp-package.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SDK = 'v0.0.0-20260928030816-6648bd0c290e';
const range = { floor: '0.1.0', ceiling: '0.1.2', range: '>=0.1.0 <=0.1.2', sdk: SDK };

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openshell-dashboard-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// --- release notes ---------------------------------------------------------

test('the notes state the range and the SDK, and link the README of that release', () => {
  const notes = supportedGatewaysNotes({
    range,
    previous: range,
    previousTag: 'v1.1.0',
    readmeUrl: 'https://github.com/o/r/blob/v1.2.0/README.md#compatibility',
  });
  assert.match(notes, /^### Supported OpenShell gateways\n/);
  assert.match(notes, new RegExp(`\\*\\*0\\.1\\.0 – 0\\.1\\.2\\*\\*, built against OpenShell Go SDK \`${SDK}\``));
  assert.match(notes, /\[Compatibility\]\(https:\/\/github\.com\/o\/r\/blob\/v1\.2\.0\/README\.md#compatibility\)/);
  assert.doesNotMatch(notes, /range changed/);
});

test('a moved range is called out, because semver will not say so', () => {
  const notes = supportedGatewaysNotes({
    range,
    previous: { floor: '0.1.0', ceiling: '0.1.1' },
    previousTag: 'v1.1.0',
    readmeUrl: null,
  });
  assert.match(notes, /> \*\*The supported range changed in this release\.\*\* v1\.1\.0 supported 0\.1\.0 – 0\.1\.1\./);
});

test('nothing is claimed about a previous release whose range is unknown', () => {
  const notes = supportedGatewaysNotes({ range, previous: null, previousTag: 'v1.1.0', readmeUrl: null });
  assert.doesNotMatch(notes, /range changed/);
});

test('generateNotes reads the committed pins and tolerates a first release', async () => {
  const committed = readGatewayRange();
  const notes = await generateNotes(
    { pkgRoot: 'frontend' },
    { cwd: repoRoot, lastRelease: {}, nextRelease: { gitTag: 'v9.9.9', version: '9.9.9' } },
  );
  assert.ok(notes.includes(committed.floor) && notes.includes(committed.ceiling) && notes.includes(committed.sdk));
  assert.match(notes, /\/blob\/v9\.9\.9\/README\.md#compatibility\)/);
  // The URL comes from package.json, never from the credentialed push URL.
  assert.match(notes, /\(https:\/\/github\.com\/Gkrumbach07\/openshell-dashboard\/blob\//);
});

// --- package.json stamp ----------------------------------------------------

test('stamping adds the openshell field and changes nothing else', (t) => {
  const pkgPath = join(tempDir(t), 'package.json');
  const before = { name: 'openshell-dashboard', version: '0.0.0-semantically-released', files: ['dist'] };
  writeFileSync(pkgPath, `${JSON.stringify(before, null, 2)}\n`);

  stampPackage(pkgPath, range);

  const raw = readFileSync(pkgPath, 'utf8');
  assert.deepEqual(JSON.parse(raw), { ...before, openshell: { gateway: '>=0.1.0 <=0.1.2', sdk: SDK } });
  assert.ok(raw.endsWith('}\n'));
  // Stamping twice is the same as stamping once.
  stampPackage(pkgPath, range);
  assert.equal(readFileSync(pkgPath, 'utf8'), raw);
});

test('the prepare step stamps <pkgRoot>/package.json from the committed pins', async (t) => {
  const cwd = tempDir(t);
  writeFileSync(join(cwd, 'package.json'), '{\n  "name": "x"\n}\n');
  const logged = [];

  await prepare({ pkgRoot: '.' }, { cwd, logger: { log: (...args) => logged.push(args) } });

  const committed = readGatewayRange();
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).openshell, {
    gateway: committed.range,
    sdk: committed.sdk,
  });
  assert.equal(logged.length, 1);
});

// --- was a release cut? ----------------------------------------------------

test('no release tag at the commit means nothing to tag', () => {
  assert.equal(releaseAt([], ['v1.0.0', 'v1.1.0']), null);
  assert.equal(releaseAt(['some-other-tag', 'v1.2.0-beta.1'], ['v1.1.0']), null);
});

test('a release gets X.Y.Z, and X.Y when it is the newest patch of that minor', () => {
  assert.deepEqual(releaseAt(['v1.2.0'], ['v1.0.0', 'v1.1.0', 'v1.2.0']), {
    version: '1.2.0',
    tag: 'v1.2.0',
    imageTags: ['1.2.0', '1.2'],
  });
  assert.deepEqual(releaseAt(['v1.2.10'], ['v1.2.9', 'v1.2.10', 'v1.3.0', 'v2.0.0']).imageTags, ['1.2.10', '1.2']);
});

test('re-running for an older release does not pull X.Y back', () => {
  assert.deepEqual(releaseAt(['v1.2.0'], ['v1.2.0', 'v1.2.1']).imageTags, ['1.2.0']);
});

// --- retag by digest -------------------------------------------------------

const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE = 'quay.io/example/dashboard';
const have = (tool) => spawnSync(tool, ['--version'], { stdio: 'ignore' }).status === 0;
const canRunRetag = have('bash') && have('jq');

/** Runs scripts/retag-image.sh with a stand-in `docker` first on PATH. */
function retag(t, args, env = {}) {
  const dir = tempDir(t);
  const log = join(dir, 'docker.log');
  const docker = join(dir, 'docker');
  writeFileSync(
    docker,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, args.join(' ') + '\\n');
if (args[2] === 'inspect') {
  if (process.env.STUB_MISSING === '1') process.exit(1);
  const isSource = args[3].endsWith(':' + process.env.STUB_SOURCE_TAG);
  const digest = isSource ? process.env.STUB_DIGEST : process.env.STUB_PUSHED_DIGEST;
  process.stdout.write(JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', digest }));
}
`,
  );
  chmodSync(docker, 0o755);
  writeFileSync(log, '');

  const result = spawnSync(join(repoRoot, 'scripts', 'retag-image.sh'), args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      STUB_LOG: log,
      STUB_SOURCE_TAG: args[1] ?? '',
      STUB_DIGEST: DIGEST,
      STUB_PUSHED_DIGEST: DIGEST,
      ...env,
    },
  });
  return { ...result, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('retag points the new tags at the digest of the source tag, in one push', { skip: !canRunRetag }, (t) => {
  const { status, calls, stderr } = retag(t, [IMAGE, 'sha-0a1b2c3', '1.2.0', '1.2']);
  assert.equal(status, 0, stderr);
  assert.deepEqual(calls, [
    `buildx imagetools inspect ${IMAGE}:sha-0a1b2c3 --format {{json .Manifest}}`,
    `buildx imagetools create --tag ${IMAGE}:1.2.0 --tag ${IMAGE}:1.2 ${IMAGE}@${DIGEST}`,
    `buildx imagetools inspect ${IMAGE}:1.2.0 --format {{json .Manifest}}`,
    `buildx imagetools inspect ${IMAGE}:1.2 --format {{json .Manifest}}`,
  ]);
});

test('DRY_RUN=1 resolves the digest and prints the command without pushing', { skip: !canRunRetag }, (t) => {
  const { status, calls, stdout } = retag(t, [IMAGE, 'sha-0a1b2c3', 'latest'], { DRY_RUN: '1' });
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.ok(stdout.includes(`+ docker buildx imagetools create --tag ${IMAGE}:latest ${IMAGE}@${DIGEST}`));
});

test('an image CI never built is an error that says so', { skip: !canRunRetag }, (t) => {
  const { status, calls, stderr } = retag(t, [IMAGE, 'sha-0a1b2c3', '1.2.0'], { STUB_MISSING: '1' });
  assert.equal(status, 1);
  assert.equal(calls.length, 1, 'nothing is pushed');
  assert.match(stderr, /sha-0a1b2c3 is not in the registry/);
});

test('a new tag that does not carry the source digest fails the step', { skip: !canRunRetag }, (t) => {
  const { status, stderr } = retag(t, [IMAGE, 'sha-0a1b2c3', '1.2.0'], {
    STUB_PUSHED_DIGEST: `sha256:${'b'.repeat(64)}`,
  });
  assert.equal(status, 1);
  assert.match(stderr, /1\.2\.0 is sha256:b+, expected sha256:a+/);
});

test('retag refuses to run without a source and at least one new tag', { skip: !canRunRetag }, (t) => {
  const { status, calls } = retag(t, [IMAGE, 'sha-0a1b2c3']);
  assert.equal(status, 2);
  assert.equal(calls.length, 0);
});

// --- the detection script against a real repository ------------------------

test('released-version.mjs reports the release at HEAD, and nothing when there is none', (t) => {
  const repo = tempDir(t);
  // Under a git hook GIT_DIR and friends point at the real repository; without
  // this the throwaway commits and tags below would land there.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const identity = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
  const git = (...args) => execFileSync('git', [...identity, ...args], { cwd: repo, env, encoding: 'utf8' }).trim();
  const detect = () =>
    Object.fromEntries(
      execFileSync(process.execPath, [join(repoRoot, 'scripts', 'release', 'released-version.mjs')], {
        cwd: repo,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );

  git('init', '--quiet', '--initial-branch=main');
  git('commit', '--quiet', '--allow-empty', '-m', 'feat: one');
  git('tag', 'v1.0.0');
  git('commit', '--quiet', '--allow-empty', '-m', 'ci: two');
  const head = git('rev-parse', 'HEAD');

  assert.deepEqual(detect(), {
    version: '',
    git_tag: '',
    image_tags: '',
    source_tag: `sha-${head.slice(0, 7)}`,
    sha: head,
  });

  git('tag', 'v1.0.1');
  assert.deepEqual(detect(), {
    version: '1.0.1',
    git_tag: 'v1.0.1',
    image_tags: '1.0.1 1.0',
    source_tag: `sha-${head.slice(0, 7)}`,
    sha: head,
  });
});
