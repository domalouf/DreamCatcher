import React from 'react';
import { AppState, StyleSheet } from 'react-native';
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

const tabIcon = (name: React.ComponentProps<typeof Icon>['name']) =>
  ({ color, size }: { color: string; size: number }) => (
    <Icon name={name} size={size} color={color} />
  );

const renderTabBarBackground = () => (
  <BlurView overlayColor='transparent' blurAmount={1}
    style={styles.BlurViewStyle} />
);

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
        tabBarBackground: renderTabBarBackground,
      }}>
      <Tab.Screen
        name="DC"
        component={DCStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'DC',
          tabBarIcon: tabIcon('leaf'),
        }}
      />
      <Tab.Screen
        name="Journal"
        component={JournalStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Home',
          tabBarIcon: tabIcon('book'),
        }}
      />
      <Tab.Screen
        name="Learn"
        component={LearnStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Learn',
          tabBarIcon: tabIcon('graduation-cap'),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarShowLabel: false,
          tabBarLabel: 'Profile',
          tabBarIcon: tabIcon('user'),
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
    // Hide the navigation bar. Sticky immersive mode lets the user swipe the bars back in
    // temporarily and hides them again on its own, so there's no need to poll for it.
    const hideNavigationBar = () => {
      SystemNavigationBar.stickyImmersive().catch(() => {});
    };
    hideNavigationBar();

    // Re-apply when returning to the app in case the system reset it while in the background
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        hideNavigationBar();
      }
    });

    return () => subscription.remove();
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
