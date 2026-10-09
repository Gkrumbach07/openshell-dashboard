#!/usr/bin/env node
// Proves what release.config.cjs does, without releasing anything.
//
// The release configuration only ever runs for real on main, so a mistake in
// it is found by a publish that should not have happened, or by one that
// silently did not. This loads the configuration the way semantic-release
// does and checks three things:
//
//   1. It loads, nothing but the release-type plugin can decide a release, and
//      nothing publishes to npm. Releases are cut by hand with a chosen type;
//      if the stock commit analyzer were still listed, a commit title could
//      raise the release above what the person chose.
//   2. The release-type plugin does what it says: the chosen type is what gets
//      released, no choice is an error, no commits is no release, and what it
//      reports as "the commits suggest" matches the table in CONTRIBUTING.md.
//   3. The release notes agree with those suggestions: a commit is listed
//      exactly when it suggests a release, and BREAKING CHANGES is printed
//      exactly when it suggests a major one. The plugin and the notes
//      generator know nothing of each other, so nothing else keeps them in
//      step.
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
const TYPE_PLUGIN = './scripts/release/release-type-plugin.mjs';
const STOCK_ANALYZER = '@semantic-release/commit-analyzer';
const NPM_PLUGIN = '@semantic-release/npm';

// What CONTRIBUTING.md says each title suggests. `none` means it suggests no
// release. The person cutting the release still chooses; this is what they
// are told the commits say.
const EXPECTED = [
  // CI changes never suggest a release, whether `ci` is the type or the scope,
  // and whatever else the commit claims to be.
  ['ci: x', 'none'],
  ['fix(ci): x', 'none'],
  ['feat(ci): x', 'none'],
  ['feat(ci)!: x', 'none'],
  ['ci!: x', 'none'],
  ['ci: x\n\nBREAKING CHANGE: y', 'none'],
  // Everything else follows Conventional Commits.
  ['fix(bff): x', 'patch'],
  ['perf: x', 'patch'],
  ['feat: x', 'minor'],
  ['feat!: x', 'major'],
  ['fix(bff)!: x', 'major'],
  ['fix(bff): x\n\nBREAKING CHANGE: y', 'major'],
  ['docs: x', 'none'],
  ['chore(deps): x', 'none'],
  // A squash title that is not a Conventional Commit suggests nothing.
  ['Add foo (#74)', 'none'],
  // A revert is a patch, and git's own title for one has no type or scope, so
  // the `ci` rule cannot see what was reverted. A revert of a CI change that
  // should stay out of the notes takes a `ci:` title, which is what
  // CONTRIBUTING.md asks for.
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

  if (!loaded.includes(`Loaded plugin "generateNotes" from "${RANGE_PLUGIN}"`)) {
    throw new Error(`${RANGE_PLUGIN} did not load for the generateNotes step`);
  }
  console.log(`  ${RANGE_PLUGIN}: generateNotes loaded`);

  // The npm package is retired (ADR 0008). The plugin is one of
  // semantic-release's defaults, so leaving `plugins` out of the configuration
  // would be enough to bring it back.
  if (pluginNames.includes(NPM_PLUGIN)) {
    throw new Error(`${NPM_PLUGIN} is configured; the npm package is retired and must not be published`);
  }
  console.log(`  ${NPM_PLUGIN}: not configured, so nothing is published to npm`);

  // Nothing but the release-type plugin may decide a release. semantic-release
  // takes the LARGEST answer when several plugins analyze the commits, so the
  // stock analyzer alongside it would let a commit title override the choice.
  if (!loaded.includes(`Loaded plugin "analyzeCommits" from "${TYPE_PLUGIN}"`)) {
    throw new Error(`${TYPE_PLUGIN} did not load for the analyzeCommits step`);
  }
  if (pluginNames.includes(STOCK_ANALYZER)) {
    throw new Error(`${STOCK_ANALYZER} is configured; a commit title could then decide a release`);
  }
  console.log(`  ${TYPE_PLUGIN}: the only plugin that decides a release`);

  // 2. The release-type plugin releases what was chosen and nothing else.
  const { analyzeCommits, suggestFor } = await importFrom(join(repoRoot, TYPE_PLUGIN));

  // Two digits repeated: distinct, and nothing a sample revert could name.
  const commits = EXPECTED.map(([message], index) => ({
    hash: String(index + 1).padStart(2, '0').repeat(20),
    message,
  }));
  const shown = (message) => JSON.stringify(message).padEnd(SHOWN_WIDTH);
  const decide = (env, released) => analyzeCommits({}, { commits: released, env, logger: quiet });
  let wrong = 0;

  console.log('\nrelease-type plugin:');
  const chosen = [];
  for (const type of ['patch', 'minor', 'major']) {
    // Every sample at once, including the ones that suggest a major release.
    chosen.push(`${type} -> ${await decide({ RELEASE_TYPE: type }, commits)}`);
    wrong += chosen.at(-1) === `${type} -> ${type}` ? 0 : 1;
  }
  console.log(`  chosen type is what is released, whatever the commits say: ${chosen.join(', ')}`);
  const nothing = await decide({ RELEASE_TYPE: 'minor' }, []);
  wrong += nothing === null ? 0 : 1;
  console.log(`  no commits since the last release -> ${nothing === null ? 'no release' : `WRONG, ${nothing}`}`);
  for (const env of [{}, { RELEASE_TYPE: '' }, { RELEASE_TYPE: 'auto' }, { RELEASE_TYPE: 'Major' }]) {
    const refused = await decide(env, commits).then(
      (type) => `WRONG, released ${type}`,
      () => 'refused',
    );
    wrong += refused === 'refused' ? 0 : 1;
    console.log(`  RELEASE_TYPE=${JSON.stringify(env.RELEASE_TYPE ?? null)} -> ${refused}`);
  }
  if (wrong > 0) {
    throw new Error(`the release-type plugin got ${wrong} case(s) wrong`);
  }

  console.log('\nwhat each commit title suggests:');
  for (const [message, expected] of EXPECTED) {
    const decision = suggestFor(message) ?? 'none';
    const ok = decision === expected;
    wrong += ok ? 0 : 1;
    console.log(`  ${shown(message)} -> ${decision.padEnd(5)} ${ok ? '' : `WRONG, expected ${expected}`}`.trimEnd());
  }
  if (wrong > 0) {
    throw new Error(`${wrong} commit title(s) do not suggest what CONTRIBUTING.md says`);
  }

  // 3. The release notes agree with those suggestions. A commit is in the notes
  //    exactly when it suggests a release, and the notes announce breaking
  //    changes exactly when it suggests a major one. Without the `skip` in
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
    console.log(`  ${shown(message)} -> ${said}${ok ? '' : `   WRONG for a commit that suggests ${expected}`}`);
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
    throw new Error(`the release notes disagree with what the commits suggest for ${wrong} case(s)`);
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
