/**
 * @format
 */

import { DreamEntry, dreamStreak } from '../src/storage/journal';

const TODAY = new Date(2026, 2, 10, 9, 0);

// An entry written `daysAgo` days before TODAY, at the given hour
const entry = (daysAgo: number, hour = 8): DreamEntry => ({
  id: String(new Date(2026, 2, 10 - daysAgo, hour).getTime()),
  date: '',
  title: 'A dream',
  content: 'Flying',
});

test('counts the days in a row with a journal entry', () => {
  expect(dreamStreak([], TODAY)).toBe(0);
  expect(dreamStreak([entry(0)], TODAY)).toBe(1);
  expect(dreamStreak([entry(0), entry(1), entry(2), entry(4)], TODAY)).toBe(3);
  // several entries on one day count once, whatever the time of day
  expect(dreamStreak([entry(0, 1), entry(0, 23), entry(1, 23)], TODAY)).toBe(2);
  // crosses the start of a month
  expect(dreamStreak([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(d => entry(d)), TODAY)).toBe(12);
});

test("keeps the streak going until the end of a day without an entry", () => {
  expect(dreamStreak([entry(1), entry(2)], TODAY)).toBe(2);
  expect(dreamStreak([entry(2), entry(3)], TODAY)).toBe(0);
});
