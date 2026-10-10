// Run with: node --test "scripts/**/*.test.mjs"
//
// Releases are cut by hand, with a chosen type; the one automatic release is
// the merge of `next`, the move to a new OpenShell release. These tests cover
// the two pieces that decide that: release-type-plugin.mjs (what kind of
// release) and next-merge.mjs (whether a commit may be released without anyone
// asking).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mergedFromNext } from './next-merge.mjs';
import { analyzeCommits, compareChoice, suggest, suggestFor } from './release-type-plugin.mjs';

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
  merged_at: '2026-10-14T06:30:00Z',
  base: { ref: 'main' },
  head: { ref: 'next', repo: { full_name: REPO } },
  title: 'fix: move to OpenShell 0.1.4',
  ...overrides,
});

test('a commit merged from the next branch of this repository is the move to a new release', () => {
  assert.equal(mergedFromNext([pull()], REPO), true);
  // The title plays no part: it is what a person could type.
  assert.equal(mergedFromNext([pull({ title: 'anything at all' })], REPO), true);
});

test('anything else is not', () => {
  // An ordinary pull request, whatever it is titled.
  const ordinary = { head: { ref: 'fix/something', repo: { full_name: REPO } } };
  assert.equal(mergedFromNext([pull(ordinary)], REPO), false);
  assert.equal(mergedFromNext([pull({ ...ordinary, title: 'fix: move to OpenShell 0.1.4' })], REPO), false);
  // A branch whose name only starts with it, and the retired sweep's branches.
  for (const ref of ['next-steps', 'feature/next', 'compat-sweep/gateway', 'compat-sweep/sdk']) {
    assert.equal(mergedFromNext([pull({ head: { ref, repo: { full_name: REPO } } })], REPO), false, ref);
  }
  // A fork that named its branch next.
  assert.equal(
    mergedFromNext([pull({ head: { ref: 'next', repo: { full_name: 'someone/openshell-dashboard' } } })], REPO),
    false,
  );
  // A fork that has since been deleted.
  assert.equal(mergedFromNext([pull({ head: { ref: 'next', repo: null } })], REPO), false);
  // Not merged, or merged somewhere other than main.
  assert.equal(mergedFromNext([pull({ merged_at: null })], REPO), false);
  assert.equal(mergedFromNext([pull({ base: { ref: 'release/0.1' } })], REPO), false);
  assert.equal(mergedFromNext([pull({ base: { ref: '0.2.x' } })], REPO), false);
  // A commit pushed straight to main has no pull request.
  assert.equal(mergedFromNext([], REPO), false);
  // Two merged pull requests for one commit is not something to guess about.
  assert.equal(mergedFromNext([pull(), pull()], REPO), false);
});

test('a pull request into next is not released when it merges; only next into main is', () => {
  const intoNext = pull({ base: { ref: 'next' }, head: { ref: 'feat/needs-0.1.4', repo: { full_name: REPO } } });
  assert.equal(mergedFromNext([intoNext], REPO), false);
  // Should GitHub list both for a commit that reached main through next, the
  // one into next does not count against the one into main.
  assert.equal(mergedFromNext([intoNext, pull()], REPO), true);
});

test('the command prints where the commit came from in GITHUB_OUTPUT form, and exits 0 either way', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'next-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pulls = join(dir, 'pulls.json');
  const run = (list) => {
    writeFileSync(pulls, JSON.stringify(list));
    return spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/release/next-merge.mjs'), '--sha', 'a'.repeat(40), '--repo', REPO, '--pulls', pulls],
      { encoding: 'utf8' },
    );
  };
  const ordinary = run([pull({ head: { ref: 'feat/something', repo: { full_name: REPO } } })]);
  assert.equal(ordinary.status, 0);
  assert.equal(ordinary.stdout, 'from=\n');
  assert.match(ordinary.stderr, /was not merged from the next branch/);

  const fromNext = run([pull()]);
  assert.equal(fromNext.status, 0);
  assert.equal(fromNext.stdout, 'from=next\n');

  // publish.yml reads the answer with `sed -n 's/^from=//p'`.
  const read = (stdout) => stdout.replace(/^from=/m, '').trim();
  assert.equal(read(ordinary.stdout), '');
  assert.equal(read(fromNext.stdout), 'next');
});

test('the command needs a commit and a repository', () => {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/release/next-merge.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--sha <commit> and --repo <owner\/name> are required/);
});
