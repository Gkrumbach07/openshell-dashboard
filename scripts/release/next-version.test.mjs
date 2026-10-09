// node --test "scripts/**/*.test.mjs"
//
// The version of a release is computed (ADR 0009): the line of the pinned
// OpenShell release, then one more than the highest patch tagged on that
// line. These tests are the arithmetic alone; cut-release.test.mjs runs it
// against repositories.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareReleases, nextVersion, parseReleaseTag } from './next-version.mjs';

const version = (pinned, tags) => nextVersion({ pinned, tags }).version;

test('a line with no release tag starts at .0', () => {
  assert.equal(version('0.1.3', []), '0.1.0');
  // The gateway's own patch number plays no part: only its line does.
  assert.equal(version('0.1.0', []), '0.1.0');
  assert.equal(version('0.1.27', []), '0.1.0');
  assert.deepEqual(nextVersion({ pinned: '0.1.3', tags: [] }), {
    line: '0.1',
    version: '0.1.0',
    tag: 'v0.1.0',
    counted: [],
    otherLines: [],
    notReleases: [],
  });
});

test('tags on the line give the next patch', () => {
  assert.equal(version('0.1.3', ['v0.1.0']), '0.1.1');
  assert.equal(version('0.1.3', ['v0.1.0', 'v0.1.1', 'v0.1.2']), '0.1.3');
  // In whatever order the repository lists them, and numerically: 10 is after 9.
  assert.equal(version('0.1.3', ['v0.1.10', 'v0.1.9', 'v0.1.2']), '0.1.11');
});

test('a gap is not filled: the next patch is one more than the highest', () => {
  const next = nextVersion({ pinned: '0.1.3', tags: ['v0.1.0', 'v0.1.2'] });
  assert.equal(next.version, '0.1.3');
  assert.deepEqual(next.counted, ['v0.1.0', 'v0.1.2']);
});

test('the first release after the pin moves to a new minor is X.Y.0, with no special case', () => {
  const tags = ['v0.1.0', 'v0.1.1', 'v0.1.2'];
  assert.equal(version('0.1.4', tags), '0.1.3');
  const moved = nextVersion({ pinned: '0.2.0', tags });
  assert.equal(moved.version, '0.2.0');
  assert.deepEqual(moved.counted, []);
  assert.deepEqual(moved.otherLines, tags);
  // And the one after it is the next patch of the new line.
  assert.equal(version('0.2.0', [...tags, 'v0.2.0']), '0.2.1');
  assert.equal(version('1.0.0', [...tags, 'v0.2.0']), '1.0.0');
});

test('tags on other lines are ignored, older or newer', () => {
  const next = nextVersion({ pinned: '0.2.1', tags: ['v0.1.7', 'v0.2.0', 'v0.3.0', 'v1.4.2', 'v0.20.5'] });
  assert.equal(next.version, '0.2.1');
  assert.deepEqual(next.counted, ['v0.2.0']);
  // 0.20 is not 0.2: a line is two whole numbers, not a prefix.
  assert.deepEqual(next.otherLines, ['v0.1.7', 'v0.3.0', 'v0.20.5', 'v1.4.2']);
});

test('a release branch gets the next patch of its own line while main is on the next', () => {
  const tags = ['v0.1.0', 'v0.1.1', 'v0.2.0', 'v0.2.1'];
  assert.equal(version('0.1.5', tags), '0.1.2');
  assert.equal(version('0.2.0', tags), '0.2.2');
});

test('tags that are not release tags are ignored', () => {
  const tags = [
    'v0.1.0',
    'v0.1.5-beta.1', // a pre-release
    'v0.1.6+build.3', // build metadata
    '0.1.7', // no v
    'v0.1', // not three numbers
    'v0.1.8.1',
    'v0.01.9', // a leading zero is not a number semver writes
    'release-0.1.9',
    'helm-chart-0.1.9',
    'latest',
  ];
  const next = nextVersion({ pinned: '0.1.3', tags });
  assert.equal(next.version, '0.1.1');
  assert.deepEqual(next.counted, ['v0.1.0']);
  assert.equal(next.notReleases.length, tags.length - 1);
});

test('a pre-release pin never releases', () => {
  for (const pinned of ['0.1.4-pre.2', '0.2.0-pre.1']) {
    assert.throws(
      () => nextVersion({ pinned, tags: ['v0.1.0'] }),
      (error) => error.message.includes(`pins OpenShell ${pinned}, a pre-release`) && /Nothing is released/.test(error.message),
    );
  }
});

test('anything else that is not a stable release is refused too', () => {
  for (const pinned of [undefined, null, '', 'dev', '0.1', 'v0.1.3', '0.1.3-dev.84', '0.1.3-rc.1', '0.1.x']) {
    assert.throws(() => nextVersion({ pinned, tags: [] }), /is not a stable OpenShell release/, String(pinned));
  }
});

// The repository as it stood on 2026-10-09: tags from before releases were
// numbered by gateway release line. They are not removed by anything here.
const OLD_TAGS = ['v0.1.3', 'v0.2.0', 'v0.3.0', 'v1.0.0', 'v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.1.0', 'v1.1.1', 'v1.2.0'];

test('the old tags: v0.1.3 collides with the 0.1 line and is counted; the rest are not', () => {
  const next = nextVersion({ pinned: '0.1.3', tags: OLD_TAGS });
  assert.equal(next.version, '0.1.4');
  // Returned so the run can say so: this is how a wrong number is seen.
  assert.deepEqual(next.counted, ['v0.1.3']);
  assert.deepEqual(next.otherLines, OLD_TAGS.slice(1));
});

test('with the old tags deleted the first release is 0.1.0', () => {
  assert.equal(version('0.1.3', []), '0.1.0');
  // The other old tags would collide later, as the gateway reaches their lines.
  assert.equal(version('0.2.0', OLD_TAGS), '0.2.1');
  assert.equal(version('1.2.0', OLD_TAGS), '1.2.1');
});

test('parseReleaseTag reads a release tag and nothing else', () => {
  assert.deepEqual(parseReleaseTag('v0.1.3'), {
    tag: 'v0.1.3',
    major: 0,
    minor: 1,
    patch: 3,
    line: '0.1',
    version: '0.1.3',
  });
  assert.equal(parseReleaseTag('v1.2.0-beta.1'), null);
  assert.equal(parseReleaseTag('1.2.0'), null);
  const sorted = ['v1.2.0', 'v0.1.10', 'v0.1.9', 'v0.2.0'].map(parseReleaseTag).sort(compareReleases);
  assert.deepEqual(sorted.map((release) => release.tag), ['v0.1.9', 'v0.1.10', 'v0.2.0', 'v1.2.0']);
});
