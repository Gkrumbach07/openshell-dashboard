#!/usr/bin/env node
// Is the checked-out commit a release, and which image tags does that earn?
//
// publish.yml runs this right after semantic-release, to decide whether the
// image CI built for this commit should also be tagged X.Y.Z and X.Y.
//
// The question it answers is "does a release tag point at this commit", not
// "did semantic-release just say it published". The tag is the one durable fact
// a release leaves in the repository, and asking the repository makes the step
// repeatable: if tagging the image fails after a release was cut, running the
// workflow again finds the same tag and finishes the job, where semantic-release
// itself would report "no release" the second time. When no release tag points
// here — nothing releasable was merged, or main had already moved on and
// semantic-release stood down — every output is empty and nothing gets tagged.
//
//   node scripts/release/released-version.mjs >> "$GITHUB_OUTPUT"
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// semantic-release's default tagFormat, for a plain release. A pre-release tag
// (v1.2.0-beta.1) must not move the X.Y image tag, so it does not match.
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function parse(tag) {
  const match = RELEASE_TAG.exec(tag);
  return match ? { tag, parts: match.slice(1).map(Number) } : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) {
      return a.parts[i] - b.parts[i];
    }
  }
  return 0;
}

/**
 * @param {string[]} tagsAtHead every tag pointing at the checked-out commit
 * @param {string[]} allTags    every tag in the repository
 * @returns {{version: string, tag: string, imageTags: string[]} | null}
 */
export function releaseAt(tagsAtHead, allTags) {
  const here = tagsAtHead.map(parse).filter(Boolean).sort(compare);
  if (here.length === 0) {
    return null;
  }
  const release = here[here.length - 1];
  const [major, minor] = release.parts;
  const version = release.parts.join('.');

  // X.Y means "the newest X.Y.z". Re-running the workflow for an older release
  // must not pull it back, so it only moves when this is the newest patch.
  const newestInMinor = allTags
    .map(parse)
    .filter((candidate) => candidate && candidate.parts[0] === major && candidate.parts[1] === minor)
    .sort(compare)
    .pop();
  const imageTags = [version];
  if (!newestInMinor || compare(newestInMinor, release) === 0) {
    imageTags.push(`${major}.${minor}`);
  }
  return { version, tag: release.tag, imageTags };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const sha = git('rev-parse', 'HEAD');
  const release = releaseAt(lines(git('tag', '--points-at', 'HEAD')), lines(git('tag', '--list')));

  if (release) {
    process.stderr.write(
      `${release.tag} points at ${sha}: its image gets the tags ${release.imageTags.join(', ')}\n`,
    );
  } else {
    process.stderr.write(`no release tag points at ${sha}: nothing to tag\n`);
  }

  process.stdout.write(
    [
      `version=${release?.version ?? ''}`,
      `git_tag=${release?.tag ?? ''}`,
      `image_tags=${release?.imageTags.join(' ') ?? ''}`,
      // The tag ci.yml's push-manifest job gave this commit's image.
      `source_tag=sha-${sha.slice(0, 7)}`,
      `sha=${sha}`,
      '',
    ].join('\n'),
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`released-version: ${error.message}\n`);
    process.exit(1);
  }
}
