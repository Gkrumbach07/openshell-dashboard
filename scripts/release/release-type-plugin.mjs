// semantic-release plugin: a person chooses what kind of release to cut.
//
// Loaded by release.config.cjs in place of @semantic-release/commit-analyzer.
//
// semantic-release normally reads the commits since the last release and
// decides for itself: a `feat:` title is a minor, a `fix:` is a patch, and one
// `!` or `BREAKING CHANGE:` footer is a major. That made merging a pull request
// with the right title the same act as publishing, and it is how 1.0.0 was
// published by a single footer nobody meant as a milestone.
//
// Here the kind of release comes from RELEASE_TYPE, which publish.yml sets from
// the choice the person made when they started the workflow (or to `patch` for
// the merge of `next`, the one release that is still automatic). The
// commits are still read, but only to say what they would have suggested, so a
// choice that disagrees with them is made knowingly.
//
// Without RELEASE_TYPE the step fails. That is the point: nothing can be
// released by running semantic-release without having said what to release.
import { appendFileSync } from 'node:fs';

export const RELEASE_TYPES = ['patch', 'minor', 'major'];

const HEADER = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: /;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
// git's own title for `git revert`. It has no type and no scope.
const REVERT = /^Revert "/;
const CI = 'ci';

/**
 * What one commit message suggests, by the conventions in CONTRIBUTING.md:
 * a commit about CI suggests nothing whatever else it says; otherwise a
 * breaking change is a major, `feat` a minor, `fix` and `perf` a patch, a
 * plain revert a patch, and anything else nothing.
 *
 * @param {string} message
 * @returns {'major' | 'minor' | 'patch' | null}
 */
export function suggestFor(message) {
  const [title = ''] = message.split('\n');
  const header = HEADER.exec(title)?.groups;
  if (!header) {
    return REVERT.test(title) ? 'patch' : null;
  }
  if (header.type === CI || header.scope === CI) {
    return null;
  }
  if (header.bang || BREAKING_FOOTER.test(message)) {
    return 'major';
  }
  if (header.type === 'feat') {
    return 'minor';
  }
  if (header.type === 'fix' || header.type === 'perf') {
    return 'patch';
  }
  return null;
}

/** The largest release any of the commits suggests, or null when none suggests one. */
export function suggest(commits) {
  let highest = -1;
  for (const { message = '' } of commits) {
    highest = Math.max(highest, RELEASE_TYPES.indexOf(suggestFor(message)));
  }
  return highest < 0 ? null : RELEASE_TYPES[highest];
}

/**
 * How a choice compares with what the commits suggest, in words for the log.
 * A smaller release than suggested is the case worth a warning: it can publish
 * a breaking change as a patch.
 */
export function compareChoice(chosen, suggested) {
  if (!suggested) {
    return {
      smaller: false,
      text: `No commit since the last release suggests a release by its title; cutting a ${chosen} because that was chosen.`,
    };
  }
  const difference = RELEASE_TYPES.indexOf(chosen) - RELEASE_TYPES.indexOf(suggested);
  if (difference === 0) {
    return { smaller: false, text: `The commits also suggest a ${suggested} release.` };
  }
  if (difference > 0) {
    return {
      smaller: false,
      text: `The commits suggest only a ${suggested} release; cutting a ${chosen} because that was chosen.`,
    };
  }
  return {
    smaller: true,
    text:
      `The commits suggest a ${suggested} release, which is LARGER than the ${chosen} that was chosen. ` +
      `Consumers who allow ${chosen} updates will receive it; check that nothing in it breaks them.`,
  };
}

export async function analyzeCommits(_pluginConfig, { commits, env, logger }) {
  const chosen = env.RELEASE_TYPE;
  if (!RELEASE_TYPES.includes(chosen)) {
    throw new Error(
      `RELEASE_TYPE must be one of ${RELEASE_TYPES.join(', ')}, got ${JSON.stringify(chosen ?? '')}. ` +
        'Releases are cut by hand: start the "Release" workflow on main and choose the kind of release ' +
        '(see docs/releasing.md).',
    );
  }
  if (commits.length === 0) {
    logger.log('There are no commits since the last release, so there is nothing to release.');
    return null;
  }

  const { smaller, text } = compareChoice(chosen, suggest(commits));
  logger.log(`Release type chosen: ${chosen}. ${commits.length} commit(s) since the last release. ${text}`);
  if (smaller && env.GITHUB_ACTIONS === 'true') {
    // Surfaces on the run's summary page, not only in the log.
    console.log(`::warning title=Release smaller than the commits suggest::${text}`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `**Release type chosen: \`${chosen}\`.** ${commits.length} commit(s) since the last release. ${text}\n\n`,
    );
  }
  return chosen;
}
