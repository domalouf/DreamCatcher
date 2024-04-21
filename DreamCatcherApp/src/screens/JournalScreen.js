import React from 'react';
import { View, SafeAreaView, StatusBar, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme/theme';

const JournalScreen = (props) => {
    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer}>
                <Text style={styles.title}>Journal</Text>
            </SafeAreaView>
        </>
    );
};

export default JournalScreen;

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