import React, { useState, useEffect } from 'react';
import { View, SafeAreaView, StatusBar, Text, StyleSheet, ImageBackground } from 'react-native';
import DatePicker from 'react-native-date-picker';
import { differenceInMilliseconds } from 'date-fns';
// stuff for ble
import {
    Platform,
    ScrollView,
    Dimensions,
    NativeModules,
    useColorScheme,
    TouchableOpacity,
    NativeEventEmitter,
    PermissionsAndroid,
    TouchableHighlight,
    Modal,
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
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
const SECONDS_TO_SCAN_FOR = 1;
// the only uuids we are interested in
const SERVICE_UUIDS: string[] = ['7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19'];
//const SERVICE_UUIDS: string[] = [];
const ALLOW_DUPLICATES = false;

const ConnectScreen = ({ navigation }: { navigation: any }) => {
    const [isConnectPopupVisible, setIsConnectPopupVisible] = useState(false);
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

    const startScan = () => {
        if (!isScanning) {
            // reset found peripherals before scan
            setDiscoveredPeripherals(new Map<Peripheral['id'], Peripheral>());

            try {
                console.debug('[startScan] starting scan...');
                setIsScanning(true);
                BleManager.scan(SERVICE_UUIDS, SECONDS_TO_SCAN_FOR, ALLOW_DUPLICATES, {
                    matchMode: BleScanMatchMode.Sticky,
                    scanMode: BleScanMode.LowLatency,
                    callbackType: BleScanCallbackType.AllMatches,
                })
                    .then(() => {
                        console.debug('[startScan] scan promise returned successfully.');
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

    // gets list of ble peripherals connected to the device, updates the peripherals map
    const retrieveConnected = async () => {
        try {
            const connectedPeripherals = await BleManager.getConnectedPeripherals();
            if (connectedPeripherals.length === 0) {
                console.warn('[retrieveConnected] No connected peripherals found.');
                return;
            }

            console.debug(
                '[retrieveConnected] connectedPeripherals',
                connectedPeripherals,
            );

            for (var i = 0; i < connectedPeripherals.length; i++) {
                var peripheral = connectedPeripherals[i];

                setConnectedPeripherals(map => {
                    let p = map.get(peripheral.id);
                    if (p) {
                        return new Map(map.set(p.id, p));
                    }
                    return map;
                });
            }
        } catch (error) {
            console.error(
                '[retrieveConnected] unable to retrieve connected peripherals.',
                error,
            );
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

                setIsMaskSleep(false);

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

    const readPeripheral = async () => {
        try {
            const connectedPeripherals = await BleManager.getConnectedPeripherals();
            if (connectedPeripherals.length === 0) {
                console.warn('[readPeripheral] No connected peripherals found.');
                setPeripheralReadData('Not Connected to a peripheral');
                return;
            }

            console.debug(
                '[readPeripheral] connectedPeripherals to scan for data',
                connectedPeripherals,
            );

            for (var i = 0; i < connectedPeripherals.length; i++) {
                var peripheral = connectedPeripherals[i];
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
            const connectedPeripherals = await BleManager.getConnectedPeripherals();
            if (connectedPeripherals.length === 0) {
                console.warn('[writePeripheral] No connected peripherals found.');
                return;
            }

            console.debug(
                '[writePeripheral] connectedPeripherals to write data to',
                connectedPeripherals,
            );

            let asciiArray = [];

            for (let i = 0; i < writeData.length; i++) {
                asciiArray.push(writeData.charCodeAt(i));
            }

            for (var i = 0; i < connectedPeripherals.length; i++) {
                var peripheral = connectedPeripherals[i];
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
                if (result) {
                    console.debug(
                        '[handleAndroidPermissions] User accepts runtime permissions android 12+',
                    );
                } else {
                    console.error(
                        '[handleAndroidPermissions] User refuses runtime permissions android 12+',
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
            <SafeAreaView style={styles.screenContainer}>
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