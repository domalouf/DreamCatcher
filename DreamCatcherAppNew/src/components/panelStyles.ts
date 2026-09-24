import { StyleSheet } from 'react-native';
import { COLORS } from '../theme/theme';

// Shared look for the mask panels on the connect screen
export const panelStyles = StyleSheet.create({
    sectionTitle: {
        fontSize: 20,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: 20,
        marginBottom: 10,
    },
    hint: {
        color: COLORS.whiteHex,
        opacity: 0.7,
        fontSize: 13,
        textAlign: 'center',
        marginHorizontal: 10,
        marginBottom: 6,
    },
    text: {
        color: COLORS.whiteHex,
        fontSize: 14,
        marginVertical: 3,
    },
    button: {
        backgroundColor: COLORS.primaryPurpleHex,
        padding: 15,
        borderRadius: 10,
        margin: 10,
        alignItems: 'center',
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    buttonText: {
        fontSize: 16,
        textAlign: 'center',
    },
    card: {
        marginVertical: 10,
        alignItems: 'center',
        borderRadius: 10,
        backgroundColor: 'rgba(110, 110, 160, 0.3)',
        padding: 10,
    },
    chart: {
        borderRadius: 16,
        marginVertical: 10,
    },
});

export const CHART_CONFIG = {
    backgroundColor: COLORS.tirtiaryBlueHex,
    backgroundGradientFrom: COLORS.tirtiaryBlueHex,
    backgroundGradientTo: COLORS.tirtiaryBlueHex,
    color: () => COLORS.whiteHex,
    strokeWidth: 2,
    useShadowColorFromDataset: false,
    propsForDots: { r: '4' },
};
