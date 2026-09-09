#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const consumerDir = mkdtempSync(join(tmpdir(), 'openshell-dashboard-consumer-'));
const nodeImports = ['openshell-dashboard/api'];
const browserImports = [
  'openshell-dashboard',
  'openshell-dashboard/pages',
  'openshell-dashboard/components',
  'openshell-dashboard/api',
  'openshell-dashboard/types',
  'openshell-dashboard/slots',
  'openshell-dashboard/i18n',
];

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function assertRelativeImportsHaveExtensions(dir) {
  const missingExtensions = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      missingExtensions.push(...assertRelativeImportsHaveExtensions(path));
    } else if (path.endsWith('.js')) {
      const source = readFileSync(path, 'utf8');
      const specifiers = source.matchAll(
        /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"](\.{1,2}\/[^'\"]+)['\"]/g,
      );
      for (const [, specifier] of specifiers) {
        if (!extname(specifier)) {
          missingExtensions.push(`${path}: ${specifier}`);
        }
      }
    }
  }
  return missingExtensions;
}

try {
  run('npm', ['pack', '--pack-destination', consumerDir, '--silent'], root);
  const tarball = readdirSync(consumerDir).find((file) => file.endsWith('.tgz'));
  if (!tarball) {
    throw new Error('npm pack did not produce a tarball');
  }

  // Install the library with its peer dependencies as an actual application
  // would, rather than resolving source files from this repository.
  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          'openshell-dashboard': `file:${join(consumerDir, tarball)}`,
          ...pkg.peerDependencies,
        },
      },
      null,
      2,
    )}\n`,
  );
  run('npm', ['install', '--ignore-scripts', '--omit=dev'], consumerDir);

  const missingExtensions = assertRelativeImportsHaveExtensions(
    join(consumerDir, 'node_modules', 'openshell-dashboard', 'dist'),
  );
  if (missingExtensions.length) {
    throw new Error(
      `packed ESM has extensionless relative imports:\n${missingExtensions.join('\n')}`,
    );
  }

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      nodeImports.map((entry) => `await import('${entry}');`).join('\n'),
    ],
    consumerDir,
  );

  writeFileSync(
    join(consumerDir, 'index.html'),
    '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>\n',
  );
  writeFileSync(
    join(consumerDir, 'main.js'),
    `${browserImports.map((entry, index) => `import * as module${index} from '${entry}';`).join('\n')}
console.log({ ${browserImports.map((_, index) => `module${index}`).join(', ')} });
`,
  );
  run(join(root, 'node_modules', '.bin', 'vite'), ['build'], consumerDir);
  console.log(
    `verify:consumer ok (${nodeImports.length} Node ESM import; ${browserImports.length} browser imports)`,
  );
} finally {
  rmSync(consumerDir, { recursive: true, force: true });
}
