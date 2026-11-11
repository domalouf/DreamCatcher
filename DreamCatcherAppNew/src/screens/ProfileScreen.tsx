import React, { useCallback, useEffect, useState } from 'react';
import { View, StatusBar, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/fontawesome';
import { COLORS } from '../theme/theme';
import { useTabBarSpace } from '../theme/useTabBarSpace';
import { DreamEntry, dreamStreak, loadEntries } from '../storage/journal';

const PROFILE_KEY = '@profile_v1';

const DEFAULT_PROFILE = {
    name: 'Dream Explorer',
    bio: 'Passionate about understanding my dreams and achieving lucid dreaming',
    dreamGoal: 'Achieve lucid dreaming',
};
type Profile = typeof DEFAULT_PROFILE;

const FIELDS: { key: keyof Profile, label: string, multiline?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'bio', label: 'Bio', multiline: true },
    { key: 'dreamGoal', label: 'Dream Goal' },
];

const ProfileScreen = () => {
    const tabBarSpace = useTabBarSpace();
    const [isEditing, setIsEditing] = useState(false);
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [tempProfile, setTempProfile] = useState(profile);
    const [entries, setEntries] = useState<DreamEntry[]>([]);

    useEffect(() => {
        AsyncStorage.getItem(PROFILE_KEY)
            .then(stored => {
                if (stored) {
                    setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(stored) });
                }
            })
            .catch(error => console.warn('[Profile] failed to load the profile', error));
    }, []);

    // The stats come from the journal, which may have changed since this tab was last open
    useFocusEffect(
        useCallback(() => {
            let focused = true;
            loadEntries().then(loaded => {
                if (focused) {
                    setEntries(loaded);
                }
            });
            return () => {
                focused = false;
            };
        }, []),
    );

    const stats = [
        { label: 'Dreams Logged', value: entries.length },
        { label: 'Streak (Days)', value: dreamStreak(entries) },
    ];

    const handleEdit = () => {
        setTempProfile(profile);
        setIsEditing(true);
    };

    const handleSave = () => {
        setProfile(tempProfile);
        setIsEditing(false);
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(tempProfile)).catch(error =>
            console.warn('[Profile] failed to save the profile', error),
        );
    };

    const handleCancel = () => {
        setIsEditing(false);
    };

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
                <ScrollView contentContainerStyle={[styles.contentContainer, { paddingBottom: tabBarSpace }]}>
                    {/* Header with Edit Button */}
                    <View style={styles.headerContainer}>
                        <Text style={styles.title}>Profile</Text>
                        <TouchableOpacity
                            onPress={isEditing ? handleSave : handleEdit}
                            style={styles.editButton}
                            accessibilityLabel={isEditing ? 'Save profile' : 'Edit profile'}
                        >
                            <Icon
                                name={isEditing ? 'check' : 'pencil'}
                                size={20}
                                color={COLORS.whiteHex}
                            />
                        </TouchableOpacity>
                    </View>

                    {/* Profile Avatar Section */}
                    <View style={styles.avatarSection}>
                        <View style={styles.avatar}>
                            <Icon name="user-circle" size={80} color={COLORS.primaryOrangeHex} />
                        </View>
                    </View>

                    {/* Profile Info Section */}
                    <View style={styles.infoCard}>
                        {FIELDS.map(({ key, label, multiline }) => (
                            <View key={key} style={styles.infoField}>
                                <Text style={styles.label}>{label}</Text>
                                {isEditing ? (
                                    <TextInput
                                        style={[styles.input, multiline && styles.bioInput]}
                                        value={tempProfile[key]}
                                        onChangeText={text => setTempProfile({ ...tempProfile, [key]: text })}
                                        placeholderTextColor={COLORS.primaryGrayHex}
                                        multiline={multiline}
                                        numberOfLines={multiline ? 3 : undefined}
                                    />
                                ) : (
                                    <Text style={styles.value}>{profile[key]}</Text>
                                )}
                            </View>
                        ))}
                    </View>

                    {/* Stats Section */}
                    <View style={styles.statsContainer}>
                        <Text style={styles.statsTitle}>Your Stats</Text>
                        <View style={styles.statsGrid}>
                            {stats.map(stat => (
                                <View key={stat.label} style={styles.statCard}>
                                    <Text style={styles.statValue}>{stat.value}</Text>
                                    <Text style={styles.statLabel}>{stat.label}</Text>
                                </View>
                            ))}
                        </View>
                    </View>

                    {/* Cancel Button (only show when editing) */}
                    {isEditing && (
                        <TouchableOpacity
                            onPress={handleCancel}
                            style={styles.cancelButton}
                        >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                    )}
                </ScrollView>
            </SafeAreaView>
        </>
    );
};

export default ProfileScreen;

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: COLORS.tertiaryBlueHex,
    },
    contentContainer: {
        padding: 16,
    },
    headerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 28,
    },
    title: {
        fontSize: 32,
        color: COLORS.whiteHex,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    editButton: {
        padding: 10,
        backgroundColor: COLORS.primaryOrangeHex,
        borderRadius: 12,
        shadowColor: COLORS.primaryOrangeHex,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
    },
    avatarSection: {
        alignItems: 'center',
        marginBottom: 28,
    },
    avatar: {
        padding: 12,
    },
    infoCard: {
        backgroundColor: 'rgba(255, 149, 0, 0.12)',
        borderRadius: 16,
        padding: 18,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: 'rgba(255, 149, 0, 0.2)',
    },
    infoField: {
        marginBottom: 18,
    },
    label: {
        fontSize: 12,
        color: COLORS.primaryOrangeHex,
        fontWeight: '700',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    value: {
        fontSize: 16,
        color: COLORS.whiteHex,
        fontWeight: '500',
        lineHeight: 22,
    },
    input: {
        backgroundColor: 'rgba(255, 149, 0, 0.15)',
        color: COLORS.whiteHex,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 149, 0, 0.25)',
    },
    bioInput: {
        paddingVertical: 12,
        textAlignVertical: 'top',
    },
    statsContainer: {
        marginBottom: 24,
    },
    statsTitle: {
        fontSize: 18,
        color: COLORS.whiteHex,
        fontWeight: '700',
        marginBottom: 14,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    statCard: {
        flex: 1,
        backgroundColor: 'rgba(255, 149, 0, 0.15)',
        borderRadius: 16,
        padding: 18,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 149, 0, 0.25)',
    },
    statValue: {
        fontSize: 26,
        color: COLORS.primaryOrangeHex,
        fontWeight: '800',
        marginBottom: 6,
    },
    statLabel: {
        fontSize: 12,
        color: COLORS.whiteHex,
        textAlign: 'center',
        fontWeight: '500',
        lineHeight: 16,
    },
    cancelButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    cancelButtonText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        fontWeight: '700',
    },
});