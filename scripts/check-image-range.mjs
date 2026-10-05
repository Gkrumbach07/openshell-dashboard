#!/usr/bin/env node
// Checks that an image in the registry really declares the supported gateway
// range, on every platform it was built for.
//
//   node scripts/check-image-range.mjs quay.io/gkrumbach07/openshell-dashboard:sha-0a1b2c3
//
// The range reaches the image as build args: ci.yml passes them, and
// deploy/Dockerfile turns them into two env vars and three labels. A build arg
// that is misspelt on either side is not an error — the Dockerfile's default is
// the empty string, on purpose, so that a plain `docker build` works — which
// means the image would be published claiming nothing and no step would fail.
// This reads the pushed image's config back and compares it with what
// gateway-range.mjs derives. It only talks to the registry; it does not pull or
// run the image.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readGatewayRange } from './gateway-range.mjs';

// Must match the LABEL keys in deploy/Dockerfile.
export const LABEL_PREFIX = 'io.github.gkrumbach07.openshell-dashboard';

/** What deploy/Dockerfile should have baked in for this range. */
export function expectedDeclaration(range) {
  return {
    env: {
      GATEWAY_SUPPORTED_MIN: range.floor,
      GATEWAY_SUPPORTED_MAX: range.ceiling,
    },
    labels: {
      [`${LABEL_PREFIX}.gateway.min`]: range.floor,
      [`${LABEL_PREFIX}.gateway.max`]: range.ceiling,
      [`${LABEL_PREFIX}.sdk`]: range.sdk,
    },
  };
}

/**
 * `imagetools inspect --format '{{json .Image}}'` prints one image config for a
 * single-platform image and a map of platform -> config for a multi-platform
 * one. Returns [platform, config] pairs either way.
 */
export function platformConfigs(inspected) {
  if (inspected && typeof inspected === 'object' && 'config' in inspected) {
    return [[`${inspected.os ?? '?'}/${inspected.architecture ?? '?'}`, inspected.config ?? {}]];
  }
  return Object.entries(inspected ?? {})
    .filter(([, image]) => image && typeof image === 'object' && 'config' in image)
    .map(([platform, image]) => [platform, image.config ?? {}]);
}

/** Every way the image fails to say what it should. Empty means it is right. */
export function declarationProblems(inspected, range) {
  const configs = platformConfigs(inspected);
  if (configs.length === 0) {
    return ['the registry returned no image config to check'];
  }
  const want = expectedDeclaration(range);
  const problems = [];
  for (const [platform, config] of configs) {
    const env = Object.fromEntries(
      (config.Env ?? []).map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]),
    );
    for (const [name, value] of Object.entries(want.env)) {
      if (env[name] !== value) {
        problems.push(`${platform}: env ${name} is ${JSON.stringify(env[name])}, expected ${JSON.stringify(value)}`);
      }
    }
    for (const [name, value] of Object.entries(want.labels)) {
      const actual = config.Labels?.[name];
      if (actual !== value) {
        problems.push(`${platform}: label ${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
      }
    }
  }
  return problems;
}

function main() {
  const ref = process.argv[2];
  if (!ref) {
    throw new Error('usage: check-image-range.mjs IMAGE_REFERENCE');
  }
  const range = readGatewayRange();
  const inspected = JSON.parse(
    execFileSync('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Image}}'], {
      encoding: 'utf8',
    }),
  );
  const problems = declarationProblems(inspected, range);
  if (problems.length > 0) {
    throw new Error(
      `${ref} does not declare the supported gateway range (${range.range}, SDK ${range.sdk}):\n  ` +
        `${problems.join('\n  ')}\n` +
        'Check the build-args in the build job of ci.yml against the ARG names in deploy/Dockerfile.',
    );
  }
  const platforms = platformConfigs(inspected).map(([platform]) => platform);
  process.stdout.write(
    `${ref} declares gateways ${range.floor} to ${range.ceiling} and SDK ${range.sdk} on ${platforms.join(', ')}\n`,
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`check-image-range: ${error.message}\n`);
    process.exit(1);
  }
}
