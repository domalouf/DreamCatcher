import React, { useState } from 'react';
import { View, StatusBar, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/fontawesome';
import { COLORS } from '../theme/theme';

const ProfileScreen = ({ navigation }: { navigation: any }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [profile, setProfile] = useState({
        name: 'Dream Explorer',
        email: 'user@dreamcatcher.app',
        bio: 'Passionate about understanding my dreams and achieving lucid dreaming',
        dreamGoal: 'Achieve lucid dreaming',
        joinDate: 'January 2025',
    });

    const [tempProfile, setTempProfile] = useState(profile);

    const handleEdit = () => {
        setTempProfile(profile);
        setIsEditing(true);
    };

    const handleSave = () => {
        setProfile(tempProfile);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setIsEditing(false);
    };

    const stats = [
        { label: 'Dreams Logged', value: '24' },
        { label: 'Streak (Days)', value: '7' },
        { label: 'Lucid Dreams', value: '3' },
    ];

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
                <ScrollView contentContainerStyle={styles.contentContainer}>
                    {/* Header with Edit Button */}
                    <View style={styles.headerContainer}>
                        <Text style={styles.title}>Profile</Text>
                        <View style={styles.headerButtons}>
                            <TouchableOpacity 
                                onPress={() => navigation.navigate('Settings')}
                                style={styles.settingsButton}
                            >
                                <Icon 
                                    name="cog" 
                                    size={20} 
                                    color={COLORS.whiteHex} 
                                />
                            </TouchableOpacity>
                            <TouchableOpacity 
                                onPress={isEditing ? handleSave : handleEdit}
                                style={styles.editButton}
                            >
                                <Icon 
                                    name={isEditing ? 'check' : 'pencil'} 
                                    size={20} 
                                    color={COLORS.whiteHex} 
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Profile Avatar Section */}
                    <View style={styles.avatarSection}>
                        <View style={styles.avatar}>
                            <Icon name="user-circle" size={80} color={COLORS.primaryOrangeHex} />
                        </View>
                    </View>

                    {/* Profile Info Section */}
                    <View style={styles.infoCard}>
                        <View style={styles.infoField}>
                            <Text style={styles.label}>Name</Text>
                            {isEditing ? (
                                <TextInput
                                    style={styles.input}
                                    value={tempProfile.name}
                                    onChangeText={(text) => setTempProfile({ ...tempProfile, name: text })}
                                    placeholderTextColor={COLORS.primaryGrayHex}
                                />
                            ) : (
                                <Text style={styles.value}>{profile.name}</Text>
                            )}
                        </View>

                        <View style={styles.infoField}>
                            <Text style={styles.label}>Email</Text>
                            {isEditing ? (
                                <TextInput
                                    style={styles.input}
                                    value={tempProfile.email}
                                    onChangeText={(text) => setTempProfile({ ...tempProfile, email: text })}
                                    placeholderTextColor={COLORS.primaryGrayHex}
                                />
                            ) : (
                                <Text style={styles.value}>{profile.email}</Text>
                            )}
                        </View>

                        <View style={styles.infoField}>
                            <Text style={styles.label}>Bio</Text>
                            {isEditing ? (
                                <TextInput
                                    style={[styles.input, styles.bioInput]}
                                    value={tempProfile.bio}
                                    onChangeText={(text) => setTempProfile({ ...tempProfile, bio: text })}
                                    placeholderTextColor={COLORS.primaryGrayHex}
                                    multiline
                                    numberOfLines={3}
                                />
                            ) : (
                                <Text style={styles.value}>{profile.bio}</Text>
                            )}
                        </View>

                        <View style={styles.infoField}>
                            <Text style={styles.label}>Dream Goal</Text>
                            {isEditing ? (
                                <TextInput
                                    style={styles.input}
                                    value={tempProfile.dreamGoal}
                                    onChangeText={(text) => setTempProfile({ ...tempProfile, dreamGoal: text })}
                                    placeholderTextColor={COLORS.primaryGrayHex}
                                />
                            ) : (
                                <Text style={styles.value}>{profile.dreamGoal}</Text>
                            )}
                        </View>

                        <View style={styles.infoField}>
                            <Text style={styles.label}>Member Since</Text>
                            <Text style={styles.value}>{profile.joinDate}</Text>
                        </View>
                    </View>

                    {/* Stats Section */}
                    <View style={styles.statsContainer}>
                        <Text style={styles.statsTitle}>Your Stats</Text>
                        <View style={styles.statsGrid}>
                            {stats.map((stat, index) => (
                                <View key={index} style={styles.statCard}>
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
        backgroundColor: COLORS.tirtiaryBlueHex,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 32,
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
    headerButtons: {
        flexDirection: 'row',
        gap: 10,
    },
    settingsButton: {
        padding: 10,
        backgroundColor: COLORS.primaryPurpleHex,
        borderRadius: 12,
        shadowColor: COLORS.primaryPurpleHex,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
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