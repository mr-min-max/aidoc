module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
    'node_modules/commander/.+\\.js$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: { allowJs: true },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!commander/)'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/cli/index.ts',
    '!src/**/types.ts'
  ],
  coverageThreshold: {
    global: { branches: 50, functions: 60, lines: 60, statements: 60 }
  }
};
