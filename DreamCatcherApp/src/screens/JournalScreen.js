import React from 'react';
import { SafeAreaView, StatusBar, Text } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';

const JournalScreen = (props) => {
    return (
        <>
            <StatusBar barStyle="dark-content" />
            <SafeAreaView>
                <Text>Journal</Text>
                <Icon name="rocket" size={30} color="#900" />
            </SafeAreaView>
        </>
    );
};

export default JournalScreen;