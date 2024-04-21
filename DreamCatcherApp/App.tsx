import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/FontAwesome';
import { BlurView } from '@react-native-community/blur';
import { COLORS } from './src/theme/theme';

import JournalScreen from './src/screens/JournalScreen';
import DCScreen from './src/screens/DCScreen';
import LearnScreen from './src/screens/LearnScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function BottomNavBarTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={{
        tabBarActiveTintColor: COLORS.primaryPurpleHex,
        tabBarInactiveTintColor: COLORS.primaryGrayHex,
        headerShown: false,
        tabBarStyle: styles.tabBarStyle,
        tabBarBackground: () => (
          <BlurView overlayColor='transparent' blurAmount={1}
            style={styles.BlurViewStyle} />
        ),
      }}>
      <Tab.Screen
        name="DC"
        component={DCStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'DC',
          tabBarIcon: ({ color, size }) => (
            <Icon name="leaf" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Journal"
        component={JournalStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Icon name="book" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Learn"
        component={LearnStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Learn',
          tabBarIcon: ({ color, size }) => (
            <Icon name="graduation-cap" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Icon name="user" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function JournalStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Journal Home"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={JournalScreen} />
    </Stack.Navigator>
  );
}

function DCStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="DC Home"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={DCScreen} />
      <Stack.Screen name="Settings"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={SettingsScreen} />
    </Stack.Navigator>
  );
}

function LearnStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Tool Home"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={LearnScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Profile Home"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={ProfileScreen} />
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

const styles = StyleSheet.create({
  tabBarStyle: {
    height: 60,
    position: 'absolute',
    elevation: 0,
    borderTopColor: 'transparent',
  },
  BlurViewStyle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
});
