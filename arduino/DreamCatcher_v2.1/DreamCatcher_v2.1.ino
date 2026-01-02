/*
  Program Functionality:
  1. Creates a ble server that receives a connection and only reads data
  2. The data received will be the time left until the dream window,
  3. The esp32 goes into deep sleep and wakes up at start of dream window,
  4. During dream window, the esp32 sleeps for a set time, then blinks leds,
  5. After dream window, the esp32 sleeps until next dream window (24 hours),
  6. When reset, esp32 has option to connect to a phone and receive ble data
*/

// ble stuff
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <string>

// timer & sleep stuff
#include "time.h"
#include <cstdlib> // for atoi
#include <cstring> // for strcmp

RTC_DATA_ATTR int bootCount = 0;

// timer & sleep stuff
#define uS_TO_S_FACTOR 1000000ULL  /* Conversion factor for micro seconds to seconds */
int TIME_TO_SLEEP = 600;        /* Time ESP32 will go to sleep (in seconds) */
const int buttonPin = 33; // 33 is a RTC IO pin on Esp32

// ble stuff
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool newData = false;

// See the following for generating UUIDs:
// https://www.uuidgenerator.net/

#define SERVICE_UUID        "7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19"
#define CHARACTERISTIC_UUID "8b38e5b5-2b9a-4954-9281-fcab195b0912"
const int LED_PIN = 2; // LED on esp32
const int LED_PIN26 = 26; // attached led
bool LED_PIN_on = false; // flag for led and trick
bool dreamTime = false; // flag for when dreaming is happening, sets sleep for shorter intervals
int firstSleepTime = 0; // seconds to sleep until dream window, received via ble
int dreamWindow = 0; // duration of led's going off, received via ble
int blinkInterval = 120; // seconds to wait before blinking again

// awesome led trick function
void doTrick() {
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(50);
    digitalWrite(LED_PIN, LOW);
    delay(50);
  }
  if (LED_PIN_on) digitalWrite(LED_PIN, HIGH);
}

// puts esp32 to sleep for length seconds
void goToSleep(int length) {
  esp_sleep_enable_timer_wakeup(length * uS_TO_S_FACTOR);

  Serial.println("Setup ESP32 to sleep for every " + string(length) +
  " Seconds");

  Serial.println("Going to sleep now");
  Serial.flush(); 
  esp_deep_sleep_start();
}

/*
Method to print the reason by which ESP32
has been awaken from sleep
*/
void print_wakeup_reason(){
  esp_sleep_wakeup_cause_t wakeup_reason;

  wakeup_reason = esp_sleep_get_wakeup_cause();

  switch(wakeup_reason)
  {
    case ESP_SLEEP_WAKEUP_EXT0 : Serial.println("Wakeup caused by external signal using RTC_IO"); break;
    case ESP_SLEEP_WAKEUP_EXT1 : Serial.println("Wakeup caused by external signal using RTC_CNTL"); break;
    case ESP_SLEEP_WAKEUP_TIMER : Serial.println("Wakeup caused by timer"); break;
    case ESP_SLEEP_WAKEUP_TOUCHPAD : Serial.println("Wakeup caused by touchpad"); break;
    case ESP_SLEEP_WAKEUP_ULP : Serial.println("Wakeup caused by ULP program"); break;
    default : Serial.printf("Wakeup was not caused by deep sleep: %d\n",wakeup_reason); break;
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

// checks what the ble data was
void checkInput(std::string value) {
  if (value == "light: on") {
          digitalWrite(LED_PIN, HIGH);
          digitalWrite(LED_PIN26, HIGH);
          LED_PIN_on = true;
        }
        else if (value == "light: off") {
          digitalWrite(LED_PIN, LOW);
          digitalWrite(LED_PIN26, LOW);
          LED_PIN_on = false;
        }
        else if (value == "trick: yes") doTrick();

        // called if string begins with startTime
        else if (value.compareTo(0, 10, "startTime:") == 0) {
          // This is of the format "startTime: 300"
          // the number is how long to sleep

          Serial.println("this is num2");
          std::string substr2 = value.substr(11);
          int num2 = stoi(substr2);
          Serial.println(num2);
          firstSleepTime = num2;
        }
        else if (value.compare(0, 9, "scanTime:") == 0) {
          // This is of the format "startTime: AAAA"
          Serial.println("it is scan time");
          std::string substr3 = value.substr(10);
          int num3 = stoi(substr3);
          Serial.println(num3);
          dreamWindow = num3;
        }
}

// when esp32 receives ble data
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string value = pCharacteristic->getValue();

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

        checkInput(value);
      }
    }
};


// when esp32 wants to send data to devices
void NotifyBLE() {
        std::string value = pCharacteristic->getValue();
        pCharacteristic->notify();
        Serial.println("sent value to connected device");
        Serial.println(value.c_str());
}

// starts ble device, server, callbacks, service, characteristics,
// descriptor, and advertising
void startBLE() {
  // Create the BLE Device
  BLEDevice::init("Dream Catcher");

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

  std::string coolValue = "light: off";
  // Convert string to const char*
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
  Serial.println("Waiting a client connection to notify...");
}

/*
blinks the blue led on the ESP32 board
count is number of blinks
delay is time between blinks (ms)
*/
void blinkLED(int count, int delayTime){
  for (int i = 0; i < count; i++){
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(LED_PIN26, HIGH);
    delay(delayTime);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(LED_PIN26, LOW);
    delay(delayTime);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_PIN26, OUTPUT);
  ++bootCount;
  Serial.println("the boot count is: ");
  Serial.println(bootCount);
  print_wakeup_reason();

  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER &&
  !dreamTime)
  {
    dreamTime = true;
    blinkLED(5, 300);
    goToSleep(blinkInterval);
  } else if (dreamTime) {
    blinkLED(5, 300);
    goToSleep(blinkInterval);
  }
  startBLE();
}

// loop is reached when app is connected
// checks for sleep command from ble and
// advertises ble signal if no connection
void loop() {
  // if the user receives a sleep window, go to sleep
  if (dreamWindow > 0 && firstSleepTime > 0) {
    delay(1000);
    goToSleep(firstSleepTime);
  }

  else if (!deviceConnected && !dreamTime) blinkLED(1, 500);

  // notify changed value
  if (deviceConnected) {
        //NotifyBLE();
        //delay(10000);
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