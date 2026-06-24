module.exports = {
  moduleFileExtensions: ['js', 'json'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@microsoft/signalr$': '<rootDir>/__mocks__/signalr.js',
  },
  fakeTimers: { enableGlobally: false },
}
