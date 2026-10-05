#!/usr/bin/env node
// The supported OpenShell gateway range, derived from deploy/ci/gateway-pins.json.
//
// A dashboard build supports a window of gateway releases, not "latest"
// (ADR 0005, as amended by ADR 0006). Nobody gets to type that window: it is
// whatever the REQUIRED compat lanes prove against real gateways on every pull
// request. The floor is the lowest version among those lanes and the ceiling
// is the highest.
//
// This file is the only place that turns the pins into a range. The container
// image's build args (ci.yml), the release notes and the published
// package.json (release.config.cjs) and the README's Compatibility section
// (readme-gateway-range.mjs) all call it, so a published artifact cannot claim
// something CI did not test and two artifacts cannot disagree with each other.
// What moves the range is therefore a change to the pins file, and nothing else.
//
//   node scripts/gateway-range.mjs                  summary for a person
//   node scripts/gateway-range.mjs --format json    for scripts
//   node scripts/gateway-range.mjs --format github  key=value lines for $GITHUB_OUTPUT
//   node scripts/gateway-range.mjs --check          also fail when the pins' sdk
//                                                   is not the one in backend/go.mod
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Repo-relative, with forward slashes, so it can also be used in `git show <tag>:<path>`.
export const PINS_FILE = 'deploy/ci/gateway-pins.json';
export const PINS_PATH = join(repoRoot, PINS_FILE);
export const GO_MOD_PATH = join(repoRoot, 'backend', 'go.mod');
export const SDK_MODULE = 'github.com/NVIDIA/OpenShell/sdk/go';

// A release is exactly X.Y.Z. Upstream also tags pre-releases (v0.1.3-pre.4)
// and publishes dev builds (0.1.3-dev.84); neither is something a deployment
// can be told to install, and a dev gateway pulls a moving sandbox image at
// runtime, so a range with one of those as an end would not mean anything.
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareReleases(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

/**
 * Turn the parsed pins file into the range this build may claim.
 *
 * Only lanes with `"required": true` count. An advisory lane is allowed to
 * fail, so it proves nothing and must not widen the claim.
 */
export function deriveGatewayRange(pins) {
  const lanes = Array.isArray(pins?.lanes) ? pins.lanes : [];
  const required = lanes.filter((lane) => lane?.required === true);
  if (required.length === 0) {
    throw new Error(
      'no lane has "required": true, so no gateway is proven to work and there is no range to declare',
    );
  }
  for (const lane of required) {
    if (typeof lane.version !== 'string' || !RELEASE.test(lane.version)) {
      throw new Error(
        `required lane ${JSON.stringify(lane.label ?? lane.version)} has version ` +
          `${JSON.stringify(lane.version)}, which is not a gateway release (X.Y.Z). ` +
          'A supported range can only be declared over releases; make a dev or ' +
          'pre-release lane advisory ("required": false) instead.',
      );
    }
  }
  if (typeof pins.sdk !== 'string' || pins.sdk.trim() === '') {
    throw new Error('"sdk" is missing: it must record the SDK pin from backend/go.mod');
  }

  const versions = [...new Set(required.map((lane) => lane.version))].sort(compareReleases);
  const floor = versions[0];
  const ceiling = versions[versions.length - 1];
  return {
    floor,
    ceiling,
    // node-semver range syntax, so a consumer can hand it straight to
    // semver.satisfies(gatewayVersion, range).
    range: `>=${floor} <=${ceiling}`,
    sdk: pins.sdk,
    // The releases CI actually runs against: the ends of the range, plus any
    // other required lane in between.
    tested: versions,
  };
}

export function readGatewayRange(pinsPath = PINS_PATH) {
  let pins;
  try {
    pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${pinsPath}: ${error.message}`);
  }
  try {
    return deriveGatewayRange(pins);
  } catch (error) {
    throw new Error(`${pinsPath}: ${error.message}`);
  }
}

/** The SDK version backend/go.mod actually builds against. */
export function sdkInGoMod(goModPath = GO_MOD_PATH) {
  const goMod = readFileSync(goModPath, 'utf8');
  const escaped = SDK_MODULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = goMod.match(new RegExp(`^\\s*(?:require\\s+)?${escaped}\\s+(\\S+)`, 'm'));
  if (!match) {
    throw new Error(`${goModPath} does not require ${SDK_MODULE}`);
  }
  return match[1];
}

/** "0.1.0 – 0.1.2", or just "0.1.2" when the range is a single release. */
export function formatRange({ floor, ceiling }) {
  return floor === ceiling ? floor : `${floor} – ${ceiling}`;
}

function main() {
  const { values } = parseArgs({
    options: {
      format: { type: 'string', default: 'text' },
      pins: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });

  const pinsPath = values.pins ?? PINS_PATH;
  const range = readGatewayRange(pinsPath);

  if (values.check) {
    // The one invariant between the two files: the `sdk` field of the pins
    // file equals the SDK version in backend/go.mod. The field is a record,
    // written by hand or by the sweep's SDK pull request; go.mod is what the
    // BFF is compiled against. If they differ, every artifact would declare an
    // SDK the build does not contain.
    //
    // That is all that has to agree. The gateway lanes are a separate matter:
    // the SDK can move while the lanes stay, and a lane can move while the SDK
    // stays (ADR 0006), so the message must not send anyone to change both.
    const built = sdkInGoMod();
    if (built !== range.sdk) {
      throw new Error(
        `${pinsPath} says "sdk": ${JSON.stringify(range.sdk)}, but backend/go.mod builds against ${built}. ` +
          'The sdk field must equal the SDK version in backend/go.mod. Bring the stale one of the ' +
          'two in line; the gateway lanes are not involved and do not need to change.',
      );
    }
  }

  switch (values.format) {
    case 'json':
      process.stdout.write(`${JSON.stringify(range, null, 2)}\n`);
      break;
    case 'github':
      process.stdout.write(
        `floor=${range.floor}\nceiling=${range.ceiling}\nrange=${range.range}\nsdk=${range.sdk}\n`,
      );
      break;
    case 'text':
      process.stdout.write(
        `Supported OpenShell gateways: ${formatRange(range)}  (${range.range})\n` +
          `Required compat lanes:        ${range.tested.join(', ')}\n` +
          `OpenShell Go SDK:             ${range.sdk}\n`,
      );
      break;
    default:
      throw new Error(`unknown --format ${JSON.stringify(values.format)} (text, json or github)`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`gateway-range: ${error.message}\n`);
    process.exit(1);
  }
}
