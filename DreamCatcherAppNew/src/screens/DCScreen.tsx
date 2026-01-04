import React, { useState, useEffect } from 'react';
import { View, StatusBar, Text, StyleSheet, Image } from 'react-native';
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

// RN expects native modules to expose addListener/removeListeners for NativeEventEmitter; stub to silence warnings until BLE work resumes.
if (BleManagerModule && !BleManagerModule.addListener) {
  BleManagerModule.addListener = () => {};
}
if (BleManagerModule && !BleManagerModule.removeListeners) {
  BleManagerModule.removeListeners = () => {};
}

const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
const SECONDS_TO_SCAN_FOR = 8;
// the only uuids we are interested in
//const SERVICE_UUIDS: string[] = ['7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19'];
const SERVICE_UUIDS: string[] = [];  // temporarily empty to scan all devices
const ALLOW_DUPLICATES = true;

const DCScreen = ({ navigation }: { navigation: any }) => {
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

  // gets list of ble peripherals connected to the device, updates the peripherals map
  const retrieveConnected = async () => {
    try {
      const connectedPeripherals = await BleManager.getConnectedPeripherals();
      if (connectedPeripherals.length === 0) {
        console.warn('[retrieveConnected] No connected peripherals found.');
        return;
      }

      console.log(
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
        await sleep(900);

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

      console.log(
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

      console.log(
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
        .then(() => console.log('BleManager started.'))
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
        if (result) {
          console.log(
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
    //   return null;
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

  const ConnectPopUp = () => {
    return (
      <Modal
        visible={isConnectPopupVisible}
        animationType='fade'
        transparent={true}
        onRequestClose={() => setIsConnectPopupVisible(false)}
      >
        <View style={popupStyles.popupOverlay}>
          <View style={popupStyles.popup}>
            <View style={popupStyles.popupHeader}>
              <TouchableOpacity onPress={() => setIsConnectPopupVisible(false)}>
                <Text style={popupStyles.closeButton}>x</Text>
              </TouchableOpacity>

              <Text style={popupStyles.popupTitle}>Nearby Masks</Text>

              <TouchableOpacity onPress={() => { /* Handle edit */ }}>
                <Text style={popupStyles.editButton}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View>
              <TouchableOpacity onPress={startScan} style={styles.scanButton}>
                <Text style={styles.scanButtonText}>Scan for Peripherals</Text>
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
          </View>
        </View>
      </Modal>
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
  }

  return (
    <>
      <StatusBar barStyle="default" />
      <SafeAreaView style={styles.screenContainer}>
        <ConnectPopUp />
        <StartTimePopUp />
        <EndTimePopUp />


        <Text style={styles.title}>Dream Catcher</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.mainContainer}>
            <TouchableOpacity onPress={() => setIsConnectPopupVisible(true)}
              style={styles.scanButton}>
              {Array.from(connectedPeripherals.values()).length === 0 ?
                <Text style={styles.scanButtonText}>
                  Connect</Text> :
                <Text style={styles.scanButtonText}>
                  Connected</Text>}
            </TouchableOpacity>

            {isMaskSleep ?
              <Text style={styles.scanButtonText}>
                Mask is Asleep</Text> :
              <Text style={styles.scanButtonText}>
                Mask is not asleep for certain?</Text>}


            {/* <Image source={require('../../src/images/mask.png')}
              resizeMode='contain'
              style={styles.maskImage} /> */}

            <View style={styles.onOffContainer}>
              <TouchableOpacity onPress={() => writePeripheral('light: off')} style={styles.scanButton}>
                <Text style={styles.scanButtonText}>
                  Turn Off LED</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => writePeripheral('light: on')} style={styles.scanButton}>
                <Text style={styles.scanButtonText}>
                  Turn On LED</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => writePeripheral('trick: yes')} style={styles.scanButton}>
                <Text style={styles.scanButtonText}>
                  Do a Trick</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.setTimerContainer}>

              <View style={styles.timeTextContainer}>
                <TouchableOpacity onPress={() => setStartTimePopOpen(true)} style={styles.scanButton}>
                  <Text style={styles.scanButtonText}>
                    Set Start Time</Text>
                </TouchableOpacity>
                <View style={styles.timerText}>
                  <Text style={styles.timerText}>
                    {startTimeWindow.toLocaleTimeString()}
                  </Text>
                </View>
              </View>

              <View style={styles.timeTextContainer}>
                <TouchableOpacity onPress={() => setEndTimePopOpen(true)} style={styles.scanButton}>
                  <Text style={styles.scanButtonText}>
                    Set End Time</Text>
                </TouchableOpacity>
                <View style={styles.timerText}>
                  <Text style={styles.timerText}>
                    {endTimeWindow.toLocaleTimeString()}
                  </Text>
                </View>
              </View>

              <TouchableOpacity onPress={() => sendTimeInfo()}
                style={styles.scanButton}>
                <Text style={styles.scanButtonText}>
                  Submit</Text>
              </TouchableOpacity>
            </View>

            <View>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')}
                style={styles.scanButton}>
                <Text style={styles.scanButtonText}>
                  Settings Screen</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.navBarOffset} />
        </ScrollView>
      </SafeAreaView>
    </>
  );
};

export default DCScreen;

const boxShadow = {
  shadowColor: '#000',
  shadowOffset: {
    width: 2,
    height: 2,
  },
  shadowOpacity: 0.25,
  shadowRadius: 3.84,
  elevation: 5,
};

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
    margin: 10,
  },
  maskImage: {
    width: '90%',
    height: 200,
    margin: 20,
  },
  mainContainer: {
    flex: 1,
  },
  scanButton: {
    backgroundColor: COLORS.primaryPurpleHex,
    padding: 20,
    borderRadius: 10,
    margin: 10,
  },
  scanButtonText: {
    color: COLORS.whiteHex,
    fontSize: 16,
    textAlign: 'center',
  },
  onOffContainer: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    margin: 5,
  },
  setTimerContainer: {
    flexDirection: 'column',
    justifyContent: 'space-evenly',
    margin: 10,
  },
  timeTextContainer: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    margin: 10,
  },
  timerText: {
    fontSize: 20,
    color: COLORS.whiteHex,
    textAlign: 'center',
    margin: 10,
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
    ...boxShadow,
  },
});

const popupStyles = StyleSheet.create({
  popupOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  popup: {
    backgroundColor: COLORS.whiteHex,
    borderRadius: 20,
    padding: 20,
    width: '90%',
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  popupTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'black',
  },
  closeButton: {
    alignSelf: 'flex-start',
    fontSize: 24,
    color: 'red',
  },
  editButton: {
    fontSize: 18,
    color: '#0000ff', // Replace with your theme color
  },
  popupContent: {
    marginVertical: 20,
  },
});