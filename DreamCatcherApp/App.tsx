import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/FontAwesome';

import JournalScreen from './src/screens/JournalScreen';


const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function BottomNavBarTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={{
        tabBarActiveTintColor: '#1ee94d',
        headerShown: false,
      }}>
      <Tab.Screen
        name="Journal"
        component={JournalStack}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({color, size}) => (
            <Icon name="rocket" size={30} color="#900" />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function JournalStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Journal Home" component={JournalScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <BottomNavBarTabs />
    </NavigationContainer>
  );
}