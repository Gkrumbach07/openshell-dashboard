// What the notes of a release say.
//
// Two parts, in this order:
//
//   the changes   the title of every commit since the previous release, as it
//                 was merged. With a squash merge that is the pull request's
//                 title, which is why CONTRIBUTING.md asks for titles to be
//                 written with care. Commits about CI are left out.
//   the gateways  a "Supported OpenShell gateways" section: the gateway
//                 release line the release is for, the gateway release it is
//                 built on and tested against, and the SDK.
//
// cut-release.mjs reads the repository and calls releaseNotes(). The line
// comes from scripts/gateway-range.mjs at release time, so the claim is the
// one the compat job proved for the commit being released.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { PINS_FILE, deriveGatewayLine, formatLine, lineOfLanes } from '../gateway-range.mjs';

const HEADER = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?!?: /;
const CI = 'ci';

/**
 * Is this commit about CI, going by its title: `ci: …`, or any type with the
 * scope `ci`?
 *
 * Such a commit is left out of the notes. A change to a workflow, or to the
 * scripts CI and the release pipeline run, alters nothing in the image, so
 * listing it would tell a reader of the notes something about the release
 * that is not true.
 */
export function isCiCommit(subject) {
  const header = HEADER.exec(subject)?.groups;
  return Boolean(header) && (header.type === CI || header.scope === CI);
}

/**
 * The line a pins document declares, in either shape the file has had: one
 * pinned release, or (before 2026-10-09) a list of lanes. Null when it is
 * neither.
 */
export function lineDeclaredBy(pins) {
  try {
    return deriveGatewayLine(pins).line;
  } catch {
    return lineOfLanes(pins);
  }
}

/**
 * What the commit a tag points at declared, or null when it cannot be known:
 * no such tag, or a commit from before the pins named releases.
 */
export function declaredAtTag(tag, cwd) {
  if (!tag) {
    return null;
  }
  try {
    const pins = execFileSync('git', ['show', `${tag}:${PINS_FILE}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = lineDeclaredBy(JSON.parse(pins));
    return line ? { line } : null;
  } catch {
    return null;
  }
}

/** https://github.com/owner/repo, from package.json rather than from the (credentialed) push URL. */
export function repositoryUrl(pkgPath) {
  try {
    const { repository } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const url = typeof repository === 'string' ? repository : repository?.url;
    return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * The changes in a release: one line per commit since the previous release,
 * oldest first, each with the title it was merged under.
 *
 * Without a previous release there is nothing to compare with, and the whole
 * history is not a list of changes anybody can read, so a fixed sentence says
 * so instead.
 *
 * @param {object} input
 * @param {{sha: string, subject: string}[]} input.commits  every commit since the previous release, oldest first
 * @param {string | null} input.previousTag                  the previous release, or null when there is none
 * @param {string} input.tag                                 the release being cut
 * @param {string | null} input.repoUrl                      https://github.com/owner/repo, for links
 */
export function changesNotes({ commits, previousTag, tag, repoUrl }) {
  if (!previousTag) {
    return [
      '### Changes',
      '',
      'No earlier release exists to compare this one with, so its changes are not listed.',
    ].join('\n');
  }

  const lines = [`### Changes since ${previousTag}`, ''];
  const listed = commits.filter((commit) => !isCiCommit(commit.subject));
  if (commits.length === 0) {
    lines.push(`No commits since ${previousTag}.`);
  } else if (listed.length === 0) {
    lines.push(`Nothing is listed: every commit since ${previousTag} is about CI.`);
  } else {
    for (const { sha, subject } of listed) {
      const short = sha.slice(0, 7);
      lines.push(`- ${subject} (${repoUrl ? `[${short}](${repoUrl}/commit/${sha})` : short})`);
    }
  }
  if (repoUrl) {
    lines.push('', `[Everything between ${previousTag} and ${tag}](${repoUrl}/compare/${previousTag}...${tag})`);
  }
  return lines.join('\n');
}

export function supportedGatewaysNotes({ declared, previous, previousTag, readmeUrl }) {
  const lines = [
    '### Supported OpenShell gateways',
    '',
    `**${formatLine(declared.line)}**, tested on ${declared.release}, ` +
      `built against OpenShell Go SDK \`${declared.sdk}\`.`,
    '',
  ];

  // Moving to another line breaks a running installation that stays on the old
  // one, so a change is called out rather than left to a diff of two release
  // pages.
  if (previous && previous.line !== declared.line) {
    lines.push(
      `> **The supported gateway release line changed in this release.** ${previousTag} supported ${formatLine(previous.line)}.`,
      '',
    );
  }

  const compatibility = readmeUrl ? `[Compatibility](${readmeUrl})` : 'Compatibility in the README';
  lines.push(
    `This release is for the gateway ${formatLine(declared.line)} release line: any patch release of ` +
      'it, and any pre-release or rebuild of one. The release named above is the one this commit ' +
      'is built on and passed the compatibility suite against. A gateway on another release line is not supported ' +
      `by this release; see ${compatibility} for which dashboard to run instead.`,
  );
  return lines.join('\n');
}

/**
 * The whole body of a release.
 *
 * @param {object} input
 * @param {string} input.tag                                 the release being cut, such as "v0.1.4"
 * @param {string | null} input.previousTag                  the previous release in this commit's history
 * @param {{sha: string, subject: string}[]} input.commits   every commit since it, oldest first
 * @param {{line: string, release: string, sdk: string}} input.declared  what this commit's pins declare
 * @param {{line: string} | null} input.previous             what the previous release declared, when that is known
 * @param {string | null} input.repoUrl                      https://github.com/owner/repo, for links
 */
export function releaseNotes({ tag, previousTag, commits, declared, previous, repoUrl }) {
  return [
    changesNotes({ commits, previousTag, tag, repoUrl }),
    '',
    supportedGatewaysNotes({
      declared,
      previous,
      previousTag,
      // Link the README as of this release: its Compatibility section states the
      // same line, and stays right for this version after main has moved on.
      readmeUrl: repoUrl ? `${repoUrl}/blob/${tag}/README.md#compatibility` : null,
    }),
    '',
  ].join('\n');
}
