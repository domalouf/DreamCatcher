/*
  Program Functionality:
  1. Creates a ble server that receives a connection and only reads data
  2. The data received will be the time left until the dream window,
  3. The esp32 goes into deep sleep and wakes up at start of dream window,
  4. During dream window, the esp32 sleeps for a set time, then blinks leds,
  5. After dream window, the esp32 sleeps until next dream window (24 hours),
  6. When reset, esp32 has option to connect to a phone and receive ble data
*/

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

RTC_DATA_ATTR int bootCount = 0;

#define uS_TO_S_FACTOR 1000000ULL
const int buttonPin = 33;           // Not used for wakeup, but kept for future
const int LED_PIN = 2;              // Built-in LED
const int LED_PIN26 = 26;           // External LED

// BLE
BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

#define SERVICE_UUID        "7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19"
#define CHARACTERISTIC_UUID "8b38e5b5-2b9a-4954-9281-fcab195b0912"

bool LED_PIN_on = false;
bool dreamTime = false;
int firstSleepTime = 0;     // seconds until dream window starts
int dreamWindow = 0;        // dream window duration in seconds
int blinkInterval = 120;    // seconds between blinks during dream window

// LED trick
void doTrick() {
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(50);
    digitalWrite(LED_PIN, LOW);
    delay(50);
  }
  if (LED_PIN_on) digitalWrite(LED_PIN, HIGH);
}

// Sleep function
void goToSleep(int length) {
  esp_sleep_enable_timer_wakeup(length * uS_TO_S_FACTOR);

  Serial.println("Setup ESP32 to sleep for every " + String(length) + " seconds");
  Serial.println("Going to sleep now");
  Serial.flush();
  esp_deep_sleep_start();
}

// Print wakeup reason
void print_wakeup_reason() {
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_TIMER:    Serial.println("Wakeup caused by timer"); break;
    case ESP_SLEEP_WAKEUP_EXT0:     Serial.println("Wakeup caused by external signal using RTC_IO"); break;
    case ESP_SLEEP_WAKEUP_EXT1:     Serial.println("Wakeup caused by external signal using RTC_CNTL"); break;
    case ESP_SLEEP_WAKEUP_TOUCHPAD: Serial.println("Wakeup caused by touchpad"); break;
    case ESP_SLEEP_WAKEUP_ULP:      Serial.println("Wakeup caused by ULP program"); break;
    default: Serial.printf("Wakeup was not caused by deep sleep: %d\n", wakeup_reason); break;
  }
}

// BLE Server callbacks
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected");
  }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("Device disconnected");
  }
};

// Parse incoming BLE data
void checkInput(String value) {
  value.trim(); // remove any trailing newline/carriage return

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
  else if (value == "trick: yes") {
    doTrick();
  }
  else if (value.startsWith("startTime:")) {
    String numStr = value.substring(10);
    firstSleepTime = numStr.toInt();
    Serial.print("First sleep time set to: ");
    Serial.println(firstSleepTime);
  }
  else if (value.startsWith("scanTime:")) {
    String numStr = value.substring(9);
    dreamWindow = numStr.toInt();
    Serial.print("Dream window duration set to: ");
    Serial.println(dreamWindow);
  }
}

// BLE Characteristic callbacks
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    String value = pChar->getValue(); // Returns Arduino String

    if (value.length() > 0) {
      Serial.println("*********");
      Serial.print("New value: ");
      Serial.println(value);
      Serial.println("*********");

      checkInput(value);
    }
  }
};

// Optional: notify connected device (currently commented out in loop)
void NotifyBLE() {
  String value = pCharacteristic->getValue();
  pCharacteristic->notify();
  Serial.println("Sent notification: " + value);
}

// Start BLE server and advertising
void startBLE() {
  BLEDevice::init("Dream Catcher");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_WRITE |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_INDICATE
                    );

  BLE2902 *pDescriptor = new BLE2902();
  pDescriptor->setNotifications(true);
  pCharacteristic->addDescriptor(pDescriptor);
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  pCharacteristic->setValue("light: off");

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE started - waiting for connection...");
}

// Blink both LEDs
void blinkLED(int count, int delayTime) {
  for (int i = 0; i < count; i++) {
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
  Serial.print("Boot count: ");
  Serial.println(bootCount);
  print_wakeup_reason();


  // If wakeup was from a timer and the mask isn't in dream mode -> enter dream mode
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER && !dreamTime) {
    dreamTime = true;
    blinkLED(5, 300);
    goToSleep(blinkInterval);
  }
  // If already in dream mode -> continue blinking cycle
  else if (dreamTime) {
    blinkLED(5, 300);
    goToSleep(blinkInterval);
  }

  // Otherwise: normal boot -> start BLE for configuration
  startBLE();
}

// if the mask is in the loop, then it is waiting for instructions on when to sleep
void loop() {

  // If we have received both values → start the long sleep to dream window
  if (dreamWindow > 0 && firstSleepTime > 0 && !dreamTime) {
    delay(1000); // give time to disconnect if needed
    goToSleep(firstSleepTime);
  }

  // Show we're waiting for config (slow blink when not connected and not dreaming)
  if (!deviceConnected && !dreamTime) {
    blinkLED(1, 500);
  }

  // Handle BLE advertising restart on disconnect
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarted advertising");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Optional: send notifications periodically
  // if (deviceConnected) { NotifyBLE(); delay(10000); }
}