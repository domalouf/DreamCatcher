/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';
import BleManager, * as bleModule from 'react-native-ble-manager';
import * as chartKit from 'react-native-chart-kit';
import ConnectScreen from '../src/screens/ConnectScreen';

const listeners = (bleModule as any).__listeners;
const chartMounts = (chartKit as any).__mounts;
const ble = BleManager as jest.Mocked<typeof BleManager>;

const MASK = { id: 'AA:BB:CC', name: 'Dream Catcher', rssi: -60, advertising: {} };

const toBytes = (s: string) => Array.from(s, c => c.charCodeAt(0));
const fromBytes = (bytes: number[]) => String.fromCharCode(...bytes);
const writtenStrings = () => ble.write.mock.calls.map(call => fromBytes(call[3]));

const findText = (root: ReactTestInstance, label: string) =>
  root.find(n => n.type === Text && [n.props.children].flat().join('') === label);

// Calls onPress on the nearest pressable wrapping the text `label`
function press(root: ReactTestInstance, label: string) {
  let node: ReactTestInstance | null = findText(root, label);
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node!.props.onPress();
}

async function renderConnected() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ConnectScreen />);
  });
  await act(async () => listeners.discoverPeripheral({ ...MASK }));
  await act(async () => {
    press(renderer.root, 'Dream Catcher - ');
    await jest.advanceTimersByTimeAsync(1500);
  });
  return renderer;
}

function notify(value: string) {
  return act(async () =>
    listeners.updateValue({
      peripheral: MASK.id,
      characteristic: '',
      service: '',
      value: toBytes(value),
    }),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  chartMounts.count = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('connects to a discovered mask and enables notifications', async () => {
  await renderConnected();

  expect(ble.connect).toHaveBeenCalledWith(MASK.id);
  expect(ble.startNotification).toHaveBeenCalledWith(
    MASK.id,
    '7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19',
    '8b38e5b5-2b9a-4954-9281-fcab195b0912',
  );
});

test('streams QTR data into the graph without re-subscribing to BLE or remounting the chart', async () => {
  const renderer = await renderConnected();

  await act(async () => press(renderer.root, 'QTR Collect'));
  expect(writtenStrings()).toEqual(['qtr: collect']);

  await notify('ACK: QTR data collection started');
  await notify('0,500');
  await notify('100,520');
  await notify('200,510');

  const chart = renderer.root.findByProps({ testID: 'line-chart' });
  expect(chart.props.data.datasets[0].data).toEqual([500, 520, 510]);
  expect(chartMounts.count).toBe(1);

  await notify('QTR_DATA_END');
  await notify('300,999'); // ignored once collection has ended

  expect(renderer.root.findByProps({ testID: 'line-chart' }).props.data.datasets[0].data)
    .toEqual([500, 520, 510]);
  findText(renderer.root, 'QTR data collection complete');

  // BLE was only initialised, and listeners only registered, once for the whole session
  expect(ble.start).toHaveBeenCalledTimes(1);
  expect(ble.onDidUpdateValueForCharacteristic).toHaveBeenCalledTimes(1);
});

test.each([
  // now, picked start, picked end, expected startTime, expected scanTime
  ['start after midnight', [23, 0], [3, 0], [7, 0], 4 * 3600, 4 * 3600],
  ['end after midnight', [21, 0], [23, 30], [6, 30], 2.5 * 3600, 7 * 3600],
  ['same evening', [20, 0], [21, 0], [22, 15], 3600, 1.25 * 3600],
])('sends a positive time window when the %s', async (_name, now, start, end, startTime, scanTime) => {
  const renderer = await renderConnected();
  jest.setSystemTime(new Date(2026, 0, 10, now[0], now[1]));

  // Like the real picker, the chosen time keeps the date the picker was opened with (today)
  const pickTime = async (button: string, [h, m]: number[]) => {
    await act(async () => press(renderer.root, button));
    await act(async () =>
      renderer.root
        .findByProps({ testID: 'time-picker' })
        .props.onChange({ type: 'set' }, new Date(2026, 0, 10, h, m)),
    );
  };
  await pickTime('Set Start Time', start);
  await pickTime('Set End Time', end);

  await act(async () => press(renderer.root, 'Submit Time Window'));

  expect(writtenStrings()).toEqual([`startTime: ${startTime}`, `scanTime: ${scanTime}`]);
});

test('refuses a time window with the same start and end', async () => {
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  const renderer = await renderConnected();

  await act(async () => press(renderer.root, 'Submit Time Window'));

  expect(alert).toHaveBeenCalled();
  expect(ble.write).not.toHaveBeenCalled();
});
