// Parses the text messages the mask sends over Bluetooth.
// The format is documented in arduino/DreamCatcher_v3/README.md.

export type Movement = 0 | 1 | 2; // none, eye movement, body movement

export interface MaskStatus {
    hasLog: boolean;
    cueLevel: number; // percent
    sensitivity: number; // 1-5
}

export interface TestSample {
    t: number; // ms since the test started
    value: number; // raw sensor reading, 0-4095
    movement: Movement;
}

export interface TestSummary {
    eyeMovesLastMinute: number;
    remLike: boolean;
}

export interface NightEpoch {
    eyeMoves: number;
    body: boolean;
    rem: boolean;
    cue: boolean;
    badSignal: boolean;
}

export type CueOutcome = 'unknown' | 'slept' | 'woke';

export interface NightCue {
    epoch: number;
    level: number;
    outcome: CueOutcome;
}

export interface NightReport {
    startUnix: number; // 0 if the mask didn't know the time
    epochSec: number;
    sensitivity: number;
    startLevel: number;
    endLevel: number;
    epochs: NightEpoch[];
    cues: NightCue[];
}

// Readings outside this range mean the sensor can't see the eye (matches DreamLogic.h)
export const SENSOR_MIN_VALID = 30;
export const SENSOR_MAX_VALID = 4065;

const toInts = (text: string) => text.split(',').map(part => parseInt(part, 10));

export function parseStatus(line: string): MaskStatus | null {
    if (!line.startsWith('S:')) {
        return null;
    }
    const [hasLog, cueLevel, sensitivity] = toInts(line.slice(2));
    if ([hasLog, cueLevel, sensitivity].some(Number.isNaN)) {
        return null;
    }
    return { hasLog: hasLog === 1, cueLevel, sensitivity };
}

export function parseTestSample(line: string): TestSample | null {
    const parts = toInts(line);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }
    const [t, value, movement] = parts;
    return { t, value, movement: (movement === 1 || movement === 2 ? movement : 0) as Movement };
}

export function parseTestSummary(line: string): TestSummary | null {
    if (!line.startsWith('B:')) {
        return null;
    }
    const [eyeMovesLastMinute, remLike] = toInts(line.slice(2));
    if (Number.isNaN(eyeMovesLastMinute)) {
        return null;
    }
    return { eyeMovesLastMinute, remLike: remLike === 1 };
}

const CUE_OUTCOMES: CueOutcome[] = ['unknown', 'slept', 'woke'];

// Collects the messages of a night log download (LOG: ... LOG_END)
export class NightLogReader {
    private report: NightReport = {
        startUnix: 0,
        epochSec: 30,
        sensitivity: 0,
        startLevel: 0,
        endLevel: 0,
        epochs: [],
        cues: [],
    };

    static isLogMessage(line: string) {
        return /^(LOG:|LS:|LV:|E\d+:|C:|LOG_END$)/.test(line);
    }

    // Returns the finished report once LOG_END arrives, otherwise null
    add(line: string): NightReport | null {
        if (line === 'LOG_END') {
            return this.report;
        }
        if (line.startsWith('LS:')) {
            const [startUnix, epochSec] = toInts(line.slice(3));
            this.report.startUnix = startUnix || 0;
            this.report.epochSec = epochSec || 30;
        } else if (line.startsWith('LV:')) {
            const [sensitivity, startLevel, endLevel] = toInts(line.slice(3));
            Object.assign(this.report, { sensitivity, startLevel, endLevel });
        } else if (line.startsWith('C:')) {
            const [epoch, level, outcome] = toInts(line.slice(2));
            this.report.cues.push({ epoch, level, outcome: CUE_OUTCOMES[outcome] ?? 'unknown' });
        } else if (/^E\d+:/.test(line)) {
            const [index, hex] = line.slice(1).split(':');
            const first = parseInt(index, 10);
            for (let i = 0; i + 3 <= hex.length; i += 3) {
                // Each epoch is 2 hex digits of eye movements and 1 of flag bits
                /* eslint-disable no-bitwise */
                const flags = parseInt(hex[i + 2], 16);
                this.report.epochs[first + i / 3] = {
                    eyeMoves: parseInt(hex.slice(i, i + 2), 16),
                    body: (flags & 1) !== 0,
                    rem: (flags & 2) !== 0,
                    cue: (flags & 4) !== 0,
                    badSignal: (flags & 8) !== 0,
                };
                /* eslint-enable no-bitwise */
            }
        }
        return null;
    }
}

export interface RemPeriod {
    startEpoch: number;
    endEpoch: number; // inclusive
}

export interface NightSummary {
    durationMin: number;
    remPeriods: RemPeriod[];
    remMinutes: number;
    cues: number;
    cuesWoke: number;
    cuesSlept: number;
    badSignalMinutes: number;
}

// REM epochs this close together (2 minutes) count as one REM period
const REM_GAP_EPOCHS = 4;

export function summarizeNight(report: NightReport): NightSummary {
    const minutes = (epochs: number) => Math.round((epochs * report.epochSec) / 60);
    const remPeriods: RemPeriod[] = [];
    report.epochs.forEach((epoch, i) => {
        if (!epoch?.rem) {
            return;
        }
        const last = remPeriods[remPeriods.length - 1];
        if (last && i - last.endEpoch <= REM_GAP_EPOCHS) {
            last.endEpoch = i;
        } else {
            remPeriods.push({ startEpoch: i, endEpoch: i });
        }
    });

    return {
        durationMin: minutes(report.epochs.length),
        remPeriods,
        remMinutes: minutes(report.epochs.filter(e => e?.rem).length),
        cues: report.cues.length,
        cuesWoke: report.cues.filter(c => c.outcome === 'woke').length,
        cuesSlept: report.cues.filter(c => c.outcome === 'slept').length,
        badSignalMinutes: minutes(report.epochs.filter(e => e?.badSignal).length),
    };
}

// Clock time of an epoch, or null if the mask didn't know when the night started
export function epochTime(report: NightReport, epoch: number): Date | null {
    return report.startUnix > 0 ? new Date((report.startUnix + epoch * report.epochSec) * 1000) : null;
}
