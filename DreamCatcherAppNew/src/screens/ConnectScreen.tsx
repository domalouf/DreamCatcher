import React, { useState, useEffect } from 'react';
import { View, StatusBar, Text, StyleSheet, ImageBackground, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { differenceInMilliseconds } from 'date-fns';
// stuff for ble
import {
    Platform,
    ScrollView,
    NativeModules,
    TouchableOpacity,
    NativeEventEmitter,
    PermissionsAndroid,
    TouchableHighlight,
    Alert,
} from 'react-native';
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

const BleManagerModule = NativeModules.BleManager;

// RN expects native modules to expose addListener/removeListeners for NativeEventEmitter; stub to silence warnings until BLE work resumes.
if (BleManagerModule && !BleManagerModule.addListener) {
    BleManagerModule.addListener = () => {};
}
if (BleManagerModule && !BleManagerModule.removeListeners) {
    BleManagerModule.removeListeners = () => {};
}

const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
const SECONDS_TO_SCAN_FOR = 3;
// the only uuids we are interested in
const SERVICE_UUIDS: string[] = ['7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19'];
const SERVICE_UUID = '7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19';
const CHARACTERISTIC_UUID = '8b38e5b5-2b9a-4954-9281-fcab195b0912';
//const SERVICE_UUIDS: string[] = [];  // temporarily empty to scan all devices
const ALLOW_DUPLICATES = false;

const ConnectScreen = ({ navigation }: { navigation: any }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [connectedPeripherals, setConnectedPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );
    const [discoveredPeripherals, setDiscoveredPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );
    const [peripheralReadData, setPeripheralReadData] = useState('No Data Yet');
    const [isMaskSleep, setIsMaskSleep] = useState(false);
    
    const [startTimeWindow, setStartTimeWindow] = useState(new Date());
    const [endTimeWindow, setEndTimeWindow] = useState(new Date());
    const [startTimePopOpen, setStartTimePopOpen] = useState(false);
    const [endTimePopOpen, setEndTimePopOpen] = useState(false);

    // QTR data state
    const [qtrDataPoints, setQtrDataPoints] = useState<{x: number, y: number}[]>([]);
    const [isCollectingQTR, setIsCollectingQTR] = useState(false);
    
    // Debug/status messages
    const [statusMessages, setStatusMessages] = useState<string[]>([]);

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

    // just sets isScanning to false
    const handleStopScan = () => {
        setIsScanning(false);
        console.log('[handleStopScan] scan is stopped.');
    };

    const handleDisconnectedPeripheral = (
        event: BleDisconnectPeripheralEvent,
    ) => {
        console.log(
            `[handleDisconnectedPeripheral][${event.peripheral}] disconnected.`,
        );
        setConnectedPeripherals(map => {
            return new Map(
                Array.from(map).filter(([id, peripheral]) => id !== event.peripheral),
            );
        });
    };

    const handleConnectPeripheral = (event: any) => {
        console.log(`[handleConnectPeripheral][${event.peripheral}] connected.`);
    };

    const handleUpdateValueForCharacteristic = (data: BleManagerDidUpdateValueForCharacteristicEvent) => {
        console.log(
            `[handleUpdateValueForCharacteristic] received data from '${data.peripheral}' with characteristic='${data.characteristic}' and value='${data.value}'`,);
        
        if (data.value) {
            const dataString = String.fromCharCode(...data.value);
            console.log('[Received]', dataString);
            
            // Handle acknowledgments from ESP32
            if (dataString.startsWith('ACK:')) {
                addStatusMessage(dataString);
            }
            // Handle QTR data reception
            else if (isCollectingQTR) {
                if (dataString === 'QTR_DATA_END') {
                    setIsCollectingQTR(false);
                    addStatusMessage('QTR data collection complete');
                } else {
                    // Parse timestamp,value format
                    const parts = dataString.split(',');
                    if (parts.length === 2) {
                        const timestamp = parseInt(parts[0]);
                        const value = parseInt(parts[1]);
                        setQtrDataPoints(prev => [...prev, { x: timestamp / 1000, y: value }]); // Convert ms to seconds
                    }
                }
            }
        }
    };
    
    const addStatusMessage = (message: string) => {
        setStatusMessages(prev => {
            const updated = [message, ...prev].slice(0, 5); // Keep last 5 messages
            return updated;
        });
    };

    const handleDiscoverPeripheral = (peripheral: Peripheral) => {
        console.log('[handleDiscoverPeripheral] new BLE peripheral=', peripheral);
        if (!peripheral.name) {
            peripheral.name = 'Spooky Mystery Device';
        }
        setDiscoveredPeripherals(map => {
            return new Map(map.set(peripheral.id, peripheral));
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
            if (peripheral) {
                await BleManager.connect(peripheral.id);
                console.log(`[connectPeripheral][${peripheral.id}] connected.`);

                setConnectedPeripherals(map => {
                    let p = discoveredPeripherals.get(peripheral.id);
                    if (p) {
                        return new Map(map.set(p.id, p));
                    }
                    return map;
                });

                setIsMaskSleep(false);

                // before retrieving services, it is often a good idea to let bonding & connection finish properly
                await sleep(1500);

                // Check if still connected before proceeding
                const isConnected = await BleManager.isPeripheralConnected(peripheral.id, []);
                if (!isConnected) {
                    console.warn(`[connectPeripheral][${peripheral.id}] device disconnected before service retrieval`);
                    setConnectedPeripherals(map => {
                        const newMap = new Map(map);
                        newMap.delete(peripheral.id);
                        return newMap;
                    });
                    return;
                }

                /* Test read current RSSI value, retrieve services first */
                const peripheralData = await BleManager.retrieveServices(peripheral.id);
                console.log(
                    `[connectPeripheral][${peripheral.id}] retrieved peripheral services`,
                    peripheralData,
                );

                const rssi = await BleManager.readRSSI(peripheral.id);
                console.log(
                    `[connectPeripheral][${peripheral.id}] retrieved current RSSI value: ${rssi}.`,
                );

                if (peripheralData.characteristics) {
                    for (let characteristic of peripheralData.characteristics) {
                        if (characteristic.descriptors) {
                            for (let descriptor of characteristic.descriptors) {
                                try {
                                    // strange case with my esp32 where it would not accept this descriptor
                                    if (characteristic.characteristic === '2a05') {
                                        break;
                                    }
                                    let data = await BleManager.readDescriptor(
                                        peripheral.id,
                                        characteristic.service,
                                        characteristic.characteristic,
                                        descriptor.uuid,
                                    );
                                    console.log(
                                        `[connectPeripheral][${peripheral.id}] ${characteristic.service} ${characteristic.characteristic} ${descriptor.uuid} descriptor read as:`,
                                        data,
                                    );
                                } catch (error) {
                                    console.error(
                                        `[connectPeripheral][${peripheral.id}] failed to retrieve descriptor ${descriptor} for characteristic ${characteristic}:`,
                                        error,
                                    );
                                }
                            }
                        }
                    }
                }

                setConnectedPeripherals(map => {
                    let p = map.get(peripheral.id);
                    if (p) {
                        p.rssi = rssi;
                        return new Map(map.set(p.id, p));
                    }
                    return map;
                });

                // Set up notifications for the characteristic
                
                try {
                    await BleManager.startNotification(peripheral.id, SERVICE_UUID, CHARACTERISTIC_UUID);
                    console.log(`[connectPeripheral][${peripheral.id}] notifications enabled for characteristic`);
                } catch (error) {
                    console.error(`[connectPeripheral][${peripheral.id}] failed to enable notifications:`, error);
                }
            }
        } catch (error) {
            console.error(
                `[connectPeripheral][${peripheral.id}] connectPeripheral error`,
                error,
            );
            // Remove from connected peripherals on error
            setConnectedPeripherals(map => {
                const newMap = new Map(map);
                newMap.delete(peripheral.id);
                return newMap;
            });
        }
    };

    const readPeripheral = async () => {
        try {
            if (connectedPeripherals.size === 0) {
                console.warn('[readPeripheral] No connected peripherals found.');
                setPeripheralReadData('Not Connected to a peripheral');
                return;
            }

            console.log(
                '[readPeripheral] connectedPeripherals to scan for data',
                Array.from(connectedPeripherals.values()),
            );

            for (const peripheral of connectedPeripherals.values()) {
                // Now you are connected to the peripheral, and you have its services and characteristics.
                // You can read a characteristic like this:
                let service = 'dff3db14-65be-4e80-9852-0bbff6037651'; // replace with your service UUID
                let characteristic = '80eb899b-b325-4120-b604-df06ec01af12'; // replace with your characteristic UUID
                BleManager.read(peripheral.id, service, characteristic)
                    .then(data => {
                        // Success code
                        console.log('Read:', data);
                        setPeripheralReadData(data.toString());
                    })
                    .catch(error => {
                        // Failure code
                        console.log(error);
                    });
            }
        } catch (error) {
            console.error('[readPeripheral] unable to read peripheral data.', error);
        }
    };

    const writePeripheral = async (writeData: string) => {
        try {
            if (connectedPeripherals.size === 0) {
                console.warn('[writePeripheral] No connected peripherals found.');
                return;
            }

            console.log(
                '[writePeripheral] connectedPeripherals to write data to',
                Array.from(connectedPeripherals.values()),
            );

            let asciiArray = [];

            for (let i = 0; i < writeData.length; i++) {
                asciiArray.push(writeData.charCodeAt(i));
            }

            for (const peripheral of connectedPeripherals.values()) {
                // Now you are connected to the peripheral, and you have its services and characteristics.
                // You can read a characteristic like this:
                let service = '7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19'; // replace with your service UUID
                let characteristic = '8b38e5b5-2b9a-4954-9281-fcab195b0912'; // replace with your characteristic UUID
                BleManager.write(
                    peripheral.id,
                    service,
                    characteristic,
                    asciiArray,
                )
                    .then(() => {
                        console.log("Wrote " + writeData + " to characteristic " + characteristic);
                    })
                    .catch(error => {
                        console.error(
                            'Failed to write data to characteristic ' + characteristic,
                            error,
                        );
                    });
            }
        } catch (error) {
            console.error('[writePeripheral] unable to write peripheral data.', error);
        }
    };

    // sends esp32 a set of strings that represent the time window
    // startTime: [time in seconds]
    // scanTime: [time in seconds]
    // startTime is the number of seconds to sleep right now before checking for REM
    // scanTime is the number of seconds to check for REM
    const sendTimeInfo = () => {
        var startTime = (differenceInMilliseconds(startTimeWindow, new Date()) / 1000).toString();
        writePeripheral("startTime: " + parseInt(startTime));

        var scanTime = (differenceInMilliseconds(endTimeWindow, startTimeWindow) / 1000).toString();
        writePeripheral("scanTime: " + scanTime);

        setIsMaskSleep(true);
    };

    // How you can tap? Go sleep. Go sleep.
    function sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    // initializes the BleManager and sets up event listeners
    useEffect(() => {
        try {
            BleManager.start({ showAlert: false })
                .then(() => console.log('BleManager started.'))
                .catch((error: any) =>
                    console.error('BeManager could not be started.', error),
                );
        } catch (error) {
            console.error('unexpected error starting BleManager.', error);
            return;
        }

        const listeners: any[] = [
            BleManager.onDiscoverPeripheral(handleDiscoverPeripheral),
            BleManager.onStopScan(handleStopScan),
            BleManager.onConnectPeripheral(handleConnectPeripheral),
            BleManager.onDidUpdateValueForCharacteristic(
                handleUpdateValueForCharacteristic
            ),
            BleManager.onDisconnectPeripheral(handleDisconnectedPeripheral),
        ];

        handleAndroidPermissions();

        return () => {
            console.log('[app] main component unmounting. Removing listeners...');
            for (const listener of listeners) {
                listener.remove();
            }
        };
    }, []);

    const handleAndroidPermissions = () => {
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
                        '[handleAndroidPermissions] User accepts runtime permissions android 12+',
                    );
                } else if (scanNeverAsk || connectNeverAsk) {
                    console.error('[handleAndroidPermissions] Permissions set to never ask again');
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
                        '[handleAndroidPermissions] User refuses runtime permissions android 12+',
                    );
                    Alert.alert(
                        'Permissions Required',
                        'Bluetooth scan and connect permissions are required to find and connect to your Dream Catcher mask. Please grant these permissions to continue.',
                        [
                            {
                                text: 'OK',
                                onPress: handleAndroidPermissions,
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
                        '[handleAndroidPermissions] runtime permission Android <12 already OK',
                    );
                } else {
                    PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    ).then(requestResult => {
                        if (requestResult) {
                            console.log(
                                '[handleAndroidPermissions] User accepts runtime permission android <12',
                            );
                        } else {
                            console.error(
                                '[handleAndroidPermissions] User refuses runtime permission android <12',
                            );
                        }
                    });
                }
            });
        }
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

    const StartTimePopUp = () => {
        return startTimePopOpen ? (
            <DateTimePicker
                value={startTimeWindow}
                mode="time"
                display="spinner"
                onChange={(event, selectedDate) => {
                    if (event.type === 'set' && selectedDate) {
                        setStartTimeWindow(selectedDate);
                        setStartTimePopOpen(false);
                    } else {
                        setStartTimePopOpen(false);
                    }
                }}
            />
        ) : null;
    };

    const EndTimePopUp = () => {
        return endTimePopOpen ? (
            <DateTimePicker
                value={endTimeWindow}
                mode="time"
                display="spinner"
                onChange={(event, selectedDate) => {
                    if (event.type === 'set' && selectedDate) {
                        setEndTimeWindow(selectedDate);
                        setEndTimePopOpen(false);
                    } else {
                        setEndTimePopOpen(false);
                    }
                }}
            />
        ) : null;
    };

    // Render status messages
    const StatusMessages = () => {
        if (statusMessages.length === 0) {
            return null;
        }
        
        return (
            <View style={styles.statusContainer}>
                <Text style={styles.sectionTitle}>Connection Status</Text>
                {statusMessages.map((msg, index) => (
                    <Text key={index} style={styles.statusMessage}>{msg}</Text>
                ))}
            </View>
        );
    };

    // Render QTR graph if data is available
    const QTRGraphDisplay = () => {
        if (qtrDataPoints.length === 0) {
            return null;
        }

        // Prepare data for chart
        const chartData = {
            labels: qtrDataPoints.map(p => p.x.toFixed(1)),
            datasets: [
                {
                    data: qtrDataPoints.map(p => p.y),
                    color: () => COLORS.primaryPurpleHex,
                }
            ]
        };

        return (
            <View style={styles.graphContainer}>
                <Text style={styles.sectionTitle}>IR Sensor Data</Text>
                <LineChart
                    data={chartData}
                    width={350}
                    height={220}
                    chartConfig={{
                        backgroundColor: COLORS.tirtiaryBlueHex,
                        backgroundGradientFrom: COLORS.tirtiaryBlueHex,
                        backgroundGradientTo: COLORS.tirtiaryBlueHex,
                        color: () => COLORS.whiteHex,
                        strokeWidth: 2,
                        useShadowColorFromDataset: false,
                    }}
                    style={styles.chart}
                />
                <TouchableOpacity
                    onPress={() => setQtrDataPoints([])}
                    style={styles.clearButton}>
                    <Text style={styles.scanButtonText}>Clear Graph</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <>
            <StatusBar barStyle="default" />
            <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
                <StartTimePopUp />
                <EndTimePopUp />
                <ImageBackground source={require('../../src/images/starBackground.png')}
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
                        {Array.from(connectedPeripherals.values()).length === 0 ? (
                            <Text style={styles.statusText}>Not Connected</Text>
                        ) : (
                            <Text style={styles.statusText}>Connected</Text>
                        )}

                        {Array.from(
                            new Map([...discoveredPeripherals, ...connectedPeripherals]).values()
                        ).map((item) => (
                            <View key={item.id}>{renderItem({ item })}</View>
                        ))}

                        {Array.from(connectedPeripherals.values()).length > 0 && (
                            <>
                                {isMaskSleep ? (
                                    <Text style={styles.statusText}>Mask is Asleep</Text>
                                ) : (
                                    <Text style={styles.statusText}>Mask is Awake</Text>
                                )}

                                <View style={styles.controlsContainer}>
                                    <Text style={styles.sectionTitle}>LED Controls</Text>
                                    
                                    <StatusMessages />

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
                                            onPress={() => writePeripheral('qtr: calibrate')}
                                            style={[styles.controlButton, styles.buttonSmall]}>
                                            <Text style={styles.scanButtonText}>QTR Calibrate</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                setQtrDataPoints([]);
                                                setIsCollectingQTR(true);
                                                writePeripheral('qtr: collect');
                                            }}
                                            style={[styles.controlButton, styles.buttonSmall]}>
                                            <Text style={styles.scanButtonText}>QTR Collect</Text>
                                        </TouchableOpacity>
                                    </View>

                                    <QTRGraphDisplay />

                                    <Text style={styles.sectionTitle}>Time Window</Text>
                                    <View style={styles.timeContainer}>
                                        <TouchableOpacity
                                            onPress={() => setStartTimePopOpen(true)}
                                            style={styles.controlButton}>
                                            <Text style={styles.scanButtonText}>Set Start Time</Text>
                                        </TouchableOpacity>
                                        <Text style={styles.timeText}>
                                            {startTimeWindow.toLocaleTimeString()}
                                        </Text>
                                    </View>

                                    <View style={styles.timeContainer}>
                                        <TouchableOpacity
                                            onPress={() => setEndTimePopOpen(true)}
                                            style={styles.controlButton}>
                                            <Text style={styles.scanButtonText}>Set End Time</Text>
                                        </TouchableOpacity>
                                        <Text style={styles.timeText}>
                                            {endTimeWindow.toLocaleTimeString()}
                                        </Text>
                                    </View>

                                    <TouchableOpacity
                                        onPress={() => sendTimeInfo()}
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
    secretButton: {
        backgroundColor: COLORS.whiteHex,
        padding: 10,
        borderRadius: 10,
        margin: 20,
        position: 'absolute',
        bottom: 50,
        right: 10,
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
    navBarOffset: {
        marginTop: 80,
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