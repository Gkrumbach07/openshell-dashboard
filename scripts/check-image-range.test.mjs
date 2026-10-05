// node --test "scripts/**/*.test.mjs"
//
// The range reaches the image through three places that have to agree by name:
// the build-args in ci.yml, the ARG / ENV / LABEL lines in deploy/Dockerfile,
// and what check-image-range.mjs looks for in the pushed image. Nothing here
// builds or runs an image; the checker is run against a stand-in `docker`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LABEL_PREFIX, declarationProblems, platformConfigs } from './check-image-range.mjs';
import { readGatewayRange } from './gateway-range.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = 'v0.0.0-20260928030816-6648bd0c290e';
const declared = { floor: '0.1.0', ceiling: '0.1.2', range: '>=0.1.0 <=0.1.2', sdk: SDK };

// One entry of what `docker buildx imagetools inspect --format '{{json .Image}}'` prints.
const imageConfig = (env, labels) => ({
  architecture: 'amd64',
  os: 'linux',
  config: {
    Env: ['PATH=/usr/bin', 'PORT=8080', ...env],
    Labels: { 'org.opencontainers.image.title': 'x', ...labels },
  },
});
const goodEnv = ['GATEWAY_SUPPORTED_MIN=0.1.0', 'GATEWAY_SUPPORTED_MAX=0.1.2'];
const goodLabels = {
  [`${LABEL_PREFIX}.gateway.min`]: '0.1.0',
  [`${LABEL_PREFIX}.gateway.max`]: '0.1.2',
  [`${LABEL_PREFIX}.sdk`]: SDK,
};

test('an image that declares the range on every platform has no problems', () => {
  const multiPlatform = {
    'linux/amd64': imageConfig(goodEnv, goodLabels),
    'linux/arm64': imageConfig(goodEnv, goodLabels),
  };
  assert.deepEqual(
    platformConfigs(multiPlatform).map(([platform]) => platform),
    ['linux/amd64', 'linux/arm64'],
  );
  assert.deepEqual(declarationProblems(multiPlatform, declared), []);
  // A single-platform image is one config rather than a map of them.
  assert.deepEqual(declarationProblems(imageConfig(goodEnv, goodLabels), declared), []);
});

test('an image built without the args, or with the wrong ones, is reported per platform', () => {
  // What a misspelt build arg produces: the Dockerfile default, the empty string.
  const empty = imageConfig(['GATEWAY_SUPPORTED_MIN=', 'GATEWAY_SUPPORTED_MAX='], {
    [`${LABEL_PREFIX}.gateway.min`]: '',
    [`${LABEL_PREFIX}.gateway.max`]: '',
    [`${LABEL_PREFIX}.sdk`]: '',
  });
  const problems = declarationProblems(
    { 'linux/amd64': imageConfig(goodEnv, goodLabels), 'linux/arm64': empty },
    declared,
  );
  assert.equal(problems.length, 5);
  assert.ok(problems.every((problem) => problem.startsWith('linux/arm64: ')));
  assert.ok(problems.includes('linux/arm64: env GATEWAY_SUPPORTED_MIN is "", expected "0.1.0"'));

  // An image from before the range was declared has none of it.
  assert.equal(declarationProblems(imageConfig([], {}), declared).length, 5);

  // A stale range is as wrong as a missing one.
  const stale = imageConfig(['GATEWAY_SUPPORTED_MIN=0.1.0', 'GATEWAY_SUPPORTED_MAX=0.1.1'], {
    ...goodLabels,
    [`${LABEL_PREFIX}.gateway.max`]: '0.1.1',
  });
  assert.deepEqual(declarationProblems(stale, declared), [
    'linux/amd64: env GATEWAY_SUPPORTED_MAX is "0.1.1", expected "0.1.2"',
    `linux/amd64: label ${LABEL_PREFIX}.gateway.max is "0.1.1", expected "0.1.2"`,
  ]);
});

test('nothing to check is a failure, not a pass', () => {
  assert.deepEqual(declarationProblems({}, declared), ['the registry returned no image config to check']);
  assert.deepEqual(declarationProblems(null, declared), ['the registry returned no image config to check']);
});

test('the env vars and label keys the checker expects are the ones deploy/Dockerfile sets', () => {
  const dockerfile = readFileSync(join(repoRoot, 'deploy', 'Dockerfile'), 'utf8');
  for (const label of [
    'gateway.min="${GATEWAY_SUPPORTED_MIN}"',
    'gateway.max="${GATEWAY_SUPPORTED_MAX}"',
    'sdk="${OPENSHELL_SDK_VERSION}"',
  ]) {
    assert.ok(dockerfile.includes(`${LABEL_PREFIX}.${label}`), `${LABEL_PREFIX}.${label}`);
  }
  for (const name of ['GATEWAY_SUPPORTED_MIN', 'GATEWAY_SUPPORTED_MAX']) {
    assert.ok(dockerfile.includes(`ARG ${name}=""`), `ARG ${name}`);
    assert.ok(dockerfile.includes(`${name}=\${${name}}`), `ENV ${name}`);
  }
  assert.ok(dockerfile.includes('ARG OPENSHELL_SDK_VERSION=""'));
});

test('the build job passes exactly the args the Dockerfile reads, from the derived range', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const line of [
    'GATEWAY_SUPPORTED_MIN=${{ steps.range.outputs.floor }}',
    'GATEWAY_SUPPORTED_MAX=${{ steps.range.outputs.ceiling }}',
    'OPENSHELL_SDK_VERSION=${{ steps.range.outputs.sdk }}',
  ]) {
    assert.ok(workflow.includes(line), line);
  }
});

test('check-image-range.mjs passes a correct image and fails one that claims nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'openshell-dashboard-image-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The stand-in docker answers `buildx imagetools inspect` with whatever the
  // test hands it. No registry, no daemon.
  writeFileSync(join(dir, 'docker'), '#!/usr/bin/env node\nprocess.stdout.write(process.env.STUB_IMAGE);\n');
  chmodSync(join(dir, 'docker'), 0o755);

  const committed = readGatewayRange();
  const check = (image) =>
    spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts', 'check-image-range.mjs'), 'quay.io/example/dashboard:sha-0a1b2c3'],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, STUB_IMAGE: JSON.stringify(image) },
      },
    );

  const good = imageConfig(
    [`GATEWAY_SUPPORTED_MIN=${committed.floor}`, `GATEWAY_SUPPORTED_MAX=${committed.ceiling}`],
    {
      [`${LABEL_PREFIX}.gateway.min`]: committed.floor,
      [`${LABEL_PREFIX}.gateway.max`]: committed.ceiling,
      [`${LABEL_PREFIX}.sdk`]: committed.sdk,
    },
  );
  const passed = check({ 'linux/amd64': good, 'linux/arm64': good });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /declares gateways .* on linux\/amd64, linux\/arm64/);

  const failed = check({ 'linux/amd64': good, 'linux/arm64': imageConfig([], {}) });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /does not declare the supported gateway range/);
  assert.match(failed.stderr, /linux\/arm64: env GATEWAY_SUPPORTED_MIN is undefined/);
});
