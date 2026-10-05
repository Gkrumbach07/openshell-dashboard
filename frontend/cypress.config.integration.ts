import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'cypress';

// The integration specs create real sandboxes, so they need a real image. It
// comes from the same file that pins the gateway they run against, by digest:
// a tag such as `base:latest` written into a spec would make the gateway pull
// whatever that tag points at today.
const pins = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../deploy/ci/gateway-pins.json'),
    'utf8',
  ),
) as { sandbox_image: string };

export default defineConfig({
  expose: {
    sandboxImage: pins.sandbox_image,
  },
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e-integration/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 15000,
    requestTimeout: 15000,
    retries: { runMode: 2, openMode: 0 },
  },
});
