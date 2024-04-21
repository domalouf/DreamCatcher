import React from 'react';
import { View, SafeAreaView, StatusBar, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/theme';

const LearnScreen = (props) => {
    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer}>
                <Text style={styles.title}>Learn</Text>
            </SafeAreaView>
        </>
    );
};

export default LearnScreen;

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