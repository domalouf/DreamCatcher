import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    StatusBar,
    Text,
    StyleSheet,
    ImageBackground,
    Linking,
    Platform,
    ScrollView,
    TouchableOpacity,
    PermissionsAndroid,
    TouchableHighlight,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import BleManager, {
    BleDisconnectPeripheralEvent,
    BleManagerDidUpdateValueForCharacteristicEvent,
    BleScanCallbackType,
    BleScanMatchMode,
    BleScanMode,
    Peripheral,
} from 'react-native-ble-manager';
import { LineChart } from 'react-native-chart-kit';

import { COLORS } from '../theme/theme';

const SECONDS_TO_SCAN_FOR = 3;
// the only uuids we are interested in (must match the ESP32 firmware)
const SERVICE_UUID = '7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19';
const CHARACTERISTIC_UUID = '8b38e5b5-2b9a-4954-9281-fcab195b0912';
const SERVICE_UUIDS: string[] = [SERVICE_UUID];
//const SERVICE_UUIDS: string[] = [];  // temporarily empty to scan all devices
const ALLOW_DUPLICATES = false;

type QTRPoint = { x: number, y: number };

// How you can tap? Go sleep. Go sleep.
function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// The time pickers only choose a time of day and keep whatever date they were opened with,
// so resolve the picked time to the first time that clock time comes around after `after`
// (e.g. a 3 AM start picked at 11 PM means tomorrow at 3 AM, not a time that already passed).
function nextOccurrence(time: Date, after: Date) {
    const next = new Date(after);
    next.setHours(time.getHours(), time.getMinutes(), 0, 0);
    if (next <= after) {
        next.setDate(next.getDate() + 1);
    }
    return next;
}

function secondsBetween(from: Date, to: Date) {
    return Math.round((to.getTime() - from.getTime()) / 1000);
}

const requestAndroidPermissions = () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
        PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]).then(result => {
            const scanGranted = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
            const connectGranted = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
            const scanNeverAsk = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
            const connectNeverAsk = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

            if (scanGranted && connectGranted) {
                console.log(
                    '[requestAndroidPermissions] User accepts runtime permissions android 12+',
                );
            } else if (scanNeverAsk || connectNeverAsk) {
                console.error('[requestAndroidPermissions] Permissions set to never ask again');
                Alert.alert(
                    'Permissions Required',
                    'Bluetooth permissions are required to use this app. You previously selected "Don\'t ask again". Please enable Bluetooth permissions in your device settings.',
                    [
                        {
                            text: 'Cancel',
                            style: 'cancel',
                        },
                        {
                            text: 'Open Settings',
                            onPress: () => Linking.openSettings(),
                        },
                    ],
                );
            } else {
                console.error(
                    '[requestAndroidPermissions] User refuses runtime permissions android 12+',
                );
                Alert.alert(
                    'Permissions Required',
                    'Bluetooth scan and connect permissions are required to find and connect to your Dream Catcher mask. Please grant these permissions to continue.',
                    [
                        {
                            text: 'OK',
                            onPress: requestAndroidPermissions,
                        },
                    ],
                );
            }
        });
    } else if (Platform.OS === 'android' && Platform.Version >= 23) {
        PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ).then(checkResult => {
            if (checkResult) {
                console.log(
                    '[requestAndroidPermissions] runtime permission Android <12 already OK',
                );
            } else {
                PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                ).then(requestResult => {
                    if (requestResult) {
                        console.log(
                            '[requestAndroidPermissions] User accepts runtime permission android <12',
                        );
                    } else {
                        console.error(
                            '[requestAndroidPermissions] User refuses runtime permission android <12',
                        );
                    }
                });
            }
        });
    }
};

const CHART_CONFIG = {
    backgroundColor: COLORS.tirtiaryBlueHex,
    backgroundGradientFrom: COLORS.tirtiaryBlueHex,
    backgroundGradientTo: COLORS.tirtiaryBlueHex,
    color: () => COLORS.whiteHex,
    strokeWidth: 2,
    useShadowColorFromDataset: false,
};

// Lives outside ConnectScreen (and is memoized) so the chart is updated in place when new
// points arrive, instead of being torn down and rebuilt on every render of the screen.
const QTRGraph = React.memo(({ points, onClear }: { points: QTRPoint[], onClear: () => void }) => {
    // show only whole integer seconds
    const chartData = {
        labels: points.map((p) => (Math.abs(p.x - Math.round(p.x)) < 0.05 ? Math.round(p.x).toString() : '')),
        datasets: [
            {
                data: points.map(p => p.y),
                color: () => COLORS.primaryPurpleHex,
            },
        ],
    };

    return (
        <View style={styles.graphContainer}>
            <Text style={styles.sectionTitle}>IR Sensor Data</Text>
            <LineChart
                data={chartData}
                width={350}
                height={220}
                withInnerLines={false}
                chartConfig={CHART_CONFIG}
                style={styles.chart}
            />
            <TouchableOpacity
                onPress={onClear}
                style={styles.clearButton}>
                <Text style={styles.scanButtonText}>Clear Graph</Text>
            </TouchableOpacity>
        </View>
    );
});

const ConnectScreen = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [connectedPeripherals, setConnectedPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );
    const [discoveredPeripherals, setDiscoveredPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );
    const [isMaskSleep, setIsMaskSleep] = useState(false);

    const [startTimeWindow, setStartTimeWindow] = useState(new Date());
    const [endTimeWindow, setEndTimeWindow] = useState(new Date());
    const [openTimePicker, setOpenTimePicker] = useState<'start' | 'end' | null>(null);

    // QTR data state
    const [qtrDataPoints, setQtrDataPoints] = useState<QTRPoint[]>([]);
    // A ref rather than state: it is only read by the BLE notification handler, which is
    // registered once on mount and would otherwise only ever see the initial value.
    const isCollectingQTR = useRef(false);

    // Debug/status messages
    const [statusMessages, setStatusMessages] = useState<string[]>([]);

    const clearQtrData = useCallback(() => setQtrDataPoints([]), []);

    const startScan = () => {
        console.log('[startScan] called.');
        if (!isScanning) {
            // reset found peripherals before scan
            setDiscoveredPeripherals(new Map<Peripheral['id'], Peripheral>());

            try {
                console.log('[startScan] starting scan...');
                setIsScanning(true);
                BleManager.scan({
                serviceUUIDs: SERVICE_UUIDS,
                seconds: SECONDS_TO_SCAN_FOR,
                allowDuplicates: ALLOW_DUPLICATES,
                matchMode: BleScanMatchMode.Sticky,
                scanMode: BleScanMode.LowLatency,
                callbackType: BleScanCallbackType.AllMatches,
                })
                    .then(() => {
                        console.log('[startScan] scan promise returned successfully.');
                    })
                    .catch((err: any) => {
                        console.error('[startScan] ble scan returned in error', err);
                    });

                // Fallback timeout to ensure isScanning is reset
                setTimeout(() => {
                    setIsScanning(false);
                    console.log('[startScan] scan timeout - resetting isScanning.');
                }, (SECONDS_TO_SCAN_FOR + 1) * 1000);
            } catch (error) {
                console.error('[startScan] ble scan error thrown', error);
            }
        }
    };

    const removeConnectedPeripheral = (id: Peripheral['id']) => {
        setConnectedPeripherals(map => {
            const newMap = new Map(map);
            newMap.delete(id);
            return newMap;
        });
    };

    const togglePeripheralConnection = async (peripheral: Peripheral) => {
        if (peripheral && connectedPeripherals.has(peripheral.id)) {
            try {
                await BleManager.disconnect(peripheral.id);
            } catch (error) {
                console.error(
                    `[togglePeripheralConnection][${peripheral.id}] error when trying to disconnect device.`,
                    error,
                );
            }
        } else {
            await connectPeripheral(peripheral);
        }
    };

    // connects device to given peripheral, updates the peripherals map
    const connectPeripheral = async (peripheral: Peripheral) => {
        try {
            await BleManager.connect(peripheral.id);
            console.log(`[connectPeripheral][${peripheral.id}] connected.`);

            setConnectedPeripherals(map => new Map(map).set(peripheral.id, peripheral));
            setIsMaskSleep(false);

            // before retrieving services, it is often a good idea to let bonding & connection finish properly
            await sleep(1500);

            // Check if still connected before proceeding
            const isConnected = await BleManager.isPeripheralConnected(peripheral.id, []);
            if (!isConnected) {
                console.warn(`[connectPeripheral][${peripheral.id}] device disconnected before service retrieval`);
                removeConnectedPeripheral(peripheral.id);
                return;
            }

            // services must be retrieved before notifications can be enabled
            const peripheralData = await BleManager.retrieveServices(peripheral.id);
            console.log(
                `[connectPeripheral][${peripheral.id}] retrieved peripheral services`,
                peripheralData,
            );

            const rssi = await BleManager.readRSSI(peripheral.id);
            console.log(
                `[connectPeripheral][${peripheral.id}] retrieved current RSSI value: ${rssi}.`,
            );

            setConnectedPeripherals(map => {
                const p = map.get(peripheral.id);
                return p ? new Map(map).set(p.id, { ...p, rssi }) : map;
            });

            // Set up notifications for the characteristic
            try {
                await BleManager.startNotification(peripheral.id, SERVICE_UUID, CHARACTERISTIC_UUID);
                console.log(`[connectPeripheral][${peripheral.id}] notifications enabled for characteristic`);
            } catch (error) {
                console.error(`[connectPeripheral][${peripheral.id}] failed to enable notifications:`, error);
            }
        } catch (error) {
            console.error(
                `[connectPeripheral][${peripheral.id}] connectPeripheral error`,
                error,
            );
            // Remove from connected peripherals on error
            removeConnectedPeripheral(peripheral.id);
        }
    };

    const writePeripheral = async (writeData: string) => {
        if (connectedPeripherals.size === 0) {
            console.warn('[writePeripheral] No connected peripherals found.');
            return;
        }

        const asciiArray = Array.from(writeData, c => c.charCodeAt(0));

        for (const peripheral of connectedPeripherals.values()) {
            try {
                await BleManager.write(peripheral.id, SERVICE_UUID, CHARACTERISTIC_UUID, asciiArray);
                console.log(`[writePeripheral][${peripheral.id}] wrote '${writeData}'`);
            } catch (error) {
                console.error(`[writePeripheral][${peripheral.id}] failed to write '${writeData}'`, error);
            }
        }
    };

    // sends esp32 a set of strings that represent the time window
    // startTime: [time in seconds]
    // scanTime: [time in seconds]
    // startTime is the number of seconds to sleep right now before checking for REM
    // scanTime is the number of seconds to check for REM
    const sendTimeInfo = async () => {
        if (startTimeWindow.getHours() === endTimeWindow.getHours() &&
            startTimeWindow.getMinutes() === endTimeWindow.getMinutes()) {
            Alert.alert('Invalid Time Window', 'Please pick different start and end times.');
            return;
        }

        const now = new Date();
        const start = nextOccurrence(startTimeWindow, now);
        const end = nextOccurrence(endTimeWindow, start);

        await writePeripheral('startTime: ' + secondsBetween(now, start));
        await writePeripheral('scanTime: ' + secondsBetween(start, end));

        setIsMaskSleep(true);
    };

    // initializes the BleManager and sets up event listeners
    useEffect(() => {
        const addStatusMessage = (message: string) => {
            setStatusMessages(prev => [message, ...prev].slice(0, 5)); // Keep last 5 messages
        };

        const handleDiscoverPeripheral = (peripheral: Peripheral) => {
            console.log('[handleDiscoverPeripheral] new BLE peripheral=', peripheral);
            if (!peripheral.name) {
                peripheral.name = 'Spooky Mystery Device';
            }
            setDiscoveredPeripherals(map => new Map(map).set(peripheral.id, peripheral));
        };

        // just sets isScanning to false
        const handleStopScan = () => {
            setIsScanning(false);
            console.log('[handleStopScan] scan is stopped.');
        };

        const handleDisconnectedPeripheral = (event: BleDisconnectPeripheralEvent) => {
            console.log(
                `[handleDisconnectedPeripheral][${event.peripheral}] disconnected.`,
            );
            setConnectedPeripherals(map => {
                const newMap = new Map(map);
                newMap.delete(event.peripheral);
                return newMap;
            });
        };

        const handleUpdateValueForCharacteristic = (data: BleManagerDidUpdateValueForCharacteristicEvent) => {
            if (!data.value) {
                return;
            }
            const dataString = String.fromCharCode(...data.value);
            console.log(`[handleUpdateValueForCharacteristic][${data.peripheral}] received '${dataString}'`);

            // Handle acknowledgments from ESP32
            if (dataString.startsWith('ACK:')) {
                addStatusMessage(dataString);
            }
            // Handle QTR data reception
            else if (isCollectingQTR.current) {
                if (dataString === 'QTR_DATA_END') {
                    isCollectingQTR.current = false;
                    addStatusMessage('QTR data collection complete');
                } else {
                    // Parse timestamp,value format
                    const parts = dataString.split(',');
                    if (parts.length === 2) {
                        const timestamp = parseInt(parts[0], 10);
                        const value = parseInt(parts[1], 10);
                        setQtrDataPoints(prev => [...prev, { x: timestamp / 1000, y: value }]); // Convert ms to seconds
                    }
                }
            }
        };

        try {
            BleManager.start({ showAlert: false })
                .then(() => console.log('BleManager started.'))
                .catch((error: any) =>
                    console.error('BleManager could not be started.', error),
                );
        } catch (error) {
            console.error('unexpected error starting BleManager.', error);
            return;
        }

        const listeners = [
            BleManager.onDiscoverPeripheral(handleDiscoverPeripheral),
            BleManager.onStopScan(handleStopScan),
            BleManager.onDidUpdateValueForCharacteristic(handleUpdateValueForCharacteristic),
            BleManager.onDisconnectPeripheral(handleDisconnectedPeripheral),
        ];

        requestAndroidPermissions();

        return () => {
            console.log('[app] main component unmounting. Removing listeners...');
            for (const listener of listeners) {
                listener.remove();
            }
        };
    }, []);

    const onTimePicked = (event: DateTimePickerEvent, selectedDate?: Date) => {
        if (event.type === 'set' && selectedDate) {
            if (openTimePicker === 'start') {
                setStartTimeWindow(selectedDate);
            } else {
                setEndTimeWindow(selectedDate);
            }
        }
        setOpenTimePicker(null);
    };

    const renderItem = ({ item }: { item: Peripheral }) => {
        const backgroundColor = connectedPeripherals.has(item.id) ? '#069400' : '#6e6ea0'; // green if connected, light blue if not
        // if (item.name === null || !item.name?.includes('ESP32')) {
        //     //return null;
        // }

        return (
            <TouchableHighlight
                underlayColor="#D3D3D3" // light gray
                onPress={() => togglePeripheralConnection(item)}>
                <View style={[styles.row, { backgroundColor }]}>
                    <Text style={styles.peripheralName}>
                        {/* completeLocalName (item.name) & shortAdvertisingName (advertising.localName) may not always be the same */}
                        {item.name} - {item?.advertising?.localName}
                    </Text>
                    <Text style={styles.rssi}>RSSI: {item.rssi}</Text>
                    <Text style={styles.peripheralId}>{item.id}</Text>
                </View>
            </TouchableHighlight>
        );
    };

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
                {openTimePicker && (
                    <DateTimePicker
                        value={openTimePicker === 'start' ? startTimeWindow : endTimeWindow}
                        mode="time"
                        display="spinner"
                        onChange={onTimePicked}
                    />
                )}
                <ImageBackground source={require('../images/starBackground.jpg')}
                    style={styles.bgImage}>

                    <Text style={styles.title}>Dream Catcher</Text>

                    <View>
                        <TouchableOpacity onPress={startScan} style={styles.scanButton}>
                            {isScanning ?
                                <Text style={styles.scanButtonText}>Scanning ...</Text> :
                                <Text style={styles.scanButtonText}>Scan for Peripherals</Text>}
                        </TouchableOpacity>
                    </View>

                    <ScrollView 
                        style={styles.scrollContainer}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={true}>
                        {connectedPeripherals.size === 0 ? (
                            <Text style={styles.statusText}>Not Connected</Text>
                        ) : (
                            <Text style={styles.statusText}>Connected</Text>
                        )}

                        {Array.from(
                            new Map([...discoveredPeripherals, ...connectedPeripherals]).values()
                        ).map((item) => (
                            <View key={item.id}>{renderItem({ item })}</View>
                        ))}

                        {connectedPeripherals.size > 0 && (
                            <>
                                {isMaskSleep ? (
                                    <Text style={styles.statusText}>Mask is Asleep</Text>
                                ) : (
                                    <Text style={styles.statusText}>Mask is Awake</Text>
                                )}

                                <View style={styles.controlsContainer}>
                                    <Text style={styles.sectionTitle}>LED Controls</Text>

                                    {statusMessages.length > 0 && (
                                        <View style={styles.statusContainer}>
                                            <Text style={styles.sectionTitle}>Connection Status</Text>
                                            {statusMessages.map((msg, index) => (
                                                <Text key={index} style={styles.statusMessage}>{msg}</Text>
                                            ))}
                                        </View>
                                    )}

                                    <View style={styles.buttonRow}>
                                        <TouchableOpacity
                                            onPress={() => writePeripheral('light: off')}
                                            style={[styles.controlButton, styles.buttonSmall]}>
                                            <Text style={styles.scanButtonText}>Turn Off LED</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => writePeripheral('light: on')}
                                            style={[styles.controlButton, styles.buttonSmall]}>
                                            <Text style={styles.scanButtonText}>Turn On LED</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => writePeripheral('trick: yes')}
                                        style={styles.controlButton}>
                                        <Text style={styles.scanButtonText}>Do a Trick</Text>
                                    </TouchableOpacity>

                                    <Text style={styles.sectionTitle}>QTR Sensor Controls</Text>
                                    <View style={styles.buttonRow}>
                                        <TouchableOpacity
                                            onPress={() => {
                                                setQtrDataPoints([]);
                                                isCollectingQTR.current = true;
                                                writePeripheral('qtr: collect');
                                            }}
                                            style={[styles.controlButton, styles.buttonSmall]}>
                                            <Text style={styles.scanButtonText}>QTR Collect</Text>
                                        </TouchableOpacity>
                                    </View>

                                    {qtrDataPoints.length > 0 && (
                                        <QTRGraph points={qtrDataPoints} onClear={clearQtrData} />
                                    )}

                                    <Text style={styles.sectionTitle}>Time Window</Text>
                                    <View style={styles.timeContainer}>
                                        <TouchableOpacity
                                            onPress={() => setOpenTimePicker('start')}
                                            style={styles.controlButton}>
                                            <Text style={styles.scanButtonText}>Set Start Time</Text>
                                        </TouchableOpacity>
                                        <Text style={styles.timeText}>
                                            {startTimeWindow.toLocaleTimeString()}
                                        </Text>
                                    </View>

                                    <View style={styles.timeContainer}>
                                        <TouchableOpacity
                                            onPress={() => setOpenTimePicker('end')}
                                            style={styles.controlButton}>
                                            <Text style={styles.scanButtonText}>Set End Time</Text>
                                        </TouchableOpacity>
                                        <Text style={styles.timeText}>
                                            {endTimeWindow.toLocaleTimeString()}
                                        </Text>
                                    </View>

                                    <TouchableOpacity
                                        onPress={sendTimeInfo}
                                        style={styles.submitButton}>
                                        <Text style={styles.scanButtonText}>Submit Time Window</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}
                    </ScrollView>
                </ImageBackground>
            </SafeAreaView>
        </>
    );
};

export default ConnectScreen;

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: COLORS.tirtiaryBlueHex,
    },
    title: {
        fontSize: 30,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: 10,
        marginBottom: 10,
    },
    bgImage: {
        flex: 1,
        resizeMode: 'cover',
    },
    scrollContainer: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 120,
    },
    statusText: {
        fontSize: 18,
        color: COLORS.whiteHex,
        textAlign: 'center',
        marginVertical: 10,
    },
    sectionTitle: {
        fontSize: 20,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: 20,
        marginBottom: 10,
    },
    scanButton: {
        backgroundColor: COLORS.whiteHex,
        padding: 10,
        borderRadius: 10,
        margin: 20,
        alignItems: 'center',
    },
    scanButtonText: {
        fontSize: 16,
        textAlign: 'center',
    },
    controlsContainer: {
        marginTop: 20,
        paddingHorizontal: 10,
    },
    controlButton: {
        backgroundColor: COLORS.primaryPurpleHex,
        padding: 15,
        borderRadius: 10,
        margin: 10,
        alignItems: 'center',
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    buttonSmall: {
        flex: 1,
        marginHorizontal: 5,
    },
    timeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: 5,
    },
    timeText: {
        fontSize: 18,
        color: COLORS.whiteHex,
        marginRight: 20,
    },
    submitButton: {
        backgroundColor: '#069400',
        padding: 15,
        borderRadius: 10,
        margin: 10,
        alignItems: 'center',
    },
    graphContainer: {
        marginTop: 20,
        marginBottom: 20,
        alignItems: 'center',
        borderRadius: 10,
        backgroundColor: 'rgba(110, 110, 160, 0.3)',
        padding: 10,
    },
    chart: {
        borderRadius: 16,
        marginVertical: 10,
    },
    clearButton: {
        backgroundColor: COLORS.primaryPurpleHex,
        padding: 10,
        borderRadius: 10,
        marginTop: 10,
        alignItems: 'center',
    },
    statusContainer: {
        backgroundColor: 'rgba(110, 110, 160, 0.3)',
        borderRadius: 10,
        padding: 10,
        marginVertical: 10,
    },
    statusMessage: {
        color: COLORS.whiteHex,
        fontSize: 14,
        marginVertical: 4,
        paddingLeft: 10,
        borderLeftWidth: 2,
        borderLeftColor: COLORS.primaryPurpleHex,
    },
    peripheralName: {
        fontSize: 16,
        textAlign: 'center',
        padding: 10,
    },
    rssi: {
        fontSize: 12,
        textAlign: 'center',
        padding: 2,
    },
    peripheralId: {
        fontSize: 12,
        textAlign: 'center',
        padding: 2,
        paddingBottom: 20,
    },
    row: {
        marginLeft: 10,
        marginRight: 10,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: {
            width: 2,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
});