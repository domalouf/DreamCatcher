import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, StatusBar, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/theme';

const LearnScreen = () => {
    const [expandedTopic, setExpandedTopic] = useState<number | null>(null);

    const learningTopics = [
        {
            id: 1,
            title: 'How Dreams Work',
            content: 'Dreams occur primarily during REM (Rapid Eye Movement) sleep, which happens in cycles throughout the night. During REM sleep, your brain is highly active, creating vivid sensory experiences. Dreams may serve various functions including memory consolidation, emotional processing, and creative problem-solving. Most people have 4-6 dreams per night, though we only remember a fraction of them.'
        },
        {
            id: 2,
            title: 'How to Remember Dreams',
            content: 'Tips for better dream recall:\n\n• Keep a dream journal by your bed and write immediately upon waking\n• Set an intention before sleep to remember your dreams\n• Get adequate sleep (7-9 hours) to experience more REM cycles\n• Avoid alcohol before bed as it suppresses REM sleep\n• Wake up naturally when possible, as alarms can interrupt memory formation\n• Review your dreams regularly to strengthen recall'
        },
        {
            id: 3,
            title: 'Lucid Dreaming Basics',
            content: 'Lucid dreaming is when you become aware you\'re dreaming while still in the dream. Benefits include creativity, problem-solving, and entertainment. Techniques to induce lucid dreams:\n\n• Reality checks: Regularly test if you\'re awake throughout the day\n• Keep a dream journal to identify patterns\n• Set intention before sleep\n• Wake up after 5-6 hours, stay awake briefly, then return to sleep\n• Practice MILD (Mnemonic Induction of Lucid Dreams) technique'
        },
        {
            id: 4,
            title: 'Dream Symbols & Interpretation',
            content: 'Common dream symbols often have personal meanings that vary by individual:\n\n• Flying: Freedom, escape, or elevated perspective\n• Water: Emotions, the unconscious, or life flow\n• Falling: Loss of control or anxiety\n• Being chased: Avoiding something in waking life\n• Houses: Different aspects of yourself or life\n\nRemember: Your personal associations are more important than universal meanings.'
        },
        {
            id: 5,
            title: 'Sleep Cycles & REM Sleep',
            content: 'A typical 90-minute sleep cycle includes light sleep, deep sleep, and REM sleep. REM periods become longer and more frequent as the night progresses:\n\n• Cycle 1: ~25% REM\n• Cycle 2: ~35% REM\n• Cycle 3: ~45% REM\n• Cycle 4+: ~60% REM\n\nThis is why most vivid dreams occur in the later sleep cycles.'
        },
        {
            id: 6,
            title: 'Nightmare Management',
            content: 'If you experience frequent nightmares:\n\n• Identify stress or anxiety triggers in your waking life\n• Practice relaxation techniques before bed (meditation, deep breathing)\n• Limit caffeine and heavy meals before sleep\n• Maintain a consistent sleep schedule\n• Consider nightmare rehearsal therapy - rewrite your nightmare with a positive ending\n• Seek professional help if nightmares significantly impact your sleep quality'
        }
    ];

    const toggleTopic = (id: number) => {
        setExpandedTopic(expandedTopic === id ? null : id);
    };

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer}>
                <ScrollView contentContainerStyle={styles.contentContainer}>
                    <Text style={styles.title}>Learn About Dreams</Text>
                    <Text style={styles.subtitle}>Explore fascinating facts about dreaming, lucid dreams, and more</Text>
                    
                    {learningTopics.map((topic) => (
                        <TouchableOpacity 
                            key={topic.id}
                            style={styles.topicCard}
                            onPress={() => toggleTopic(topic.id)}
                        >
                            <View style={styles.topicHeader}>
                                <Text style={styles.topicTitle}>{topic.title}</Text>
                                <Text style={styles.expandIcon}>
                                    {expandedTopic === topic.id ? '−' : '+'}
                                </Text>
                            </View>
                            
                            {expandedTopic === topic.id && (
                                <Text style={styles.topicContent}>{topic.content}</Text>
                            )}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </SafeAreaView>
        </>
    );
};

export default LearnScreen;

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: COLORS.tirtiaryBlueHex,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 32,
    },
    title: {
        fontSize: 32,
        color: COLORS.whiteHex,
        fontWeight: '800',
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 15,
        color: COLORS.whiteHex,
        opacity: 0.6,
        marginBottom: 24,
        lineHeight: 22,
    },
    topicCard: {
        backgroundColor: 'rgba(255, 149, 0, 0.12)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 149, 0, 0.2)',
    },
    topicHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    topicTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: COLORS.whiteHex,
        flex: 1,
    },
    expandIcon: {
        fontSize: 22,
        color: COLORS.primaryOrangeHex,
        fontWeight: '700',
        marginLeft: 12,
    },
    topicContent: {
        fontSize: 15,
        color: COLORS.whiteHex,
        marginTop: 14,
        lineHeight: 22,
        opacity: 0.85,
    },
});