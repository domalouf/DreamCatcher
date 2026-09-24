/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

const hasText = (root: ReactTestInstance, label: string) =>
  root.findAll(n => n.type === Text && [n.props.children].flat().join('') === label).length > 0;

// Calls onPress on the nearest pressable wrapping the text `label` (the nth one if there are several)
function press(root: ReactTestInstance, label: string, nth = 0) {
  let node: ReactTestInstance | null = root.findAll(
    n => n.type === Text && [n.props.children].flat().join('') === label,
  )[nth];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node!.props.onPress();
}

// Renders the screen and connects to the mask; writes made while connecting are cleared
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
  ble.write.mockClear();
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

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  chartMounts.count = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('connects to a discovered mask, enables notifications and asks for its status', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ConnectScreen />);
  });
  await act(async () => listeners.discoverPeripheral({ ...MASK }));
  await act(async () => {
    press(renderer.root, 'Dream Catcher - ');
    await jest.advanceTimersByTimeAsync(1500);
  });

  expect(ble.connect).toHaveBeenCalledWith(MASK.id);
  expect(ble.startNotification).toHaveBeenCalledWith(
    MASK.id,
    '7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19',
    '8b38e5b5-2b9a-4954-9281-fcab195b0912',
  );
  expect(writtenStrings()).toEqual(['status: get']);
});

test('shows the cue settings stored on the mask and sends changes', async () => {
  const renderer = await renderConnected();
  await notify('S:0,30,3');

  expect(hasText(renderer.root, '30%')).toBe(true);
  expect(hasText(renderer.root, 'Balanced')).toBe(true);

  await act(async () => press(renderer.root, '+', 0));
  await act(async () => press(renderer.root, '+', 1));
  await act(async () => press(renderer.root, 'Preview Cue'));

  expect(writtenStrings()).toEqual(['cue: 35', 'sens: 4', 'cue: preview']);
  expect(hasText(renderer.root, '35%')).toBe(true);
  expect(hasText(renderer.root, 'Eager')).toBe(true);
});

test('streams the sensor test into the graph, marking movements, without re-subscribing to BLE or remounting the chart', async () => {
  const renderer = await renderConnected();

  await act(async () => press(renderer.root, 'Start Sensor Test'));
  expect(writtenStrings()).toEqual(['test: start']);

  await notify('ACK: sensor test started');
  await notify('0,2000,0');
  await notify('40,2010,0');
  await notify('80,2100,1');
  await act(async () => jest.advanceTimersByTimeAsync(200));
  await notify('120,2400,2');
  await notify('B:7,1');
  await act(async () => jest.advanceTimersByTimeAsync(200));

  const chart = renderer.root.findByProps({ testID: 'line-chart' });
  expect(chart.props.data.datasets[0].data).toEqual([2000, 2010, 2100, 2400]);
  expect(chart.props.hidePointsAtIndex).toEqual([0, 1]); // dots only where movements were detected
  expect(chartMounts.count).toBe(1);
  expect(hasText(renderer.root, 'Reading: 2400')).toBe(true);
  expect(hasText(renderer.root, 'Eye movements: 1 · Body movements: 1')).toBe(true);
  expect(hasText(renderer.root, 'Last minute: 7 eye movements - would count as REM')).toBe(true);

  await notify('TEST_END');
  await notify('160,1990,0'); // ignored once the test has ended
  await act(async () => jest.advanceTimersByTimeAsync(200));

  expect(renderer.root.findByProps({ testID: 'line-chart' }).props.data.datasets[0].data)
    .toEqual([2000, 2010, 2100, 2400]);
  expect(hasText(renderer.root, 'Start Sensor Test')).toBe(true);

  // BLE was only initialised, and listeners only registered, once for the whole session
  expect(ble.start).toHaveBeenCalledTimes(1);
  expect(ble.onDidUpdateValueForCharacteristic).toHaveBeenCalledTimes(1);
});

// A 3 minute night: REM in epochs 1-3, one cue slept through in epoch 2, a body movement in epoch 4
const NIGHT_LOG = ['LOG:6,1', 'LS:1790000000,30', 'LV:3,30,35', 'E0:000052096072', 'E4:011000', 'C:2,30,1', 'LOG_END'];

test('downloads the night log when the mask has one and shows the report', async () => {
  const renderer = await renderConnected();

  await notify('S:1,30,3');
  expect(writtenStrings()).toEqual(['log: get']);
  expect(hasText(renderer.root, 'Downloading…')).toBe(true);

  for (const line of NIGHT_LOG) {
    await notify(line);
  }

  expect(hasText(renderer.root, 'REM: 1 period, 2 min')).toBe(true);
  expect(hasText(renderer.root, 'Cues: 1 (0 woke you, 1 slept through)')).toBe(true);
  expect(hasText(renderer.root, 'Cue brightness: 30% → 35% for next night')).toBe(true);
  expect(hasText(renderer.root, 'Download Last Night')).toBe(true);

  const saved = JSON.parse((await AsyncStorage.getItem('@night_reports_v1'))!);
  expect(saved).toHaveLength(1);
  expect(saved[0].cues).toEqual([{ epoch: 2, level: 30, outcome: 'slept' }]);
});

test('shows the last saved night report without connecting', async () => {
  const renderer = await renderConnected();
  await notify('S:1,30,3');
  for (const line of NIGHT_LOG) {
    await notify(line);
  }
  renderer.unmount();

  let reopened!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    reopened = ReactTestRenderer.create(<ConnectScreen />);
  });

  expect(hasText(reopened.root, 'Not Connected')).toBe(true);
  expect(hasText(reopened.root, 'Cues: 1 (0 woke you, 1 slept through)')).toBe(true);
});

test.each([
  // now, picked start, picked end, expected startTime, expected scanTime
  ['start after midnight', [23, 0], [3, 0], [7, 0], 4 * 3600, 4 * 3600],
  ['end after midnight', [21, 0], [23, 30], [6, 30], 2.5 * 3600, 7 * 3600],
  ['same evening', [20, 0], [21, 0], [22, 15], 3600, 1.25 * 3600],
])('sends the clock and a positive time window when the %s', async (_name, now, start, end, startTime, scanTime) => {
  const renderer = await renderConnected();
  const nowDate = new Date(2026, 0, 10, now[0], now[1]);
  jest.setSystemTime(nowDate);

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

  expect(writtenStrings()).toEqual([
    `now: ${nowDate.getTime() / 1000}`,
    `startTime: ${startTime}`,
    `scanTime: ${scanTime}`,
  ]);
});

test('refuses a time window with the same start and end', async () => {
  const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  const renderer = await renderConnected();

  await act(async () => press(renderer.root, 'Submit Time Window'));

  expect(alert).toHaveBeenCalled();
  expect(ble.write).not.toHaveBeenCalled();
});
