// semantic-release configuration. publish.yml runs it on main after CI passes.
//
// A release is one version shared by three artifacts: the npm package
// (frontend only), the GitHub release, and the container image tags X.Y.Z and
// X.Y that publish.yml adds afterwards. See docs/releasing.md.
//
// This is a .cjs file rather than .releaserc.json because the rules below need
// their reasons written next to them, and one of them is a regular expression.
// scripts/release/check-release-config.mjs runs sample commits through it; CI
// runs that on every pull request, because the first real run of this file is
// on main, after the merge.

const pkgRoot = 'frontend';

// The default (Angular) commit preset only treats a commit as breaking when it
// has a `BREAKING CHANGE:` footer. It does not recognise the `!` marker from
// Conventional Commits, which CONTRIBUTING.md tells people to use — and worse,
// a header like `feat!: x` does not parse at all, so the commit is dropped and
// cuts no release of any kind. This pattern makes `type!:` and `type(scope)!:`
// parse, and count as breaking, without changing the preset or what any other
// commit does.
const parserOpts = {
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
};

// What cuts a release. A rule listed here decides the commit outright; a commit
// that matches none falls through to the defaults (feat -> minor, fix and perf
// -> patch, breaking -> major, everything else -> nothing).
//
// A commit about CI never releases, whether it says so in its scope or in its
// type. A workflow change alters nothing in the package or the image, but
// `fix(ci):` and `feat(ci):` are still `fix` and `feat` to the defaults, and
// that is how 1.0.1, 1.0.2, 1.0.3 and 1.1.0 were each published by a commit
// that changed nothing in the package.
//
// The type rule looks redundant, since `ci:` releases nothing by default. It is
// there for `ci!:` and for a `ci:` commit with a BREAKING CHANGE footer: the
// default rules would turn either into a major release of a package that the
// commit did not touch.
const releaseRules = [
  { scope: 'ci', release: false },
  { type: 'ci', release: false },
];

module.exports = {
  branches: ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', { releaseRules, parserOpts }],
    ['@semantic-release/release-notes-generator', { parserOpts }],
    // Declares the supported gateway range: a section in the release notes and
    // an `openshell` field in the published package.json. Listed before the npm
    // plugin so the field is already there whenever that plugin packs.
    ['./scripts/release/gateway-range-plugin.mjs', { pkgRoot }],
    ['@semantic-release/npm', { pkgRoot }],
    '@semantic-release/github',
  ],
};
