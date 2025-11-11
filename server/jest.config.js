module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@middlewares/(.*)$': '<rootDir>/src/middlewares/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
      diagnostics: false,
    },
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};

