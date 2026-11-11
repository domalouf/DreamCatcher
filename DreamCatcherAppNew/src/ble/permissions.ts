import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

// Asks for the Bluetooth permissions the app needs to find and connect to the mask
export const requestAndroidPermissions = () => {
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
