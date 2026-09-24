import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

import { COLORS } from '../theme/theme';
import { CueOutcome, NightReport, epochTime, summarizeNight } from '../ble/maskProtocol';
import { panelStyles, CHART_CONFIG } from './panelStyles';

const BUCKET_EPOCHS = 10; // the chart shows 5 minute buckets

const OUTCOME_TEXT: Record<CueOutcome, string> = {
    slept: 'slept through',
    woke: 'woke you',
    unknown: 'reaction unknown',
};
const OUTCOME_COLOR: Record<CueOutcome, string> = {
    slept: '#34C759',
    woke: '#FF3B30',
    unknown: COLORS.primaryOrangeHex,
};

interface Props {
    report: NightReport | null;
    canDownload: boolean;
    downloading: boolean;
    onDownload: () => void;
}

// Clock time when the night's start is known, otherwise time into the window
function formatEpoch(report: NightReport, epoch: number) {
    const time = epochTime(report, epoch);
    if (time) {
        return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const minutes = Math.round((epoch * report.epochSec) / 60);
    return `+${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const NightReportView = ({ report }: { report: NightReport }) => {
    const summary = summarizeNight(report);

    // Eye movements per 5 minutes, with a dot where a cue was given
    const buckets: { eyeMoves: number, cue?: CueOutcome }[] = [];
    report.epochs.forEach((epoch, i) => {
        const bucket = Math.floor(i / BUCKET_EPOCHS);
        buckets[bucket] = buckets[bucket] ?? { eyeMoves: 0 };
        buckets[bucket].eyeMoves += epoch?.eyeMoves ?? 0;
    });
    report.cues.forEach(cue => {
        const bucket = buckets[Math.floor(cue.epoch / BUCKET_EPOCHS)];
        if (bucket && bucket.cue !== 'woke') {
            bucket.cue = cue.outcome;
        }
    });
    const bucketsPerHour = 3600 / (report.epochSec * BUCKET_EPOCHS);
    const labels = buckets.map((_, i) => (i % bucketsPerHour === 0 ? formatEpoch(report, i * BUCKET_EPOCHS) : ''));

    return (
        <View style={panelStyles.card} testID="night-report">
            <Text style={panelStyles.text}>
                {formatEpoch(report, 0)} – {formatEpoch(report, report.epochs.length)} ({summary.durationMin} min)
            </Text>
            <Text style={panelStyles.text}>
                REM: {summary.remPeriods.length} {summary.remPeriods.length === 1 ? 'period' : 'periods'}, {summary.remMinutes} min
            </Text>
            <Text style={panelStyles.text}>
                Cues: {summary.cues} ({summary.cuesWoke} woke you, {summary.cuesSlept} slept through)
            </Text>
            <Text style={panelStyles.text}>
                Cue brightness: {report.startLevel}% → {report.endLevel}% for next night
            </Text>
            {summary.badSignalMinutes > 0 && (
                <Text style={panelStyles.text}>
                    The sensor couldn't see your eye for {summary.badSignalMinutes} min - check its position.
                </Text>
            )}

            {buckets.length > 1 && (
                <LineChart
                    data={{ labels, datasets: [{ data: buckets.map(b => b.eyeMoves), color: () => COLORS.primaryBlueHex }] }}
                    width={330}
                    height={180}
                    withInnerLines={false}
                    withShadow={false}
                    hidePointsAtIndex={buckets.flatMap((b, i) => (b.cue ? [] : [i]))}
                    getDotColor={(_, i) => OUTCOME_COLOR[buckets[i]?.cue ?? 'unknown']}
                    chartConfig={CHART_CONFIG}
                    style={panelStyles.chart}
                />
            )}
            <Text style={panelStyles.hint}>Eye movements per 5 minutes. Dots mark cues.</Text>

            {summary.remPeriods.map(period => (
                <Text key={`rem-${period.startEpoch}`} style={panelStyles.text}>
                    REM {formatEpoch(report, period.startEpoch)} – {formatEpoch(report, period.endEpoch + 1)}
                </Text>
            ))}
            {report.cues.map((cue, i) => (
                <Text key={`cue-${i}`} style={panelStyles.text}>
                    Cue {formatEpoch(report, cue.epoch)} at {cue.level}%: {OUTCOME_TEXT[cue.outcome]}
                </Text>
            ))}
        </View>
    );
};

// The last night's REM and cue report, downloaded from the mask
const NightReportPanel = ({ report, canDownload, downloading, onDownload }: Props) => {
    if (!report && !canDownload) {
        return null;
    }
    return (
        <View>
            <Text style={panelStyles.sectionTitle}>Last Night</Text>
            {canDownload && (
                <TouchableOpacity
                    onPress={onDownload}
                    disabled={downloading}
                    style={[panelStyles.button, downloading && panelStyles.buttonDisabled]}>
                    <Text style={panelStyles.buttonText}>{downloading ? 'Downloading…' : 'Download Last Night'}</Text>
                </TouchableOpacity>
            )}
            {report ? (
                <NightReportView report={report} />
            ) : (
                <Text style={panelStyles.hint}>No night downloaded yet.</Text>
            )}
        </View>
    );
};

export default React.memo(NightReportPanel);
