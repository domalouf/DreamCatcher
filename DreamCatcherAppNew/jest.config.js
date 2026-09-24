module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  // These packages ship untranspiled ESM, so let babel transform them too
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-vector-icons|@react-navigation|react-native-.*)/)',
  ],
};
