module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: ['node_modules/(?!(@react-native|react-native)/)'],
  transform: {
    '\\.[jt]sx?$': 'babel-jest',
  },
  // The config plugin (plugin/) is tested here too.
  roots: ['<rootDir>/src/', '<rootDir>/plugin/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/lib/'],
  modulePathIgnorePatterns: ['<rootDir>/example/node_modules', '<rootDir>/lib/'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/node_modules/react-native',
    // The plugin imports `expo/config-plugins`, as an Expo plugin should; here that is the package behind it.
    '^expo/config-plugins$': '<rootDir>/node_modules/@expo/config-plugins',
  },
  collectCoverageFrom: ['src/**/*.(ts|tsx)', '!src/**/*.test.*', '!src/**/__tests__/**'],
  resetMocks: true,
  resetModules: true,
  coverageReporters: ['json', 'lcov', 'text', 'html'],
  testEnvironment: 'node',
};
