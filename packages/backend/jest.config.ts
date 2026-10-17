import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@/database/(.*)$': '<rootDir>/src/database/$1',
    '^@/shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/database/migrations/**',
    '!src/database/seeds/**',
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
};

export default config;
