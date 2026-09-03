#!/usr/bin/env node
/**
 * Required artifacts after `build:lib` (tsc + tsc-alias).
 * One entry per published barrel — not per locale file.
 */
export const REQUIRED = [
  'dist/pages/index.js',
  'dist/pages/index.d.ts',
  'dist/components/index.js',
  'dist/components/index.d.ts',
  'dist/api/index.js',
  'dist/api/index.d.ts',
  'dist/types/index.d.ts',
  'dist/slots/index.js',
  'dist/slots/index.d.ts',
  'dist/i18n/index.js',
  'dist/i18n/index.d.ts',
];
