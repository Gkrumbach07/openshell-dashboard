// node --test "scripts/**/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveGatewayRange, formatRange, readGatewayRange, sdkInGoMod } from './gateway-range.mjs';
import { BEGIN, END, renderBlock, replaceBlock } from './readme-gateway-range.mjs';

const SDK = 'v0.0.0-20260928030816-6648bd0c290e';
const lane = (version, required = true) => ({ version, label: version, required });

test('the floor is the lowest required lane and the ceiling the highest, whatever their order', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2'), lane('0.1.0')] });
  assert.deepEqual(range, {
    floor: '0.1.0',
    ceiling: '0.1.2',
    range: '>=0.1.0 <=0.1.2',
    sdk: SDK,
    tested: ['0.1.0', '0.1.2'],
  });
  assert.equal(formatRange(range), '0.1.0 – 0.1.2');
});

test('versions compare as numbers, not as strings', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.9.0'), lane('0.10.0'), lane('0.2.11')] });
  assert.equal(range.floor, '0.2.11');
  assert.equal(range.ceiling, '0.10.0');
});

test('an advisory lane proves nothing, so it does not widen the range', () => {
  const range = deriveGatewayRange({
    sdk: SDK,
    lanes: [lane('0.0.116', false), lane('0.1.0'), lane('0.1.2'), lane('0.1.3-dev.84', false)],
  });
  assert.equal(range.range, '>=0.1.0 <=0.1.2');
});

test('a single required lane is a range of one release', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2')] });
  assert.equal(range.range, '>=0.1.2 <=0.1.2');
  assert.equal(formatRange(range), '0.1.2');
});

test('a required lane that is not a release is refused, not folded into the range', () => {
  for (const version of ['dev', '0.1.3-dev.84', '0.1.3-pre.4', 'latest', 'v0.1.2', undefined]) {
    assert.throws(
      () => deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.0'), lane(version)] }),
      /not a gateway release/,
      `version ${version}`,
    );
  }
});

test('there is no range without a required lane, and no declaration without the SDK', () => {
  assert.throws(
    () => deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2', false)] }),
    /no lane has "required": true/,
  );
  assert.throws(() => deriveGatewayRange({ sdk: SDK }), /no lane has "required": true/);
  assert.throws(() => deriveGatewayRange({ lanes: [lane('0.1.2')] }), /"sdk" is missing/);
});

test('the committed pins give a range, and name the SDK that backend/go.mod builds against', () => {
  const range = readGatewayRange();
  assert.match(range.floor, /^\d+\.\d+\.\d+$/);
  assert.match(range.ceiling, /^\d+\.\d+\.\d+$/);
  assert.equal(range.sdk, sdkInGoMod());
});

test('the README block is replaced in place and everything around it is kept', () => {
  const range = deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.0'), lane('0.1.2')] });
  const block = renderBlock(range);
  const readme = `# Title\n\nbefore\n\n${BEGIN}\nstale\n${END}\n\nafter\n`;

  const updated = replaceBlock(readme, block);
  assert.equal(updated, `# Title\n\nbefore\n\n${block}\n\nafter\n`);
  assert.match(updated, /\| Oldest supported gateway \| `0\.1\.0` \|/);
  assert.match(updated, /\| Newest tested gateway \| `0\.1\.2` \|/);
  // Regenerating an up-to-date README changes nothing, which is what --check relies on.
  assert.equal(replaceBlock(updated, block), updated);
});

test('a README without exactly one pair of markers is an error, not a silent no-op', () => {
  const block = renderBlock(deriveGatewayRange({ sdk: SDK, lanes: [lane('0.1.2')] }));
  assert.throws(() => replaceBlock('# Title\n', block), /markers are missing/);
  assert.throws(() => replaceBlock(`${END}\n${BEGIN}\n`, block), /markers are missing or out of order/);
  assert.throws(() => replaceBlock(`${BEGIN}\n${END}\n${BEGIN}\n${END}\n`, block), /more than once/);
});
