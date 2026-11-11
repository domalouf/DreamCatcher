import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DreamEntry {
    id: string; // the time the entry was written, in ms
    date: string;
    title: string;
    content: string;
}

const STORAGE_KEY = '@dream_entries_v1';

// Newest first
export async function loadEntries(): Promise<DreamEntry[]> {
    try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.warn('[journal] failed to load entries', error);
        return [];
    }
}

export function saveEntries(entries: DreamEntry[]) {
    return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(error =>
        console.warn('[journal] failed to save entries', error),
    );
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Days in a row with at least one entry, counting back from today
// (or from yesterday, so the streak isn't lost before today's dream is written down)
export function dreamStreak(entries: DreamEntry[], today = new Date()): number {
    const days = new Set<string>();
    for (const entry of entries) {
        const written = new Date(Number(entry.id));
        if (!Number.isNaN(written.getTime())) {
            days.add(dayKey(written));
        }
    }

    const day = new Date(today);
    if (!days.has(dayKey(day))) {
        day.setDate(day.getDate() - 1);
    }
    let streak = 0;
    while (days.has(dayKey(day))) {
        streak++;
        day.setDate(day.getDate() - 1);
    }
    return streak;
}
