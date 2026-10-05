// semantic-release configuration. publish.yml runs it on main.
//
// A release is one version shared by three artifacts: the npm package
// (frontend only), the GitHub release, and the container image tags X.Y.Z and
// X.Y that publish.yml adds afterwards. See docs/releasing.md.
//
// Releases are cut by hand. semantic-release does NOT decide whether to
// release or what kind of release it is: scripts/release/release-type-plugin.mjs
// takes that from RELEASE_TYPE, which publish.yml sets from the choice a person
// made when starting the workflow. Commit titles still matter for two things:
// they are what the release notes are written from, and they are what the
// plugin reports as the release the commits would have suggested.
//
// This is a .cjs file rather than .releaserc.json because the options below
// need their reasons written next to them, and one of them is a regular
// expression. scripts/release/check-release-config.mjs loads it and runs sample
// commits through it; CI runs that on every pull request, because the first
// real run of this file is on main.

const pkgRoot = 'frontend';

// The default (Angular) commit preset only treats a commit as breaking when it
// has a `BREAKING CHANGE:` footer. It does not recognise the `!` marker from
// Conventional Commits, which CONTRIBUTING.md tells people to use, and a header
// like `feat!: x` does not parse at all, so the commit would be missing from
// the notes. This pattern makes `type!:` and `type(scope)!:` parse, and count
// as breaking, without changing the preset or what any other commit does.
const parserOpts = {
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
};

const CI = 'ci';

// A commit about CI is left out of the release notes, whether it says so in
// its scope or in its type. A workflow change alters nothing in the package or
// the image, so `fix(ci): ...` under Bug Fixes, or a BREAKING CHANGES section
// printed for `ci!: ...`, would tell a reader of the notes something about the
// release that is not true. The release-type plugin leaves the same commits out
// when it says what the commits suggest, so the two agree.
//
// `skip` is asked about each commit after the preset has formatted it. By then
// `type` is a section title ("Bug Fixes"), and what the commit said is under
// `raw`; a commit the preset dropped arrives as it was. Both are looked at.
const isCiCommit = (commit) => Boolean(commit) && (commit.type === CI || commit.scope === CI);
const writerOpts = {
  skip: (commit) => isCiCommit(commit) || isCiCommit(commit.raw),
};

module.exports = {
  branches: ['main'],
  plugins: [
    // Decides the kind of release from RELEASE_TYPE, a person's choice, and
    // fails without one. Takes the place of @semantic-release/commit-analyzer.
    './scripts/release/release-type-plugin.mjs',
    ['@semantic-release/release-notes-generator', { parserOpts, writerOpts }],
    // Declares the supported gateway range: a section in the release notes and
    // an `openshell` field in the published package.json. Listed before the npm
    // plugin so the field is already there whenever that plugin packs.
    ['./scripts/release/gateway-range-plugin.mjs', { pkgRoot }],
    ['@semantic-release/npm', { pkgRoot }],
    '@semantic-release/github',
  ],
};
