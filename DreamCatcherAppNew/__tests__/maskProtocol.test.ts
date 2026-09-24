/**
 * @format
 */

import {
  NightLogReader,
  NightReport,
  epochTime,
  parseStatus,
  parseTestSample,
  parseTestSummary,
  summarizeNight,
} from '../src/ble/maskProtocol';

test('parses status, sensor test readings and summaries', () => {
  expect(parseStatus('S:1,27,4')).toEqual({ hasLog: true, cueLevel: 27, sensitivity: 4 });
  expect(parseStatus('S:0,30,3')).toEqual({ hasLog: false, cueLevel: 30, sensitivity: 3 });
  expect(parseStatus('S:x')).toBeNull();
  expect(parseStatus('ACK: hi')).toBeNull();

  expect(parseTestSample('1240,2051,1')).toEqual({ t: 1240, value: 2051, movement: 1 });
  expect(parseTestSample('1240,2051,7')).toEqual({ t: 1240, value: 2051, movement: 0 });
  expect(parseTestSample('ACK: sensor test started')).toBeNull();
  expect(parseTestSample('1,2')).toBeNull();

  expect(parseTestSummary('B:12,1')).toEqual({ eyeMovesLastMinute: 12, remLike: true });
  expect(parseTestSummary('B:3,0')).toEqual({ eyeMovesLastMinute: 3, remLike: false });
  expect(parseTestSummary('12,1')).toBeNull();
});

test('reads a night log', () => {
  const lines = ['LOG:5,2', 'LS:1790000000,30', 'LV:3,30,24', 'E0:000FF20A6002', 'E4:0F9', 'C:1,30,2', 'C:2,21,0'];
  const reader = new NightLogReader();
  for (const line of lines) {
    expect(NightLogReader.isLogMessage(line)).toBe(true);
    expect(reader.add(line)).toBeNull();
  }
  const report = reader.add('LOG_END');

  expect(report).toEqual({
    startUnix: 1790000000,
    epochSec: 30,
    sensitivity: 3,
    startLevel: 30,
    endLevel: 24,
    epochs: [
      { eyeMoves: 0, body: false, rem: false, cue: false, badSignal: false },
      { eyeMoves: 255, body: false, rem: true, cue: false, badSignal: false },
      { eyeMoves: 10, body: false, rem: true, cue: true, badSignal: false },
      { eyeMoves: 0, body: false, rem: true, cue: false, badSignal: false },
      { eyeMoves: 15, body: true, rem: false, cue: false, badSignal: true },
    ],
    cues: [
      { epoch: 1, level: 30, outcome: 'woke' },
      { epoch: 2, level: 21, outcome: 'unknown' },
    ],
  });
  expect(NightLogReader.isLogMessage('1240,2051,1')).toBe(false);
  expect(NightLogReader.isLogMessage('ACK: light turned on')).toBe(false);
});

const epoch = (rem: boolean, badSignal = false) => ({ eyeMoves: 0, body: false, rem, cue: false, badSignal });

test('summarises a night, joining REM epochs less than 2 minutes apart', () => {
  const report: NightReport = {
    startUnix: 0,
    epochSec: 30,
    sensitivity: 3,
    startLevel: 30,
    endLevel: 30,
    // REM at 2-3, a 1.5 minute gap, REM at 7, then a 3 minute gap and REM at 14-15
    epochs: [
      ...[0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1].map(r => epoch(r === 1)),
      epoch(false, true),
      epoch(false, true),
    ],
    cues: [
      { epoch: 3, level: 30, outcome: 'woke' },
      { epoch: 14, level: 21, outcome: 'slept' },
      { epoch: 15, level: 24, outcome: 'unknown' },
    ],
  };

  expect(summarizeNight(report)).toEqual({
    durationMin: 9,
    remPeriods: [
      { startEpoch: 2, endEpoch: 7 },
      { startEpoch: 14, endEpoch: 15 },
    ],
    remMinutes: 3,
    cues: 3,
    cuesWoke: 1,
    cuesSlept: 1,
    badSignalMinutes: 1,
  });
});

test('gives clock times for epochs only when the start time is known', () => {
  const report = { startUnix: 1790000000, epochSec: 30 } as NightReport;
  expect(epochTime(report, 4)?.getTime()).toBe((1790000000 + 120) * 1000);
  expect(epochTime({ ...report, startUnix: 0 }, 4)).toBeNull();
});
