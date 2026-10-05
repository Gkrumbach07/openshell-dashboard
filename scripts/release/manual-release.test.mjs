// Run with: node --test "scripts/**/*.test.mjs"
//
// Releases are cut by hand, with a chosen type; the one automatic release is a
// merged compat-sweep bump. These tests cover the two pieces that decide that:
// release-type-plugin.mjs (what kind of release) and sweep-bump.mjs (whether a
// commit may be released without anyone asking).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeCommits, compareChoice, suggest, suggestFor } from './release-type-plugin.mjs';
import { leavesItsAxis, sweepAxis } from './sweep-bump.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { log() {}, warn() {}, error() {}, success() {} };
const commit = (message) => ({ hash: 'x'.repeat(40), message });

// ---- what kind of release ---------------------------------------------------

test('the chosen type is released, whatever the commits suggest', async () => {
  const breaking = [commit('feat!: drop the old props'), commit('fix: a typo')];
  for (const type of ['patch', 'minor', 'major']) {
    assert.equal(await analyzeCommits({}, { commits: breaking, env: { RELEASE_TYPE: type }, logger: quiet }), type);
  }
  // And the other way round: a major can be chosen when no title asks for one.
  const quietCommits = [commit('docs: reword'), commit('Add foo (#74)')];
  assert.equal(
    await analyzeCommits({}, { commits: quietCommits, env: { RELEASE_TYPE: 'major' }, logger: quiet }),
    'major',
  );
});

test('running without a chosen type is an error, not a default', async () => {
  for (const env of [{}, { RELEASE_TYPE: '' }, { RELEASE_TYPE: '(choose one)' }, { RELEASE_TYPE: 'MINOR' }]) {
    await assert.rejects(
      analyzeCommits({}, { commits: [commit('feat: x')], env, logger: quiet }),
      /RELEASE_TYPE must be one of patch, minor, major/,
    );
  }
});

test('with no commits since the last release there is nothing to release', async () => {
  assert.equal(await analyzeCommits({}, { commits: [], env: { RELEASE_TYPE: 'patch' }, logger: quiet }), null);
});

test('what the commits suggest: the largest of them, and nothing from CI commits', () => {
  assert.equal(suggest([commit('fix: a'), commit('feat: b'), commit('docs: c')]), 'minor');
  assert.equal(suggest([commit('fix: a'), commit('fix(bff)!: b')]), 'major');
  assert.equal(suggest([commit('ci!: a'), commit('feat(ci): b'), commit('chore: c')]), null);
  assert.equal(suggest([]), null);
  assert.equal(suggestFor('fix: x\n\nBREAKING CHANGE: y'), 'major');
  assert.equal(suggestFor('Revert "feat: x"\n\nThis reverts commit abc.'), 'patch');
});

test('a choice smaller than the commits suggest is the one that gets flagged', () => {
  assert.equal(compareChoice('patch', 'major').smaller, true);
  assert.match(compareChoice('patch', 'major').text, /LARGER than the patch that was chosen/);
  assert.equal(compareChoice('minor', 'minor').smaller, false);
  assert.equal(compareChoice('major', 'patch').smaller, false);
  assert.equal(compareChoice('patch', null).smaller, false);
});

test('the choice and the comparison are written to the run summary', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'release-type-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  await analyzeCommits(
    {},
    { commits: [commit('feat: x')], env: { RELEASE_TYPE: 'patch', GITHUB_STEP_SUMMARY: summary }, logger: quiet },
  );
  const written = readFileSync(summary, 'utf8');
  assert.match(written, /Release type chosen: `patch`/);
  assert.match(written, /suggest a minor release, which is LARGER/);
});

// ---- which commit may release without being asked ---------------------------

const REPO = 'Gkrumbach07/openshell-dashboard';
const pull = (overrides = {}) => ({
  merged_at: '2026-10-06T06:30:00Z',
  base: { ref: 'main' },
  head: { ref: 'compat-sweep/gateway', repo: { full_name: REPO } },
  ...overrides,
});

test('a commit merged from the sweep branch of this repository names its axis', () => {
  assert.equal(sweepAxis([pull()], REPO), 'gateway');
  assert.equal(sweepAxis([pull({ head: { ref: 'compat-sweep/sdk', repo: { full_name: REPO } } })], REPO), 'sdk');
});

test('anything else is not a sweep bump', () => {
  // An ordinary pull request, whatever it is titled.
  assert.equal(sweepAxis([pull({ head: { ref: 'fix/something', repo: { full_name: REPO } } })], REPO), null);
  // A fork that named its branch after the sweep's.
  assert.equal(
    sweepAxis([pull({ head: { ref: 'compat-sweep/gateway', repo: { full_name: 'someone/openshell-dashboard' } } })], REPO),
    null,
  );
  // A fork that has since been deleted.
  assert.equal(sweepAxis([pull({ head: { ref: 'compat-sweep/gateway', repo: null } })], REPO), null);
  // Not merged, or merged somewhere other than main.
  assert.equal(sweepAxis([pull({ merged_at: null })], REPO), null);
  assert.equal(sweepAxis([pull({ base: { ref: '0.2.x' } })], REPO), null);
  // A commit pushed straight to main has no pull request.
  assert.equal(sweepAxis([], REPO), null);
  // Two merged pull requests for one commit is not something to guess about.
  assert.equal(sweepAxis([pull(), pull()], REPO), null);
});

// The guard is the sweep's own (deploy/ci/sweep/guard.py), so this builds a
// small repository that has it and commits to that.
const have = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

function repositoryWithTheGuard(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-bump-repo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    }).trim();
  mkdirSync(join(dir, 'deploy/ci'), { recursive: true });
  mkdirSync(join(dir, 'backend'), { recursive: true });
  cpSync(join(repoRoot, 'deploy/ci/sweep'), join(dir, 'deploy/ci/sweep'), { recursive: true });
  for (const file of ['deploy/ci/gateway-pins.json', 'backend/go.mod', 'backend/go.sum']) {
    cpSync(join(repoRoot, file), join(dir, file));
  }
  writeFileSync(join(dir, 'unrelated.txt'), 'one\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  return { dir, git };
}

/** Moves the SDK pin the way the sdk axis does: go.mod and the pins' sdk field, together. */
function moveTheSdk(dir) {
  const pinsPath = join(dir, 'deploy/ci/gateway-pins.json');
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
  const next = 'v0.0.0-20261005140000-07a05f856a09';
  const goModPath = join(dir, 'backend/go.mod');
  writeFileSync(goModPath, readFileSync(goModPath, 'utf8').replace(pins.sdk, next));
  writeFileSync(pinsPath, readFileSync(pinsPath, 'utf8').replace(pins.sdk, next));
}

test('a merged commit that stays on its axis passes the sweep guard', { skip: !have('python3') }, (t) => {
  const { dir, git } = repositoryWithTheGuard(t);
  moveTheSdk(dir);
  git('add', '-A');
  git('commit', '-q', '-m', 'fix(sdk): move to the OpenShell SDK at v0.1.3');
  assert.equal(leavesItsAxis(git('rev-parse', 'HEAD'), 'sdk', dir), null);
  // The scratch worktree is gone and the repository is where it was.
  assert.equal(git('worktree', 'list').split('\n').length, 1);
  assert.equal(git('status', '--short'), '');
});

test('the same commit with one more file in it does not', { skip: !have('python3') }, (t) => {
  const { dir, git } = repositoryWithTheGuard(t);
  moveTheSdk(dir);
  writeFileSync(join(dir, 'unrelated.txt'), 'two\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'fix(sdk): move to the OpenShell SDK at v0.1.3');
  const problem = leavesItsAxis(git('rev-parse', 'HEAD'), 'sdk', dir);
  assert.match(problem, /unrelated\.txt/);
});

test('an SDK move is not a gateway-axis change', { skip: !have('python3') }, (t) => {
  const { dir, git } = repositoryWithTheGuard(t);
  moveTheSdk(dir);
  git('add', '-A');
  git('commit', '-q', '-m', 'fix(compat): support gateway 0.1.3');
  assert.match(leavesItsAxis(git('rev-parse', 'HEAD'), 'gateway', dir), /one-axis guard \(gateway\)/);
});

test('the command prints an empty axis for an ordinary commit and exits 0', { skip: !have('python3') }, (t) => {
  const { dir, git } = repositoryWithTheGuard(t);
  writeFileSync(join(dir, 'unrelated.txt'), 'two\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: something');
  const pulls = join(dir, '..', `pulls-${process.pid}.json`);
  t.after(() => rmSync(pulls, { force: true }));
  const run = (list) => {
    writeFileSync(pulls, JSON.stringify(list));
    return spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/release/sweep-bump.mjs'), '--sha', git('rev-parse', 'HEAD'), '--repo', REPO, '--pulls', pulls],
      { cwd: dir, encoding: 'utf8' },
    );
  };
  const ordinary = run([pull({ head: { ref: 'feat/something', repo: { full_name: REPO } } })]);
  assert.equal(ordinary.status, 0);
  assert.equal(ordinary.stdout, 'axis=\n');
  // From the sweep's branch, but changing something the axis may not: still
  // not automatic, and it says why.
  const widened = run([pull()]);
  assert.equal(widened.status, 0);
  assert.equal(widened.stdout, 'axis=\n');
  assert.match(widened.stderr, /changes more than that axis may/);
});
