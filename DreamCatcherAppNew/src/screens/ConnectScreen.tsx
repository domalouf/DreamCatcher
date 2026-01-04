import React, { useState, useEffect } from 'react';
import { View, StatusBar, Text, StyleSheet, ImageBackground, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
const SECONDS_TO_SCAN_FOR = 1;
// the only uuids we are interested in
const SERVICE_UUIDS: string[] = ['7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19'];
//const SERVICE_UUIDS: string[] = [];
const ALLOW_DUPLICATES = false;

const ConnectScreen = ({ navigation }: { navigation: any }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [connectedPeripherals, setConnectedPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );
    const [discoveredPeripherals, setDiscoveredPeripherals] = useState(
        new Map<Peripheral['id'], Peripheral>(),
    );

    const startScan = () => {
        console.debug('[startScan] called.');
        if (!isScanning) {
            // reset found peripherals before scan
            setDiscoveredPeripherals(new Map<Peripheral['id'], Peripheral>());

            try {
                console.debug('[startScan] starting scan...');
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
            } catch (error) {
                console.error('[startScan] ble scan error thrown', error);
            }
        }
    };

    // just sets isScanning to false
    const handleStopScan = () => {
        setIsScanning(false);
        console.debug('[handleStopScan] scan is stopped.');
    };

    const handleDisconnectedPeripheral = (
        event: BleDisconnectPeripheralEvent,
    ) => {
        console.debug(
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
        console.debug(
            `[handleUpdateValueForCharacteristic] received data from '${data.peripheral}' with characteristic='${data.characteristic}' and value='${data.value}'`,);
    };

    const handleDiscoverPeripheral = (peripheral: Peripheral) => {
        console.debug('[handleDiscoverPeripheral] new BLE peripheral=', peripheral);
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
                console.debug(`[connectPeripheral][${peripheral.id}] connected.`);

                setConnectedPeripherals(map => {
                    let p = discoveredPeripherals.get(peripheral.id);
                    if (p) {
                        return new Map(map.set(p.id, p));
                    }
                    return map;
                });

                // before retrieving services, it is often a good idea to let bonding & connection finish properly
                await sleep(900);

                /* Test read current RSSI value, retrieve services first */
                const peripheralData = await BleManager.retrieveServices(peripheral.id);
                console.debug(
                    `[connectPeripheral][${peripheral.id}] retrieved peripheral services`,
                    peripheralData,
                );

                const rssi = await BleManager.readRSSI(peripheral.id);
                console.debug(
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
                                    console.debug(
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
            }
        } catch (error) {
            console.error(
                `[connectPeripheral][${peripheral.id}] connectPeripheral error`,
                error,
            );
        }
    };

    // How you can tap? Go sleep. Go sleep.
    function sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    // initializes the BleManager and sets up event listeners
    useEffect(() => {
        try {
            BleManager.start({ showAlert: false })
                .then(() => console.debug('BleManager started.'))
                .catch((error: any) =>
                    console.error('BeManager could not be started.', error),
                );
        } catch (error) {
            console.error('unexpected error starting BleManager.', error);
            return;
        }

        const listeners = [
            bleManagerEmitter.addListener(
                'BleManagerDiscoverPeripheral',
                handleDiscoverPeripheral,
            ),
            bleManagerEmitter.addListener(
                'BleManagerStopScan',
                handleStopScan
            ),
            bleManagerEmitter.addListener(
                'BleManagerDisconnectPeripheral',
                handleDisconnectedPeripheral,
            ),
            bleManagerEmitter.addListener(
                'BleManagerDidUpdateValueForCharacteristic',
                handleUpdateValueForCharacteristic,
            ),
            bleManagerEmitter.addListener(
                'BleManagerConnectPeripheral',
                handleConnectPeripheral,
            ),
        ];

        handleAndroidPermissions();

        return () => {
            console.debug('[app] main component unmounting. Removing listeners...');
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
                    console.debug(
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
                    console.debug(
                        '[handleAndroidPermissions] runtime permission Android <12 already OK',
                    );
                } else {
                    PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    ).then(requestResult => {
                        if (requestResult) {
                            console.debug(
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
        if (item.name === null || !item.name?.includes('ESP32')) {
            //return null;
        }

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
                <ImageBackground source={require('../../src/images/starBackground.png')}
                    style={styles.bgImage}>

                    <Text style={styles.title}>Connect to Dream Catcher Mask</Text>

                    <View>
                        <TouchableOpacity onPress={startScan} style={styles.scanButton}>
                            {isScanning ?
                                <Text style={styles.scanButtonText}>Scanning ...</Text> :
                                <Text style={styles.scanButtonText}>Scan for Peripherals</Text>}
                        </TouchableOpacity>
                    </View>

                    <ScrollView>
                        {Array.from(discoveredPeripherals.values()).map((item) => (
                            <View key={item.id}>{renderItem({ item })}</View>
                        ))}
                        {Array.from(connectedPeripherals.values()).map((item) => (
                            <View key={item.id}>{renderItem({ item })}</View>
                        ))}
                    </ScrollView>

                    <TouchableOpacity onPress={() => navigation.navigate('DC Home')}
                        style={styles.secretButton}>
                        <Text>Super Sneaky Button</Text>
                    </TouchableOpacity>

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
        fontSize: 20,
        color: COLORS.whiteHex,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    bgImage: {
        flex: 1,
        resizeMode: 'cover',
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
        //...boxShadow, // this does something... idk what
    },
});