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

  console.log(`\n@semantic-release/commit-analyzer ${versionOf('@semantic-release/commit-analyzer')} decisions:`);
  let wrong = 0;
  for (const [message, expected] of EXPECTED) {
    const type = await analyzeCommits(analyzerConfig, {
      cwd: repoRoot,
      commits: [{ hash: '0000000', message }],
      logger: quiet,
    });
    const decision = type ?? 'none';
    const ok = decision === expected;
    wrong += ok ? 0 : 1;
    const shown = JSON.stringify(message).padEnd(42);
    console.log(`  ${shown} -> ${decision.padEnd(5)} ${ok ? '' : `WRONG, expected ${expected}`}`.trimEnd());
  }
  if (wrong > 0) {
    throw new Error(`${wrong} commit(s) would not release as documented`);
  }
}

main().catch((error) => {
  console.error(`check-release-config: ${error.message}`);
  process.exit(1);
});
