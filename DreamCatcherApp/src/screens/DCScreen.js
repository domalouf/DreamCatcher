import React from 'react';
import { View, SafeAreaView, StatusBar, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/theme';

const DCScreen = (props) => {
    return (
        <>
            <StatusBar barStyle="dark-content" />
            <SafeAreaView style={styles.screenContainer}>
                <Text style={styles.title}>Dream Catcher</Text>
            </SafeAreaView>
        </>
    );
};

export default DCScreen;

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: COLORS.tirtiaryBlueHex,
    },
    title: {
        fontSize: 20,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
    },
});