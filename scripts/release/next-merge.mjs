#!/usr/bin/env node
// Did this commit reach main by merging `next`?
//
// Releases are cut by hand (see release-type-plugin.mjs), with one exception:
// the move to a new OpenShell release. That move is prepared on the `next`
// branch by the Follow upstream workflow and reaches main as the pull request
// from `next` (ADR 0009, decisions 7 and 8). Its whole purpose is to change
// what the next release is built on and declares, and it is the release most
// likely to be forgotten. So publish.yml releases it by itself once it is
// merged and CI has passed on main.
//
// "It came from next" has to be established from where the commit came from,
// not from what it is called. A title can be typed by anyone. This asks the
// one question that cannot be answered by typing: was the commit merged into
// main by a pull request whose head was the branch `next` in THIS repository?
//
// A fork can name a branch `next` too, so the head repository counts, not
// only the branch name. With "Rebase and merge" GitHub associates every
// commit the merge put on main with the pull request, so the tip that CI ran
// for answers for all of them.
//
// Prints `from=next` or `from=` in GITHUB_OUTPUT form. An empty answer is the
// ordinary one and is not an error.
//
//   GH_TOKEN=... node scripts/release/next-merge.mjs --sha <commit> --repo owner/name
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The branch deploy/ci/upstream/ keeps, and the one it merges into.
export const NEXT_BRANCH = 'next';
export const BASE_BRANCH = 'main';

/**
 * True when the commit was merged into main from `next` in this repository.
 *
 * @param {object[]} pulls the pull requests GitHub associates with the commit
 *                         (GET /repos/{repo}/commits/{sha}/pulls)
 * @param {string} repo    owner/name of this repository
 */
export function mergedFromNext(pulls, repo) {
  const merged = pulls.filter((pull) => pull?.merged_at && pull.base?.ref === BASE_BRANCH);
  // One commit, one pull request. Anything else is not something to guess
  // about, and "not sure" must mean "not automatic".
  if (merged.length !== 1) {
    return false;
  }
  const [{ head }] = merged;
  return head?.repo?.full_name === repo && head.ref === NEXT_BRANCH;
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

  if (!mergedFromNext(pulls, values.repo)) {
    console.error(
      `${values.sha} was not merged from the ${NEXT_BRANCH} branch of ${values.repo}; nothing is released automatically.`,
    );
    console.log('from=');
    return;
  }
  console.error(`${values.sha} was merged into ${BASE_BRANCH} from the ${NEXT_BRANCH} branch of ${values.repo}.`);
  console.log(`from=${NEXT_BRANCH}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`next-merge: ${error.message}`);
    process.exit(1);
  }
}
