module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.spec.ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
    '\\.css$': '<rootDir>/src/__mocks__/styleMock.js',
    '\\.(svg|png|jpg|gif)$': '<rootDir>/src/__mocks__/fileMock.js',
    // jsdom resolves `yaml` to its browser build, which is ES modules and is
    // not transformed here. Its CommonJS build is the same library.
    '^yaml$': '<rootDir>/node_modules/yaml/dist/index.js',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/__mocks__/**',
  ],
};
