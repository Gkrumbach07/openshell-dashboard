#!/usr/bin/env node
// Is this commit a merged compat-sweep bump, and nothing more?
//
// Releases are cut by hand (see release-type-plugin.mjs), with one exception:
// a pull request the compat sweep opened to raise the gateway ceiling or to
// move the SDK. Its whole purpose is to change what the next release declares
// and contains, it is always a patch, and it is the release most likely to be
// forgotten. So publish.yml releases it by itself once it is merged and CI has
// passed on main.
//
// "It is a sweep bump" has to be established from where the commit came from,
// not from what it is called. A title can be typed by anyone. This asks two
// questions that cannot be answered by typing:
//
//   1. Was the commit merged from the sweep's own branch in THIS repository
//      (compat-sweep/gateway or compat-sweep/sdk), into main?
//   2. Does it change only what that axis may change? That is the sweep's own
//      one-axis guard (deploy/ci/sweep/guard.py), run again on the merged
//      commit, so a pull request that someone added other changes to is not
//      released automatically. It can still be released by hand.
//
// Prints `axis=gateway`, `axis=sdk` or `axis=` in GITHUB_OUTPUT form. An empty
// axis is the ordinary answer and is not an error.
//
//   GH_TOKEN=... node scripts/release/sweep-bump.mjs --sha <commit> --repo owner/name
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The branches deploy/ci/sweep/report.py pushes to.
export const SWEEP_BRANCHES = { 'compat-sweep/gateway': 'gateway', 'compat-sweep/sdk': 'sdk' };

/**
 * The axis of the sweep pull request this commit was merged from, or null.
 *
 * @param {object[]} pulls the pull requests GitHub associates with the commit
 *                         (GET /repos/{repo}/commits/{sha}/pulls)
 * @param {string} repo    owner/name of this repository
 */
export function sweepAxis(pulls, repo) {
  const merged = pulls.filter((pull) => pull?.merged_at && pull.base?.ref === 'main');
  // One commit, one pull request. Anything else is not a squash-merged sweep
  // bump, and "not sure" must mean "not automatic".
  if (merged.length !== 1) {
    return null;
  }
  const [{ head }] = merged;
  // A fork can name its branch anything, so the branch only counts when the
  // pull request's head is this repository.
  if (head?.repo?.full_name !== repo) {
    return null;
  }
  return SWEEP_BRANCHES[head.ref] ?? null;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Runs the sweep's one-axis guard on a commit that is already merged.
 *
 * The guard looks at a working tree that is about to be committed. A scratch
 * worktree at the commit, moved back one commit with `reset --soft`, is exactly
 * that: the commit's changes, pending. Returns null when the commit stays on
 * its axis, or the guard's own message when it does not.
 */
export function leavesItsAxis(sha, axis, cwd) {
  const scratch = mkdtempSync(join(tmpdir(), 'sweep-bump-'));
  try {
    git(['worktree', 'add', '--detach', scratch, sha], cwd);
    git(['reset', '--soft', 'HEAD^'], scratch);
    execFileSync('python3', ['deploy/ci/sweep/sweep.py', 'check-diff', '--axis', axis], {
      cwd: scratch,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
  } finally {
    try {
      git(['worktree', 'remove', '--force', scratch], cwd);
    } catch {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      sha: { type: 'string' },
      repo: { type: 'string' },
      // For tests: the commit's pull requests as a JSON file, instead of asking GitHub.
      pulls: { type: 'string' },
    },
  });
  if (!values.sha || !values.repo) {
    throw new Error('--sha <commit> and --repo <owner/name> are required');
  }
  const pulls = JSON.parse(
    values.pulls
      ? readFileSync(values.pulls, 'utf8')
      : execFileSync('gh', ['api', `repos/${values.repo}/commits/${values.sha}/pulls`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
        }),
  );

  const axis = sweepAxis(pulls, values.repo);
  if (!axis) {
    console.error(`${values.sha} was not merged from a compat-sweep branch of ${values.repo}; nothing is released automatically.`);
    console.log('axis=');
    return;
  }
  const problem = leavesItsAxis(values.sha, axis, process.cwd());
  if (problem) {
    console.error(
      `::warning title=Sweep bump not released automatically::${values.sha} came from the ${axis} sweep branch but changes more than that axis may: ` +
        `${problem.replace(/\s+/g, ' ')} Release it by hand if it should be released.`,
    );
    console.log('axis=');
    return;
  }
  console.error(`${values.sha} is a merged ${axis}-axis sweep bump and stays on its axis.`);
  console.log(`axis=${axis}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`sweep-bump: ${error.message}`);
    process.exit(1);
  }
}
