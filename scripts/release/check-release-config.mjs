#!/usr/bin/env node
// Proves what release.config.cjs does, without releasing anything.
//
// The release configuration only ever runs for real on main, after a merge, so
// a mistake in it is found by a publish that should not have happened — or by
// one that silently did not. This loads the configuration the way
// semantic-release does, then feeds sample commit messages to
// @semantic-release/commit-analyzer with the configured rules and prints which
// release each one would cut. It fails if a decision is not the documented one.
//
// It then hands the same commits to @semantic-release/release-notes-generator
// and checks that the notes agree with the decisions: a commit is listed
// exactly when it cuts a release, and BREAKING CHANGES is printed exactly when
// the release is a major one. The two plugins are configured separately and
// know nothing of each other, so nothing else keeps them in step.
//
// It needs the semantic-release that publish.yml runs, installed somewhere:
//
//   npm install --no-package-lock --prefix /tmp/sr semantic-release@<version in publish.yml>
//   node scripts/release/check-release-config.mjs --from /tmp/sr
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RANGE_PLUGIN = './scripts/release/gateway-range-plugin.mjs';

// What CONTRIBUTING.md promises. `none` means the commit cuts no release.
const EXPECTED = [
  // CI changes never release, whether `ci` is the type or the scope, and
  // whatever else the commit claims to be.
  ['ci: x', 'none'],
  ['fix(ci): x', 'none'],
  ['feat(ci): x', 'none'],
  ['feat(ci)!: x', 'none'],
  ['ci!: x', 'none'],
  ['ci: x\n\nBREAKING CHANGE: y', 'none'],
  // Everything else keeps the default behaviour.
  ['fix(bff): x', 'patch'],
  ['perf: x', 'patch'],
  ['feat: x', 'minor'],
  ['feat!: x', 'major'],
  ['fix(bff)!: x', 'major'],
  ['fix(bff): x\n\nBREAKING CHANGE: y', 'major'],
  ['docs: x', 'none'],
  ['chore(deps): x', 'none'],
  // A squash title that is not a Conventional Commit is ignored entirely.
  ['Add foo (#74)', 'none'],
  // A revert is a patch, and git's own title for one has no type or scope, so
  // the `ci` rules cannot see what was reverted. Reverting a CI change without
  // cutting a release takes a `ci:` title, which is what CONTRIBUTING.md asks for.
  ['Revert "ci: x"\n\nThis reverts commit 0123abc.', 'patch'],
  ['ci: revert "x"', 'none'],
];

const quiet = {
  scopeName: '',
  scope() {
    return this;
  },
  log() {},
  warn() {},
  error() {},
  success() {},
};

async function main() {
  const { values } = parseArgs({ options: { from: { type: 'string' } } });
  if (!values.from) {
    throw new Error('--from <directory where semantic-release is installed> is required');
  }
  const requireFrom = createRequire(join(resolve(values.from), 'noop.js'));
  const importFrom = (file) => import(pathToFileURL(file).href);
  const versionOf = (name) =>
    JSON.parse(readFileSync(join(resolve(values.from), 'node_modules', name, 'package.json'), 'utf8'))
      .version;

  // 1. The configuration loads: the file is found, every plugin resolves from
  //    the repository root, and each exports the steps it is used for.
  const semanticReleaseDir = dirname(requireFrom.resolve('semantic-release'));
  const { default: getConfig } = await importFrom(join(semanticReleaseDir, 'lib', 'get-config.js'));
  const loaded = [];
  const logger = { ...quiet, success: (message) => loaded.push(message) };
  const { options } = await getConfig({ cwd: repoRoot, env: process.env, logger }, {});

  const pluginNames = options.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
  console.log(`release configuration loaded by semantic-release ${versionOf('semantic-release')}`);
  console.log(`  branches: ${JSON.stringify(options.branches)}`);
  console.log(`  plugins:  ${pluginNames.join(', ')}`);

  for (const step of ['generateNotes', 'prepare']) {
    if (!loaded.includes(`Loaded plugin "${step}" from "${RANGE_PLUGIN}"`)) {
      throw new Error(`${RANGE_PLUGIN} did not load for the ${step} step`);
    }
  }
  if (pluginNames.indexOf(RANGE_PLUGIN) > pluginNames.indexOf('@semantic-release/npm')) {
    throw new Error(`${RANGE_PLUGIN} must come before @semantic-release/npm, which publishes package.json`);
  }
  console.log(`  ${RANGE_PLUGIN}: generateNotes and prepare loaded, ahead of the npm plugin`);

  // 2. The release rules decide what CONTRIBUTING.md says they decide.
  const analyzerConfig = options.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
  )?.[1];
  if (!analyzerConfig) {
    throw new Error('@semantic-release/commit-analyzer is not configured with options');
  }
  const { analyzeCommits } = await importFrom(requireFrom.resolve('@semantic-release/commit-analyzer'));

  // Two digits repeated: distinct, and nothing a sample revert could name.
  const commits = EXPECTED.map(([message], index) => ({
    hash: String(index + 1).padStart(2, '0').repeat(20),
    message,
  }));
  const shown = (message) => JSON.stringify(message).padEnd(SHOWN_WIDTH);

  console.log(`\n@semantic-release/commit-analyzer ${versionOf('@semantic-release/commit-analyzer')} decisions:`);
  let wrong = 0;
  for (const [index, [message, expected]] of EXPECTED.entries()) {
    const type = await analyzeCommits(analyzerConfig, {
      cwd: repoRoot,
      commits: [commits[index]],
      logger: quiet,
    });
    const decision = type ?? 'none';
    const ok = decision === expected;
    wrong += ok ? 0 : 1;
    console.log(`  ${shown(message)} -> ${decision.padEnd(5)} ${ok ? '' : `WRONG, expected ${expected}`}`.trimEnd());
  }
  if (wrong > 0) {
    throw new Error(`${wrong} commit(s) would not release as documented`);
  }

  // 3. The release notes agree with those decisions. A commit is in the notes
  //    exactly when it cuts a release, and the notes announce breaking changes
  //    exactly when the release is a major one. Without the `skip` in
  //    release.config.cjs this fails for every `ci` commit that the rules
  //    silence: `fix(ci): x` is listed as a bug fix, and `ci!: x` prints
  //    BREAKING CHANGES in what the rules made a patch release.
  const notesConfig =
    options.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/release-notes-generator',
    )?.[1] ?? {};
  const { generateNotes } = await importFrom(requireFrom.resolve('@semantic-release/release-notes-generator'));
  const notesFor = async (released) =>
    describeNotes(
      await generateNotes(notesConfig, {
        cwd: repoRoot,
        commits: released,
        lastRelease: { gitTag: 'v0.0.0' },
        nextRelease: { gitTag: 'v0.0.1', version: '0.0.1' },
        options: { repositoryUrl: 'https://example.com/owner/repo.git' },
      }),
    );

  console.log(
    `\n@semantic-release/release-notes-generator ${versionOf('@semantic-release/release-notes-generator')}, ` +
      'each commit in a release of its own:',
  );
  for (const [index, [message, expected]] of EXPECTED.entries()) {
    const notes = await notesFor([commits[index]]);
    const ok = notes.listed === (expected === 'none' ? 0 : 1) && notes.breaking === (expected === 'major' ? 1 : 0);
    wrong += ok ? 0 : 1;
    const said = `${notes.listed ? 'listed' : 'not listed'}${notes.breaking ? ', BREAKING CHANGES' : ''}`;
    console.log(`  ${shown(message)} -> ${said}${ok ? '' : `   WRONG for a commit that cuts ${expected}`}`);
  }

  // And all of them in one release, which is how a silenced commit really
  // reaches the notes: riding along with a commit that does cut a release.
  const together = await notesFor(commits);
  const releasing = EXPECTED.filter(([, expected]) => expected !== 'none').length;
  const majors = EXPECTED.filter(([, expected]) => expected === 'major').length;
  const togetherOk = together.listed === releasing && together.breaking === majors && !together.mentionsCi;
  wrong += togetherOk ? 0 : 1;
  console.log(
    `  all ${EXPECTED.length} in one release: ${together.listed} listed (expected ${releasing}), ` +
      `${together.breaking} under BREAKING CHANGES (expected ${majors}), ` +
      `${together.mentionsCi ? 'a ci entry is present' : 'no ci entry'}${togetherOk ? '' : '   WRONG'}`,
  );
  if (wrong > 0) {
    throw new Error(`the release notes disagree with the release rules for ${wrong} case(s)`);
  }
}

const SHOWN_WIDTH = 52;
const BREAKING_HEADING = '### BREAKING CHANGES';

/** What a set of notes says, reduced to what the rules can be checked against. */
function describeNotes(notes) {
  const bullets = (text) => text.split('\n').filter((line) => line.startsWith('* ')).length;
  const [changes, breaking = ''] = notes.split(BREAKING_HEADING);
  return {
    listed: bullets(changes),
    breaking: bullets(breaking),
    // How the Angular preset writes a `ci` scope and the `ci` type's section.
    mentionsCi: notes.includes('**ci:**') || notes.includes('### Continuous Integration'),
  };
}

main().catch((error) => {
  console.error(`check-release-config: ${error.message}`);
  process.exit(1);
});
