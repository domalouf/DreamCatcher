import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Icon from '@react-native-vector-icons/fontawesome';
import { BlurView } from '@react-native-community/blur';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { COLORS } from './src/theme/theme';

import JournalScreen from './src/screens/JournalScreen';
import LearnScreen from './src/screens/LearnScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ConnectScreen from './src/screens/ConnectScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function BottomNavBarTabs() {
  const insets = useSafeAreaInsets();
  
  return (
    <Tab.Navigator
      initialRouteName="DC"
      screenOptions={{
        tabBarActiveTintColor: COLORS.primaryBlueHex,
        tabBarInactiveTintColor: COLORS.primaryGrayHex,
        headerShown: false,
        tabBarStyle: [styles.tabBarStyle, { marginBottom: insets.bottom }],
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
      <Stack.Screen name="Connect Screen"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
        component={ConnectScreen} />
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
        <Stack.Screen name="Settings"
        options={{
          headerShown: true,
          animation: 'slide_from_bottom',
        }}
        component={SettingsScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  React.useEffect(() => {
    // Enable immersive mode to hide the navigation bar
    SystemNavigationBar.immersive().catch(() => {
      // Fallback if immersive fails
    });

    // Set up a timer to hide the nav bar again after 3 seconds
    // This handles the case where the user swipes it up
    const interval = setInterval(() => {
      SystemNavigationBar.immersive().catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <BottomNavBarTabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBarStyle: {
    height: 60,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
