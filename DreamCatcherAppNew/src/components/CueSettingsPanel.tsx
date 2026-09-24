import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { COLORS } from '../theme/theme';
import { MaskStatus } from '../ble/maskProtocol';
import { panelStyles } from './panelStyles';

const SENSITIVITY_LABELS = ['', 'Very strict', 'Strict', 'Balanced', 'Eager', 'Very eager'];

interface Props {
    status: MaskStatus | null;
    onChangeCueLevel: (level: number) => void;
    onChangeSensitivity: (sensitivity: number) => void;
    onPreview: () => void;
}

const Stepper = ({ label, value, onMinus, onPlus }: {
    label: string, value: string, onMinus: () => void, onPlus: () => void,
}) => (
    <View style={styles.stepper}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <TouchableOpacity onPress={onMinus} style={styles.stepperButton}>
            <Text style={panelStyles.buttonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity onPress={onPlus} style={styles.stepperButton}>
            <Text style={panelStyles.buttonText}>+</Text>
        </TouchableOpacity>
    </View>
);

// Cue brightness and REM sensitivity, stored on the mask
const CueSettingsPanel = ({ status, onChangeCueLevel, onChangeSensitivity, onPreview }: Props) => {
    if (!status) {
        return null;
    }
    const { cueLevel, sensitivity } = status;
    return (
        <View>
            <Text style={panelStyles.sectionTitle}>Dream Cue</Text>
            <Stepper
                label="Cue brightness"
                value={`${cueLevel}%`}
                onMinus={() => onChangeCueLevel(Math.max(3, cueLevel - 5))}
                onPlus={() => onChangeCueLevel(Math.min(100, cueLevel + 5))}
            />
            <Text style={panelStyles.hint}>
                Adjusts itself each night: dimmer if a cue wakes you, brighter if you sleep through it.
            </Text>
            <Stepper
                label="REM sensitivity"
                value={SENSITIVITY_LABELS[sensitivity] ?? String(sensitivity)}
                onMinus={() => onChangeSensitivity(Math.max(1, sensitivity - 1))}
                onPlus={() => onChangeSensitivity(Math.min(5, sensitivity + 1))}
            />
            <TouchableOpacity onPress={onPreview} style={panelStyles.button}>
                <Text style={panelStyles.buttonText}>Preview Cue</Text>
            </TouchableOpacity>
        </View>
    );
};

export default React.memo(CueSettingsPanel);

const styles = StyleSheet.create({
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 10,
        marginVertical: 5,
    },
    stepperLabel: {
        flex: 1,
        color: COLORS.whiteHex,
        fontSize: 16,
    },
    stepperButton: {
        backgroundColor: COLORS.primaryPurpleHex,
        borderRadius: 10,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepperValue: {
        color: COLORS.whiteHex,
        fontSize: 16,
        width: 100,
        textAlign: 'center',
    },
});
