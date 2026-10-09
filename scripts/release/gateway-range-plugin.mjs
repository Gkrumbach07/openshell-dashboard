// semantic-release plugin: every release says which OpenShell gateways it supports.
//
// Loaded by release.config.cjs. It adds one step to a release:
//
//   generateNotes  appends a "Supported OpenShell gateways" section to the
//                  notes, which is what the GitHub release is published with
//
// It takes the range from scripts/gateway-range.mjs at release time, so the
// claim is the one the required compat lanes proved for the commit being
// released. The step does not run unless a release is actually being cut, and
// it runs before semantic-release creates the tag: if the pins cannot be turned
// into a range, the release stops before anything is published.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PINS_FILE,
  deriveGatewayRange,
  formatRange,
  readGatewayRange,
} from '../gateway-range.mjs';

/**
 * The range a previous release declared, or null when it cannot be known —
 * no previous release, or a release from before the lanes were releases.
 */
function rangeAtTag(tag, cwd) {
  if (!tag) {
    return null;
  }
  try {
    const pins = execFileSync('git', ['show', `${tag}:${PINS_FILE}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return deriveGatewayRange(JSON.parse(pins));
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

export function supportedGatewaysNotes({ range, previous, previousTag, readmeUrl }) {
  const lines = [
    '### Supported OpenShell gateways',
    '',
    `**${formatRange(range)}**, built against OpenShell Go SDK \`${range.sdk}\`.`,
    '',
  ];

  // The version number does not describe the gateway a deployment needs:
  // moving the range can break a running installation in a patch release
  // (ADR 0005). So a change is called out rather than left to a diff of two
  // release pages.
  if (previous && (previous.floor !== range.floor || previous.ceiling !== range.ceiling)) {
    lines.push(
      `> **The supported range changed in this release.** ${previousTag} supported ${formatRange(previous)}.`,
      '',
    );
  }

  const compatibility = readmeUrl ? `[Compatibility](${readmeUrl})` : 'Compatibility in the README';
  lines.push(
    'These are the oldest and newest gateway releases this commit passed the ' +
      'compatibility suite against. A gateway outside the range is not supported ' +
      `by this release; see ${compatibility} for which dashboard to run instead.`,
  );
  return lines.join('\n');
}

export async function generateNotes(pluginConfig, context) {
  const { cwd, lastRelease, nextRelease } = context;
  const repo = repositoryUrl(join(cwd, pluginConfig.pkgRoot ?? '.', 'package.json'));
  return supportedGatewaysNotes({
    range: readGatewayRange(),
    previous: rangeAtTag(lastRelease?.gitTag, cwd),
    previousTag: lastRelease?.gitTag,
    // Link the README as of this release: its Compatibility section states the
    // same range, and stays right for this version after main has moved on.
    readmeUrl: repo && nextRelease?.gitTag ? `${repo}/blob/${nextRelease.gitTag}/README.md#compatibility` : null,
  });
}
