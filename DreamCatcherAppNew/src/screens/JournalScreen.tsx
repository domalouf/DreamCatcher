import React, { useEffect, useState } from 'react';
import {
    View,
    StatusBar,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Modal,
    FlatList,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DreamEntry {
    id: string;
    date: string;
    title: string;
    content: string;
}

const JournalScreen = (props: any) => {
    const [entries, setEntries] = useState<DreamEntry[]>([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [dreamTitle, setDreamTitle] = useState('');
    const [dreamContent, setDreamContent] = useState('');
    const [selectedEntry, setSelectedEntry] = useState<DreamEntry | null>(null);
    const STORAGE_KEY = '@dream_entries_v1';

    useEffect(() => {
        const loadEntries = async () => {
            try {
                const stored = await AsyncStorage.getItem(STORAGE_KEY);
                if (stored) {
                    setEntries(JSON.parse(stored));
                }
            } catch (error) {
                console.warn('[Journal] Failed to load saved entries', error);
            }
        };
        loadEntries();
    }, []);

    const persistEntries = async (updater: (prev: DreamEntry[]) => DreamEntry[]) => {
        setEntries(prev => {
            const next = updater(prev);
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((error: any) =>
                console.warn('[Journal] Failed to persist entries', error),
            );
            return next;
        });
    };

    const getTodayDate = () => {
        const today = new Date();
        return today.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    const handleAddEntry = () => {
        if (dreamTitle.trim() === '' || dreamContent.trim() === '') {
            Alert.alert('Missing Information', 'Please fill in both title and dream description');
            return;
        }

        const newEntry: DreamEntry = {
            id: Date.now().toString(),
            date: getTodayDate(),
            title: dreamTitle,
            content: dreamContent,
        };

        persistEntries(prev => [newEntry, ...prev]);
        setDreamTitle('');
        setDreamContent('');
        setModalVisible(false);
    };

    const handleDeleteEntry = (id: string) => {
        persistEntries(prev => prev.filter(entry => entry.id !== id));
        setSelectedEntry(null);
    };

    const renderEntryPreview = ({ item }: { item: DreamEntry }) => (
        <TouchableOpacity
            style={styles.entryCard}
            onPress={() => setSelectedEntry(item)}
            activeOpacity={0.7}
        >
            <View style={styles.orangeAccent} />
            <View style={styles.cardContent}>
                <View style={styles.dateContainer}>
                    <Text style={styles.entryDate}>🌙 {item.date}</Text>
                </View>
                <Text style={styles.entryTitle}>{item.title}</Text>
                <Text style={styles.entryPreview} numberOfLines={2}>
                    {item.content}
                </Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
                <View style={styles.headerContainer}>
                    <Text style={styles.title}>✨ Dream Journal</Text>
                    <View style={styles.decorativeCircle} />
                    <View style={styles.decorativeCircle2} />
                </View>

                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => setModalVisible(true)}
                    activeOpacity={0.85}
                >
                    <View style={styles.addButtonInner}>
                        <Text style={styles.addButtonIcon}>✦</Text>
                        <Text style={styles.addButtonText}>New Entry</Text>
                    </View>
                </TouchableOpacity>

                {entries.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateIcon}>💭</Text>
                        <Text style={styles.emptyStateText}>
                            No dreams recorded yet.{' '}Start capturing your dreams!
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        renderItem={renderEntryPreview}
                        contentContainerStyle={styles.listContainer}
                    />
                )}

                {/* New Entry Modal */}
                <Modal
                    visible={modalVisible}
                    animationType="slide"
                    transparent={true}
                    onRequestClose={() => setModalVisible(false)}
                >
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalTopBar} />
                            <View style={styles.modalHeader}>
                                <View>
                                    <Text style={styles.modalTitle}>✨ New Dream Entry</Text>
                                    <View style={styles.orangeUnderline} />
                                </View>
                                <TouchableOpacity
                                    onPress={() => setModalVisible(false)}
                                    style={styles.closeButtonContainer}
                                >
                                    <Text style={styles.closeButton}>✕</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.label}>Dream Title</Text>
                            <TextInput
                                style={styles.titleInput}
                                placeholder="Give your dream a title..."
                                placeholderTextColor="#999"
                                value={dreamTitle}
                                onChangeText={setDreamTitle}
                                maxLength={50}
                            />

                            <Text style={styles.label}>Dream Description</Text>
                            <TextInput
                                style={styles.contentInput}
                                placeholder="Describe your dream in detail..."
                                placeholderTextColor="#999"
                                value={dreamContent}
                                onChangeText={setDreamContent}
                                multiline={true}
                                maxLength={500}
                            />

                            <Text style={styles.charCount}>
                                {dreamContent.length}/500
                            </Text>

                            <View style={styles.buttonContainer}>
                                <TouchableOpacity
                                    style={styles.cancelButton}
                                    onPress={() => setModalVisible(false)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.buttonText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleAddEntry}
                                    activeOpacity={0.85}
                                    style={styles.saveButtonContainer}
                                >
                                    <View style={styles.saveButton}>
                                        <Text style={styles.buttonText}>✓ Save</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Entry Detail Modal */}
                <Modal
                    visible={selectedEntry !== null}
                    animationType="fade"
                    transparent={true}
                    onRequestClose={() => setSelectedEntry(null)}
                >
                    {selectedEntry && (
                        <View style={styles.modalOverlay}>
                            <View style={styles.detailModalContent}>
                                <View style={styles.detailHeader}>
                                    <View>
                                        <Text style={styles.detailDate}>
                                            {selectedEntry.date}
                                        </Text>
                                        <Text style={styles.detailTitle}>
                                            {selectedEntry.title}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => setSelectedEntry(null)}
                                    >
                                        <Text style={styles.closeButton}>✕</Text>
                                    </TouchableOpacity>
                                </View>

                                <ScrollView style={styles.detailContent}>
                                    <Text style={styles.detailText}>
                                        {selectedEntry.content}
                                    </Text>
                                </ScrollView>

                                <TouchableOpacity
                                    style={styles.deleteButton}
                                    onPress={() => {
                                        handleDeleteEntry(selectedEntry.id);
                                    }}
                                >
                                    <Text style={styles.deleteButtonText}>
                                        Delete Entry
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </Modal>
            </SafeAreaView>
        </>
    );
};

export default JournalScreen;

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: COLORS.tirtiaryBlueHex,
    },
    headerContainer: {
        position: 'relative',
        marginTop: 16,
        marginLeft: 16,
        marginBottom: 20,
        overflow: 'hidden',
    },
    title: {
        fontSize: 32,
        color: COLORS.whiteHex,
        fontWeight: '800',
        letterSpacing: -0.5,
        zIndex: 2,
    },
    decorativeCircle: {
        position: 'absolute',
        top: -20,
        right: 20,
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: COLORS.primaryOrangeHex,
        opacity: 0.15,
    },
    decorativeCircle2: {
        position: 'absolute',
        top: 10,
        right: -10,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: COLORS.primaryOrangeHex,
        opacity: 0.06,
    },
    addButton: {
        marginHorizontal: 16,
        marginBottom: 20,
        borderRadius: 14,
        overflow: 'hidden',
        shadowColor: COLORS.primaryPurpleHex,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 8,
    },
    addButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 8,
        backgroundColor: COLORS.primaryPurpleHex,
        borderRadius: 14,
    },
    addButtonIcon: {
        color: COLORS.whiteHex,
        fontSize: 20,
        fontWeight: '600',
    },
    addButtonText: {
        color: COLORS.whiteHex,
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    emptyStateIcon: {
        fontSize: 64,
        marginBottom: 16,
        opacity: 0.5,
    },
    emptyStateText: {
        color: COLORS.whiteHex,
        fontSize: 17,
        textAlign: 'center',
        opacity: 0.6,
        lineHeight: 26,
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    entryCard: {
        backgroundColor: 'rgba(124, 212, 198, 0.12)',
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'rgba(124, 212, 198, 0.24)',
        overflow: 'hidden',
        shadowColor: COLORS.primaryPurpleHex,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    orangeAccent: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: COLORS.primaryPurpleHex,
    },
    cardContent: {
        padding: 16,
        paddingLeft: 20,
    },
    dateContainer: {
        marginBottom: 6,
    },
    entryDate: {
        color: COLORS.primaryOrangeHex,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    entryTitle: {
        color: COLORS.whiteHex,
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 10,
    },
    entryPreview: {
        color: COLORS.whiteHex,
        fontSize: 14,
        opacity: 0.75,
        lineHeight: 20,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: COLORS.tirtiaryBlueHex,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 8,
        paddingHorizontal: 16,
        paddingBottom: 32,
        maxHeight: '85%',
    },
    modalTopBar: {
        width: 40,
        height: 4,
        backgroundColor: COLORS.primaryOrangeHex,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
        opacity: 0.6,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: COLORS.whiteHex,
    },
    orangeUnderline: {
        width: 50,
        height: 3,
        backgroundColor: COLORS.primaryOrangeHex,
        borderRadius: 2,
        marginTop: 6,
    },
    closeButtonContainer: {
        padding: 4,
    },
    detailModalContent: {
        backgroundColor: COLORS.tirtiaryBlueHex,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 32,
        marginTop: 'auto',
        maxHeight: '90%',
    },
    detailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    detailDate: {
        color: COLORS.primaryOrangeHex,
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 6,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    detailTitle: {
        color: COLORS.whiteHex,
        fontSize: 24,
        fontWeight: '800',
    },
    detailContent: {
        marginVertical: 16,
        maxHeight: 300,
    },
    detailText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        lineHeight: 24,
    },
    closeButton: {
        fontSize: 24,
        color: COLORS.whiteHex,
        fontWeight: '300',
    },
    label: {
        color: COLORS.primaryPurpleHex,
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 10,
        marginTop: 14,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    titleInput: {
        backgroundColor: 'rgba(124, 212, 198, 0.08)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: COLORS.whiteHex,
        fontSize: 16,
        borderWidth: 1.5,
        borderColor: 'rgba(124, 212, 198, 0.25)',
    },
    contentInput: {
        backgroundColor: 'rgba(124, 212, 198, 0.08)',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: COLORS.whiteHex,
        fontSize: 15,
        borderWidth: 1.5,
        borderColor: 'rgba(124, 212, 198, 0.25)',
        minHeight: 120,
        textAlignVertical: 'top',
    },
    charCount: {
        color: COLORS.primaryOrangeHex,
        fontSize: 12,
        opacity: 0.7,
        marginTop: 6,
        textAlign: 'right',
        fontWeight: '600',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 24,
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: 'rgba(255, 255, 255, 0.14)',
    },
    saveButtonContainer: {
        flex: 1,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: COLORS.primaryPurpleHex,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 6,
    },
    saveButton: {
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: COLORS.primaryPurpleHex,
    },
    buttonText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        fontWeight: '700',
        textAlign: 'center',
    },
    deleteButton: {
        backgroundColor: 'rgba(255, 111, 97, 0.2)',
        paddingVertical: 14,
        borderRadius: 12,
        marginTop: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 111, 97, 0.32)',
    },
    deleteButtonText: {
        color: '#FF8A80',
        fontSize: 16,
        fontWeight: '700',
        textAlign: 'center',
    },
});