// semantic-release plugin: every release says which OpenShell gateways it supports.
//
// Loaded by release.config.cjs. It adds one step to a release:
//
//   generateNotes  appends a "Supported OpenShell gateways" section to the
//                  notes, which is what the GitHub release is published with
//
// It takes the gateway release line from scripts/gateway-range.mjs at release
// time, so the claim is the one the required compat lanes proved for the
// commit being released. The step does not run unless a release is actually
// being cut, and it runs before semantic-release creates the tag: if the pins
// cannot be turned into a line, the release stops before anything is
// published.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PINS_FILE, deriveGatewayLine, formatLine, readGatewayLine } from '../gateway-range.mjs';

/**
 * What a previous release declared, or null when it cannot be known —
 * no previous release, or a release from before the lanes were releases.
 */
function declaredAtTag(tag, cwd) {
  if (!tag) {
    return null;
  }
  try {
    const pins = execFileSync('git', ['show', `${tag}:${PINS_FILE}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return deriveGatewayLine(JSON.parse(pins));
  } catch {
    return null;
  }
}

/** https://github.com/owner/repo, from package.json rather than from the (credentialed) push URL. */
function repositoryUrl(pkgPath) {
  try {
    const { repository } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const url = typeof repository === 'string' ? repository : repository?.url;
    return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

/** "0.1.0", "0.1.0 and 0.1.3", "0.1.0, 0.1.2 and 0.1.3". */
function listReleases(releases) {
  if (releases.length <= 1) {
    return releases.join('');
  }
  return `${releases.slice(0, -1).join(', ')} and ${releases[releases.length - 1]}`;
}

export function supportedGatewaysNotes({ declared, previous, previousTag, readmeUrl }) {
  const lines = [
    '### Supported OpenShell gateways',
    '',
    `**${formatLine(declared.line)}**, tested on ${listReleases(declared.tested)}, ` +
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
      'it, and any pre-release or rebuild of one. The releases named above are the ones this commit ' +
      'passed the compatibility suite against. A gateway on another release line is not supported ' +
      `by this release; see ${compatibility} for which dashboard to run instead.`,
  );
  return lines.join('\n');
}

export async function generateNotes(pluginConfig, context) {
  const { cwd, lastRelease, nextRelease } = context;
  const repo = repositoryUrl(join(cwd, pluginConfig.pkgRoot ?? '.', 'package.json'));
  return supportedGatewaysNotes({
    declared: readGatewayLine(),
    previous: declaredAtTag(lastRelease?.gitTag, cwd),
    previousTag: lastRelease?.gitTag,
    // Link the README as of this release: its Compatibility section states the
    // same line, and stays right for this version after main has moved on.
    readmeUrl: repo && nextRelease?.gitTag ? `${repo}/blob/${nextRelease.gitTag}/README.md#compatibility` : null,
  });
}
