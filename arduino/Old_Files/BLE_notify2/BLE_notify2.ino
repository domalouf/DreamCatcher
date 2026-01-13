/*
    Video: https://www.youtube.com/watch?v=oCMOYS71NIU
    Other Video: https://www.youtube.com/watch?v=0Yvd_k0hbVs
    Based on Neil Kolban example for IDF: https://github.com/nkolban/esp32-snippets/blob/master/cpp_utils/tests/BLE%20Tests/SampleNotify.cpp
    Ported to Arduino ESP32 by Evandro Copercini
    updated by chegewara

   Create a BLE server that, once we receive a connection, will send periodic notifications.
   The service advertises itself as: 4fafc201-1fb5-459e-8fcc-c5c9c331914b
   And has a characteristic of: beb5483e-36e1-4688-b7f5-ea07361b26a8

   The design of creating the BLE server is:
   1. Create a BLE Server
   2. Create a BLE Service
   3. Create a BLE Characteristic on the Service
   4. Create a BLE Descriptor on the characteristic
   5. Start the service.
   6. Start advertising.

   A connect hander associated with the server starts a background task that performs notification
   every couple of seconds.
*/
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <string>

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;

bool deviceConnected = false;
bool oldDeviceConnected = false;
uint32_t value = 0;
int lightFrequency = 0;
bool newData = false;

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/

#define SERVICE_UUID        "7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19"
#define CHARACTERISTIC_UUID "8b38e5b5-2b9a-4954-9281-fcab195b0912"
int LED_PIN = 2;

// awesome led trick function
void doTrick() {
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(50);
    digitalWrite(LED_PIN, LOW);
    delay(50);
  }
  
}

// when a device connects/disconnects from esp32
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("connected to a device");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("disconnected from a device");
    }
};

// when esp32 receives ble data
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = pCharacteristic->getValue();

      if (value.length() > 0) {
        /*
        Serial.println("*********");
        Serial.print("New value: ");
        for (int i = 0; i < value.length(); i++)
          Serial.print(value[i]);
          */
        Serial.println("*********");
        Serial.print("New value: ");
        Serial.println(value.c_str());
        Serial.println("*********");

        if (value == "light: on") digitalWrite(LED_PIN, HIGH);
        else if (value == "light: off") digitalWrite(LED_PIN, LOW);
        else if (value == "trick: yes") doTrick();
        
      }
    }
};

// when esp32 wants to send data to devices
void NotifyBLE() {
        String value = pCharacteristic->getValue();
        pCharacteristic->notify();
        Serial.println("sent value to connected device");
        Serial.println(value.c_str());
}

// starts ble device, server, callbacks, service, characteristics,
// descriptor, and advertising
void startBLE() {
  // Create the BLE Device
  BLEDevice::init("ESP32_BLE_Helper");

  // Create the BLE Server
  pServer = BLEDevice::createServer();

  // Set Callbacks
  pServer->setCallbacks(new MyServerCallbacks());

  // Create the BLE Service
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create a BLE Characteristic
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_INDICATE
                    );

  // https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.descriptor.gatt.client_characteristic_configuration.xml
  // Create a BLE Descriptor
  BLE2902 *pBLE2902;
  pBLE2902 = new BLE2902();
  pBLE2902->setNotifications(true);
  pCharacteristic->addDescriptor(pBLE2902);
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  String coolValue = "light: off";
  // Convert std::string to const char*
  const char* coolValueChar = coolValue.c_str();
  pCharacteristic->setValue(coolValue);

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x0);  // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Waiting a client connection to notify...");
}

void setup() {
  Serial.begin(115200);

  startBLE();
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
    // notify changed value
    if (deviceConnected) {
        NotifyBLE();
        delay(2000); // bluetooth stack will go into congestion, if too many packets are sent, in 6 hours test i was able to go as low as 3ms
    }
    // disconnecting
    if (!deviceConnected && oldDeviceConnected) {
        delay(500); // give the bluetooth stack the chance to get things ready
        pServer->startAdvertising(); // restart advertising
        Serial.println("start advertising");
        oldDeviceConnected = deviceConnected;
    }
    // connecting
    if (deviceConnected && !oldDeviceConnected) {
        // do stuff here on connecting
        oldDeviceConnected = deviceConnected;
    }
}