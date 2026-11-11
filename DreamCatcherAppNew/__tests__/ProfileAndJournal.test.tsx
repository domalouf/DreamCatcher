/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../src/screens/ProfileScreen';
import JournalScreen from '../src/screens/JournalScreen';

const Stack = createNativeStackNavigator();

async function renderScreen(component: React.ComponentType) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Screen" component={component} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
  });
  return renderer;
}

const textOf = (node: ReactTestInstance) => [node.props.children].flat().join('');
const hasText = (root: ReactTestInstance, label: string) =>
  root.findAll(n => n.type === Text && textOf(n) === label).length > 0;

function press(root: ReactTestInstance, match: (node: ReactTestInstance) => boolean) {
  let node: ReactTestInstance | null = root.findAll(match)[0];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node!.props.onPress();
}
const pressText = (root: ReactTestInstance, label: string) =>
  press(root, n => n.type === Text && textOf(n) === label);

const DAY_MS = 24 * 3600 * 1000;
const entry = (daysAgo: number, title: string) => ({
  id: String(Date.now() - daysAgo * DAY_MS),
  date: 'Jan 1, 2026',
  title,
  content: 'Flying over the sea',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test('the profile shows stats counted from the journal', async () => {
  await AsyncStorage.setItem(
    '@dream_entries_v1',
    JSON.stringify([entry(0, 'One'), entry(1, 'Two'), entry(5, 'Three')]),
  );
  const renderer = await renderScreen(ProfileScreen);

  const stat = (label: string) =>
    textOf(renderer.root.findAll(n => n.type === Text && textOf(n) === label)[0].parent!.findAllByType(Text)[0]);
  expect(stat('Dreams Logged')).toBe('3');
  expect(stat('Streak (Days)')).toBe('2');
});

test('profile edits are still there the next time the app opens', async () => {
  const renderer = await renderScreen(ProfileScreen);
  await act(async () => press(renderer.root, n => n.props.accessibilityLabel === 'Edit profile'));
  await act(async () => renderer.root.findAllByType(TextInput)[0].props.onChangeText('Dominic'));
  await act(async () => press(renderer.root, n => n.props.accessibilityLabel === 'Save profile'));
  expect(hasText(renderer.root, 'Dominic')).toBe(true);
  await act(async () => renderer.unmount());

  const reopened = await renderScreen(ProfileScreen);
  expect(hasText(reopened.root, 'Dominic')).toBe(true);
});

test('deleting a journal entry asks first', async () => {
  await AsyncStorage.setItem('@dream_entries_v1', JSON.stringify([entry(0, 'Keep me'), entry(1, 'Delete me')]));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const renderer = await renderScreen(JournalScreen);
  const saved = async () => JSON.parse((await AsyncStorage.getItem('@dream_entries_v1'))!).map((e: any) => e.title);

  await act(async () => pressText(renderer.root, 'Delete me'));
  await act(async () => pressText(renderer.root, 'Delete Entry'));

  // Nothing is deleted until the confirmation's Delete button is pressed
  expect(await saved()).toEqual(['Keep me', 'Delete me']);
  const buttons = alert.mock.calls[0][2]!;
  expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Delete']);

  await act(async () => buttons[1].onPress!());
  expect(await saved()).toEqual(['Keep me']);
  expect(hasText(renderer.root, 'Delete me')).toBe(false);
});
