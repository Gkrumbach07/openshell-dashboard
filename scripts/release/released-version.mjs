#!/usr/bin/env node
// Is the checked-out commit a release, and which image tags does that earn?
//
// publish.yml runs this right after cut-release.mjs, to decide whether the
// image CI built for this commit should also be tagged X.Y.Z and X.Y.
//
// The question it answers is "does a release tag point at this commit", not
// "did the step before just say it released". The tag is the one durable fact
// a release leaves in the repository, and asking the repository makes the step
// repeatable: if tagging the image fails after a release was cut, running the
// workflow again finds the same tag and finishes the job, where cut-release.mjs
// reports "already released" the second time. When no release tag points here
// (a dry run, or a commit nobody asked to release) every output is empty and
// nothing gets tagged.
//
// Only a tag on the line this commit pins counts, as everywhere else: a
// release is numbered for the gateway release line its commit is built on
// (next-version.mjs), so a tag of another line on this commit is not this
// commit's release.
//
//   node scripts/release/released-version.mjs >> "$GITHUB_OUTPUT"
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PINS_FILE, readGatewayLine } from '../gateway-range.mjs';
import { compareReleases, parseReleaseTag } from './next-version.mjs';

/**
 * @param {string[]} tagsAtHead every tag pointing at the checked-out commit
 * @param {string[]} allTags    every tag in the repository
 * @param {string} line         the gateway release line this commit pins, such as "0.1"
 * @returns {{version: string, tag: string, imageTags: string[]} | null}
 */
export function releaseAt(tagsAtHead, allTags, line) {
  const onLine = (tags) =>
    tags
      .map(parseReleaseTag)
      .filter((release) => release && release.line === line)
      .sort(compareReleases);
  const here = onLine(tagsAtHead);
  if (here.length === 0) {
    return null;
  }
  const release = here[here.length - 1];

  // X.Y means "the newest X.Y.z". Re-running the workflow for an older release
  // must not pull it back, so it only moves when this is the newest patch.
  // That is also all that ever moves: a release moves its own line's tag, and
  // never another line's.
  const newestOnLine = onLine(allTags).pop();
  const imageTags = [release.version];
  if (!newestOnLine || compareReleases(newestOnLine, release) === 0) {
    imageTags.push(line);
  }
  return { version: release.version, tag: release.tag, imageTags };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const sha = git('rev-parse', 'HEAD');
  const { line } = readGatewayLine(join(git('rev-parse', '--show-toplevel'), PINS_FILE));
  const release = releaseAt(lines(git('tag', '--points-at', 'HEAD')), lines(git('tag', '--list')), line);

  if (release) {
    process.stderr.write(
      `${release.tag} points at ${sha}: its image gets the tags ${release.imageTags.join(', ')}\n`,
    );
  } else {
    process.stderr.write(`no release tag of the ${line} line points at ${sha}: nothing to tag\n`);
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
