import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The commit the build is made from, when whatever runs the build says so:
// CI passes DASHBOARD_COMMIT to the image build (deploy/Dockerfile). The About
// dialog shows it. Nothing else identifies a build: the image exists before
// any release does and is only given more tags when one is cut, so no version
// number can be compiled in.
//
// Left unset, the dialog shows no commit. Set to something that is not a
// commit id, the build stops: better than an About dialog that states one.
const commit = (process.env.DASHBOARD_COMMIT ?? '').trim();
if (commit !== '' && !/^[0-9a-f]{7,40}$/.test(commit)) {
  throw new Error(
    `DASHBOARD_COMMIT is ${JSON.stringify(commit)}, which is not a git commit id (7 to 40 hex characters). ` +
      'Pass the commit the build is made from, or leave it unset.',
  );
}

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __DASHBOARD_COMMIT__: JSON.stringify(commit),
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.BFF_URL || 'http://localhost:8080',
        // Preserve the browser Host header so the BFF WebSocket Origin
        // check (origin === http(s):// + Host) still passes in dev.
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  optimizeDeps: {
    include: [
      '@patternfly/react-core',
      '@patternfly/react-code-editor',
      'monaco-editor',
    ],
  },
});
