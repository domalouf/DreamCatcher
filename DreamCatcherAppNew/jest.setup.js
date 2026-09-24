/* eslint-env jest */
// Stand-ins for native modules that don't exist when running under Jest.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-system-navigation-bar', () => ({
  stickyImmersive: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-vector-icons/fontawesome', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: Text };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return Text;
});

jest.mock('@react-native-community/blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

jest.mock('react-native-linear-gradient', () => {
  const { View } = require('react-native');
  return View;
});

// Renders a plain View carrying the picker's props so tests can fire onChange
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: props => React.createElement(View, { ...props, testID: 'time-picker' }),
  };
});

// Records the data it was given and how many times it has been mounted
jest.mock('react-native-chart-kit', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mounts = { count: 0 };
  const LineChart = props => {
    React.useEffect(() => {
      mounts.count++;
    }, []);
    return React.createElement(View, { ...props, testID: 'line-chart' });
  };
  return { LineChart, __mounts: mounts };
});

// BLE event callbacks are kept in __listeners so tests can simulate the mask
jest.mock('react-native-ble-manager', () => {
  const listeners = {};
  const on = event =>
    jest.fn(callback => {
      listeners[event] = callback;
      return {
        remove: jest.fn(() => {
          if (listeners[event] === callback) {
            delete listeners[event];
          }
        }),
      };
    });
  return {
    __esModule: true,
    __listeners: listeners,
    BleScanCallbackType: { AllMatches: 1 },
    BleScanMatchMode: { Sticky: 2 },
    BleScanMode: { LowLatency: 2 },
    default: {
      start: jest.fn(() => Promise.resolve()),
      scan: jest.fn(() => Promise.resolve()),
      connect: jest.fn(() => Promise.resolve()),
      disconnect: jest.fn(() => Promise.resolve()),
      isPeripheralConnected: jest.fn(() => Promise.resolve(true)),
      retrieveServices: jest.fn(() => Promise.resolve({})),
      readRSSI: jest.fn(() => Promise.resolve(-50)),
      startNotification: jest.fn(() => Promise.resolve()),
      write: jest.fn(() => Promise.resolve()),
      onDiscoverPeripheral: on('discoverPeripheral'),
      onStopScan: on('stopScan'),
      onConnectPeripheral: on('connectPeripheral'),
      onDidUpdateValueForCharacteristic: on('updateValue'),
      onDisconnectPeripheral: on('disconnectPeripheral'),
    },
  };
});
