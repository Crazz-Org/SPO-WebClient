/** @type {import('jest').Config} */

/** Vite define replacements — must be mirrored here for Jest */
const sharedGlobals = {
  __APP_VERSION__: '"0.0.0-dev"',
  __BUILD_DATE__: '"test"',
  __BUILD_TIME__: '"00:00:00"',
  __BUILD_NUMBER__: '"0"',
};

/** Shared module resolution used by both projects */
const sharedModuleConfig = {
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '\\.module\\.css$': '<rootDir>/src/__mocks__/css-module.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
    '^@client/(.*)$': '<rootDir>/src/client/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        lib: ['ES2021', 'DOM'],
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        types: ['jest', 'node'],
        isolatedModules: true
      }
    }]
  },
};

module.exports = {
  projects: [
    // Project 1: Existing node-env tests (.test.ts)
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/server/__tests__/setup/jest-setup.ts'],
      globals: sharedGlobals,
      ...sharedModuleConfig,
    },
    // Project 2: Component smoke tests (.test.tsx) — jsdom environment
    {
      displayName: 'component',
      preset: 'ts-jest',
      testEnvironment: '<rootDir>/scripts/jest-jsdom-text-encoder-env.js',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.test.tsx'],
      setupFilesAfterEnv: [
        '<rootDir>/src/server/__tests__/setup/jest-setup.ts',
        '<rootDir>/src/client/__tests__/setup/component-setup.ts',
      ],
      globals: sharedGlobals,
      ...sharedModuleConfig,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__mocks__/**',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Coverage ratchet — thresholds locked to actual values (2026-03-11 baseline)
  // These can only go UP. Run `npm run test:coverage` to see current values.
  coverageThreshold: {
    global: {
      lines: 38,
      functions: 39,
      branches: 29,
      statements: 38
    },
    './src/shared/': {
      lines: 54,
      functions: 65,
      branches: 37,
      statements: 54
    },
    './src/shared/building-details/': {
      lines: 92,
      functions: 100,
      branches: 80,
      statements: 91
    },
    './src/shared/types/': {
      lines: 96,
      functions: 73,
      branches: 90,
      statements: 96
    },
  },
  testTimeout: 10000,
  verbose: true
};
