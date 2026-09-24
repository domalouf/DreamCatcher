import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

import { COLORS } from '../theme/theme';
import { SENSOR_MAX_VALID, SENSOR_MIN_VALID, TestSample, TestSummary } from '../ble/maskProtocol';
import { panelStyles, CHART_CONFIG } from './panelStyles';

const EYE_COLOR = COLORS.primaryOrangeHex;
const BODY_COLOR = '#FF3B30';

interface Props {
    testing: boolean;
    samples: TestSample[];
    summary: TestSummary | null;
    eyeCount: number;
    bodyCount: number;
    onStart: () => void;
    onStop: () => void;
}

// Live view of the eye sensor, for positioning it and checking what the mask detects
const SensorTestPanel = ({ testing, samples, summary, eyeCount, bodyCount, onStart, onStop }: Props) => {
    const latest = samples[samples.length - 1];
    const signalOk = !latest || (latest.value >= SENSOR_MIN_VALID && latest.value <= SENSOR_MAX_VALID);

    // Only draw dots where a movement was detected
    const hidden = samples.flatMap((s, i) => (s.movement === 0 ? [i] : []));

    return (
        <View>
            <Text style={panelStyles.sectionTitle}>Sensor Test</Text>
            <Text style={panelStyles.hint}>
                Wear the mask, close your eyes and look left and right. Eye movements are marked in
                orange, body movements in red.
            </Text>
            <TouchableOpacity onPress={testing ? onStop : onStart} style={panelStyles.button}>
                <Text style={panelStyles.buttonText}>{testing ? 'Stop Sensor Test' : 'Start Sensor Test'}</Text>
            </TouchableOpacity>

            {samples.length > 1 && (
                <View style={panelStyles.card} testID="sensor-test">
                    <LineChart
                        // No x-axis labels: chart-kit draws one per point, which is slow when redrawing 5 times a second
                        data={{ labels: [], datasets: [{ data: samples.map(s => s.value), color: () => COLORS.primaryBlueHex }] }}
                        width={330}
                        height={200}
                        withVerticalLabels={false}
                        withInnerLines={false}
                        withShadow={false}
                        hidePointsAtIndex={hidden}
                        getDotColor={(_, i) => (samples[i]?.movement === 2 ? BODY_COLOR : EYE_COLOR)}
                        chartConfig={CHART_CONFIG}
                        style={panelStyles.chart}
                    />
                    <Text style={[panelStyles.text, !signalOk && styles.warning]}>
                        Reading: {latest.value}
                        {signalOk ? '' : ' - bad signal, move the sensor closer to or further from your eyelid'}
                    </Text>
                    <Text style={panelStyles.text}>
                        Eye movements: {eyeCount} · Body movements: {bodyCount}
                    </Text>
                    {summary && (
                        <Text style={panelStyles.text}>
                            Last minute: {summary.eyeMovesLastMinute} eye movements
                            {summary.remLike ? ' - would count as REM' : ''}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
};

export default React.memo(SensorTestPanel);

const styles = StyleSheet.create({
    warning: {
        color: BODY_COLOR,
    },
});
