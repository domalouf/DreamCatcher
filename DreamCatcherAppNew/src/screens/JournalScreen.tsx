import React, { useState } from 'react';
import {
    View,
    SafeAreaView,
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
import { COLORS } from '../theme/theme';

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

        setEntries([newEntry, ...entries]);
        setDreamTitle('');
        setDreamContent('');
        setModalVisible(false);
    };

    const handleDeleteEntry = (id: string) => {
        setEntries(entries.filter(entry => entry.id !== id));
        setSelectedEntry(null);
    };

    const renderEntryPreview = ({ item }: { item: DreamEntry }) => (
        <TouchableOpacity
            style={styles.entryCard}
            onPress={() => setSelectedEntry(item)}
        >
            <Text style={styles.entryDate}>{item.date}</Text>
            <Text style={styles.entryTitle}>{item.title}</Text>
            <Text style={styles.entryPreview} numberOfLines={2}>
                {item.content}
            </Text>
        </TouchableOpacity>
    );

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer}>
                <Text style={styles.title}>Dream Journal</Text>

                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => setModalVisible(true)}
                >
                    <Text style={styles.addButtonText}>+ New Entry</Text>
                </TouchableOpacity>

                {entries.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateText}>
                            No dreams recorded yet.{'\n'}Start capturing your dreams!
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
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>New Dream Entry</Text>
                                <TouchableOpacity
                                    onPress={() => setModalVisible(false)}
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
                                >
                                    <Text style={styles.buttonText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.saveButton}
                                    onPress={handleAddEntry}
                                >
                                    <Text style={styles.buttonText}>Save</Text>
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
    title: {
        fontSize: 28,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
        marginTop: 16,
        marginLeft: 16,
        marginBottom: 12,
    },
    addButton: {
        backgroundColor: COLORS.primaryPurpleHex,
        marginHorizontal: 16,
        marginBottom: 16,
        paddingVertical: 12,
        borderRadius: 8,
    },
    addButtonText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    emptyStateText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        textAlign: 'center',
        opacity: 0.7,
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    entryCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: COLORS.primaryPurpleHex,
    },
    entryDate: {
        color: COLORS.whiteHex,
        fontSize: 12,
        opacity: 0.7,
        marginBottom: 4,
    },
    entryTitle: {
        color: COLORS.whiteHex,
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
    entryPreview: {
        color: COLORS.whiteHex,
        fontSize: 14,
        opacity: 0.8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: COLORS.tirtiaryBlueHex,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: 32,
        maxHeight: '85%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: COLORS.whiteHex,
    },
    detailModalContent: {
        backgroundColor: COLORS.tirtiaryBlueHex,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 32,
        marginTop: 'auto',
        maxHeight: '90%',
    },
    detailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    detailDate: {
        color: COLORS.whiteHex,
        fontSize: 12,
        opacity: 0.7,
        marginBottom: 4,
    },
    detailTitle: {
        color: COLORS.whiteHex,
        fontSize: 22,
        fontWeight: '600',
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
        color: COLORS.whiteHex,
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
        marginTop: 12,
    },
    titleInput: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: COLORS.whiteHex,
        fontSize: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    contentInput: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: COLORS.whiteHex,
        fontSize: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
        minHeight: 120,
        textAlignVertical: 'top',
    },
    charCount: {
        color: COLORS.whiteHex,
        fontSize: 12,
        opacity: 0.6,
        marginTop: 4,
        textAlign: 'right',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingVertical: 12,
        borderRadius: 8,
        marginRight: 8,
    },
    saveButton: {
        flex: 1,
        backgroundColor: COLORS.primaryPurpleHex,
        paddingVertical: 12,
        borderRadius: 8,
        marginLeft: 8,
    },
    buttonText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    deleteButton: {
        backgroundColor: '#E74C3C',
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 12,
    },
    deleteButtonText: {
        color: COLORS.whiteHex,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
});