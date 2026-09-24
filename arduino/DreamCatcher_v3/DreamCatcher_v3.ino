/*
  DreamCatcher v3 - sleep mask firmware for the ESP32

  1. After a reset, the mask advertises over Bluetooth so the app can set up a
     night: cue brightness, detection sensitivity and the dream window
     (startTime/scanTime).
  2. It deep sleeps until the dream window starts.
  3. During the window it watches for REM sleep with the IR eye sensor and
     flashes the cue light when it finds it (see DreamLogic.h for how). Between
     readings it light sleeps, so it draws a few mA instead of ~40.
  4. When the window ends it saves the night's log to flash and advertises
     quietly (no blinking) so the app can download the report. If no phone
     connects within 2 hours it deep sleeps until reset.

  See README.md for the Bluetooth commands and how to tune detection.
*/

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <esp_sleep.h>
#include <esp_timer.h>
#include <stdarg.h>

#include "DreamLogic.h"

RTC_DATA_ATTR int bootCount = 0;

#define uS_TO_S_FACTOR 1000000ULL
const int LED_PIN = 2;              // Built-in LED
const int LED_PIN26 = 26;           // External LED (the dream cue)
const int QTR_POWER_PIN = 27;       // QTR sensor power pin
const int QTR_INPUT_PIN = 32;       // QTR sensor input pin (ADC1, so it works while Bluetooth is on)

const uint32_t SENSOR_SETTLE_US = 1000;              // wait after powering the sensor before reading
const int SENSOR_OVERSAMPLE = 16;                    // ADC reads averaged per reading
const uint32_t LIGHT_PWM_HZ = 5000;
const uint8_t LIGHT_PWM_BITS = 12;                   // fine steps for dim cues
const uint32_t LIGHT_MAX_DUTY = (1 << LIGHT_PWM_BITS) - 1;
const int64_t MIN_LIGHT_SLEEP_US = 2000;             // shorter waits aren't worth sleeping for
const uint32_t SAVE_EVERY_MS = 30UL * 60 * 1000;     // save the night log every 30 minutes
const uint32_t IDLE_TIMEOUT_MS = 2UL * 60 * 60 * 1000;  // no phone for 2 hours -> sleep until reset
const uint32_t TEST_MAX_MS = 5UL * 60 * 1000;        // the sensor test stops itself after 5 minutes
const uint32_t NOTIFY_GAP_MS = 15;                   // pause between notifications when sending the log

#define SERVICE_UUID        "7504e3b0-fd7a-4b56-b74d-c6e7eeed3f19"
#define CHARACTERISTIC_UUID "8b38e5b5-2b9a-4954-9281-fcab195b0912"

// Survives deep sleep (but not a reset), so the mask knows why it woke up
enum : uint8_t { STATE_IDLE = 0, STATE_WAITING_FOR_WINDOW = 1 };
RTC_DATA_ATTR uint8_t rtcState = STATE_IDLE;
RTC_DATA_ATTR uint32_t rtcWindowSec = 0;
RTC_DATA_ATTR uint32_t rtcWindowStartUnix = 0;

// Settings and the last night's log are kept in flash, so they survive a reset
Preferences prefs;
dc::Settings settings;
dc::NightSession night;   // large, so kept out of the stack
dc::NightLog savedLog;

// BLE
BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
volatile bool deviceConnected = false;
bool oldDeviceConnected = false;
bool afterNight = false;          // started Bluetooth because a night just finished
uint32_t lastActivityMs = 0;      // last boot or disconnect, for the idle timeout

// Requests from the phone that take a while, handled in loop() so the Bluetooth task isn't blocked
volatile bool trickRequested = false;
volatile bool cuePreviewRequested = false;
volatile bool logRequested = false;
volatile bool statusRequested = false;
volatile bool testStartRequested = false;
volatile bool testStopRequested = false;

bool LED_PIN_on = false;
int32_t firstSleepTime = 0;       // seconds until the dream window starts
int32_t dreamWindow = 0;          // dream window duration in seconds
uint32_t phoneUnixTime = 0;       // the phone's clock when it set up the night (0 if not sent)
uint32_t phoneUnixTimeAtMs = 0;   // millis() when phoneUnixTime arrived

// Sensor test: streams readings and detected movements to the app for positioning and tuning
bool testRunning = false;
uint32_t testStartMs = 0;
uint32_t nextTestSampleMs = 0;
uint32_t testBinsClosed = 0;
dc::MovementDetector testDetector;
dc::RemTracker testTracker;

// ---- Messages to the phone ---------------------------------------------------------

// Notifications must fit in 20 bytes, the most a phone accepts without negotiating more
void send(const char* message) {
  if (!deviceConnected) return;
  pCharacteristic->setValue((uint8_t*)message, strlen(message));
  pCharacteristic->notify();
}

void sendf(const char* format, ...) {
  char message[32];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof(message), format, args);
  va_end(args);
  send(message);
}

void ack(const char* message) {
  sendf("ACK: %s", message);
}

// ---- Lights ------------------------------------------------------------------

void setLights(uint32_t duty) {
  ledcWrite(LED_PIN, duty);
  ledcWrite(LED_PIN26, duty);
}

// Brightness doesn't look linear in duty cycle, so apply a gamma curve
uint32_t levelToDuty(uint8_t percent) {
  if (percent == 0) return 0;
  const uint32_t duty = (uint32_t)lroundf(powf(percent / 100.0f, 2.2f) * LIGHT_MAX_DUTY);
  return duty < 1 ? 1 : duty;
}

// The dream cue: three bursts of four quick flashes (~4.5 s)
void flashCue(uint8_t percent) {
  const uint32_t duty = levelToDuty(percent);
  for (int burst = 0; burst < 3; burst++) {
    for (int flash = 0; flash < 4; flash++) {
      setLights(duty);
      delay(80);
      setLights(0);
      delay(120);
    }
    delay(700);
  }
}

// LED trick
void doTrick() {
  for (int i = 0; i < 10; i++) {
    ledcWrite(LED_PIN, LIGHT_MAX_DUTY);
    delay(50);
    ledcWrite(LED_PIN, 0);
    delay(50);
  }
  if (LED_PIN_on) ledcWrite(LED_PIN, LIGHT_MAX_DUTY);
}

// Brief blink every 2 s while waiting for the phone after a reset
void heartbeat() {
  if (!LED_PIN_on) {
    setLights(millis() % 2000 < 60 ? levelToDuty(30) : 0);
  }
}

// ---- Eye sensor --------------------------------------------------------------

// The sensor's IR emitter is only powered while reading, which cuts its power use ~40x
uint16_t readEyeSensor() {
  digitalWrite(QTR_POWER_PIN, HIGH);
  delayMicroseconds(SENSOR_SETTLE_US);
  uint32_t sum = 0;
  for (int i = 0; i < SENSOR_OVERSAMPLE; i++) {
    sum += analogRead(QTR_INPUT_PIN);
  }
  digitalWrite(QTR_POWER_PIN, LOW);
  return (uint16_t)(sum / SENSOR_OVERSAMPLE);
}

// ---- Settings and night log in flash -------------------------------------------

void loadSettings() {
  settings.sensitivity = dc::clampU8(prefs.getUChar("sens", settings.sensitivity),
                                     dc::MIN_SENSITIVITY, dc::MAX_SENSITIVITY);
  settings.cueLevel = dc::clampU8(prefs.getUChar("cueLevel", settings.cueLevel),
                                  dc::MIN_CUE_LEVEL, dc::MAX_CUE_LEVEL);
}

void saveSettings() {
  prefs.putUChar("sens", settings.sensitivity);
  prefs.putUChar("cueLevel", settings.cueLevel);
}

void saveNightLog(const dc::NightLog& log) {
  prefs.putBytes("night", &log, log.usedBytes());
}

bool loadNightLog() {
  const size_t length = prefs.getBytesLength("night");
  if (length == 0 || length > sizeof(savedLog)) return false;
  prefs.getBytes("night", &savedLog, length);
  return savedLog.isValid(length);
}

// ---- Sleep -------------------------------------------------------------------

// Sleep function
void goToSleep(uint32_t length) {
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  esp_sleep_enable_timer_wakeup(length * uS_TO_S_FACTOR);

  Serial.println("Setup ESP32 to sleep for " + String(length) + " seconds");
  Serial.println("Going to sleep now");
  Serial.flush();
  esp_deep_sleep_start();
}

void sleepUntilReset() {
  setLights(0);
  digitalWrite(QTR_POWER_PIN, LOW);
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  Serial.println("No phone connected for a while - sleeping until reset");
  Serial.flush();
  esp_deep_sleep_start();
}

// Light sleep until the next reading is due. The CPU is paused but RAM and
// timers keep running, so the night loop just carries on afterwards.
void sleepUntil(int64_t wakeUs) {
  const int64_t waitUs = wakeUs - esp_timer_get_time();
  if (waitUs <= 0) return;
  if (waitUs < MIN_LIGHT_SLEEP_US) {
    delayMicroseconds((uint32_t)waitUs);
    return;
  }
  esp_sleep_enable_timer_wakeup((uint64_t)waitUs);
  esp_light_sleep_start();
}

// Print wakeup reason
void print_wakeup_reason() {
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_TIMER: Serial.println("Wakeup caused by timer"); break;
    default: Serial.printf("Wakeup was not caused by deep sleep: %d\n", wakeup_reason); break;
  }
}

// ---- The dream window ------------------------------------------------------------

void printEpoch(const dc::NightLog& log) {
  const dc::EpochRecord& e = log.epochs[log.epochCount - 1];
  Serial.printf("[%6.1f min] eye movements %3u%s%s%s%s\n",
                log.epochCount * log.epochSec / 60.0f, e.eyeMoves,
                e.flags & dc::EPOCH_REM ? "  REM" : "",
                e.flags & dc::EPOCH_CUE ? "  CUE" : "",
                e.flags & dc::EPOCH_BODY ? "  body movement" : "",
                e.flags & dc::EPOCH_BAD_SIGNAL ? "  bad signal" : "");
  Serial.flush();
}

// Watches for REM and cues until the window ends. Returns when the window is over.
void runNight() {
  Serial.printf("Dream window started: %lu s, sensitivity %u, cue brightness %u%%\n",
                (unsigned long)rtcWindowSec, settings.sensitivity, settings.cueLevel);
  Serial.flush();

  night.begin(settings, rtcWindowStartUnix, rtcWindowSec);
  const int64_t startUs = esp_timer_get_time();
  int64_t nextSampleUs = startUs;
  uint32_t elapsedMs = 0;
  uint32_t lastSaveMs = 0;
  uint16_t printedEpochs = 0;

  while (!night.finished(elapsedMs)) {
    const uint8_t cue = night.onSample(elapsedMs, readEyeSensor());
    if (cue > 0) {
      Serial.printf("REM detected - cueing at %u%%\n", cue);
      Serial.flush();
      flashCue(cue);
      night.onResume();
      nextSampleUs = esp_timer_get_time();
    }

    if (night.log().epochCount != printedEpochs) {
      printedEpochs = night.log().epochCount;
      printEpoch(night.log());
    }
    // Save as we go so a flat battery doesn't lose the whole night
    if (elapsedMs - lastSaveMs >= SAVE_EVERY_MS) {
      saveNightLog(night.log());
      lastSaveMs = elapsedMs;
    }

    nextSampleUs += dc::SAMPLE_MS * 1000;
    sleepUntil(nextSampleUs);
    elapsedMs = (uint32_t)((esp_timer_get_time() - startUs) / 1000);
  }

  night.finish(elapsedMs);
  saveNightLog(night.log());
  // Start tomorrow's cues at the brightness it settled on tonight
  settings.cueLevel = night.cueLevel();
  saveSettings();
  Serial.printf("Dream window over: %u cues, next cue brightness %u%%\n",
                night.log().cueCount, settings.cueLevel);
}

// Called once the phone has sent both startTime and scanTime
void startWaitingForWindow() {
  rtcWindowSec = (uint32_t)dreamWindow < dc::MAX_WINDOW_SEC ? (uint32_t)dreamWindow : dc::MAX_WINDOW_SEC;
  rtcWindowStartUnix = phoneUnixTime == 0
      ? 0
      : phoneUnixTime + (millis() - phoneUnixTimeAtMs) / 1000 + (uint32_t)firstSleepTime;
  rtcState = STATE_WAITING_FOR_WINDOW;
  saveSettings();

  send("ACK: sleeping until the window");
  delay(1000);  // give time for the message to go out
  setLights(0);
  goToSleep((uint32_t)firstSleepTime);
}

// ---- Bluetooth -----------------------------------------------------------------

void sendStatus() {
  sendf("S:%u,%u,%u", prefs.isKey("night") ? 1 : 0, settings.cueLevel, settings.sensitivity);
}

// Sends the last night's log. See README.md for the format.
void sendNightLog() {
  if (!loadNightLog()) {
    send("LOG_NONE");
    return;
  }
  const dc::NightLog& log = savedLog;
  sendf("LOG:%u,%u", log.epochCount, log.cueCount);
  delay(NOTIFY_GAP_MS);
  sendf("LS:%lu,%u", (unsigned long)log.startUnix, log.epochSec);
  delay(NOTIFY_GAP_MS);
  sendf("LV:%u,%u,%u", log.sensitivity, log.startLevel, log.endLevel);
  delay(NOTIFY_GAP_MS);

  // Four epochs per message, each as 2 hex digits of eye movements + 1 of flags
  for (uint16_t first = 0; first < log.epochCount && deviceConnected; first += 4) {
    char message[24];
    int length = snprintf(message, sizeof(message), "E%u:", first);
    for (uint16_t i = first; i < first + 4 && i < log.epochCount; i++) {
      length += snprintf(message + length, sizeof(message) - length, "%02X%X",
                         log.epochs[i].eyeMoves, log.epochs[i].flags & 0xF);
    }
    send(message);
    delay(NOTIFY_GAP_MS);
  }
  for (uint8_t i = 0; i < log.cueCount; i++) {
    sendf("C:%u,%u,%u", log.cues[i].epoch, log.cues[i].level, (unsigned)log.cues[i].outcome);
    delay(NOTIFY_GAP_MS);
  }
  send("LOG_END");
}

void startTest() {
  testDetector = dc::MovementDetector(settings.sensitivity);
  testTracker = dc::RemTracker(settings.sensitivity);
  testRunning = true;
  testStartMs = millis();
  nextTestSampleMs = testStartMs;
  testBinsClosed = 0;
  send("ACK: sensor test started");
}

void stopTest() {
  testRunning = false;
  send("TEST_END");
}

// Streams "<ms>,<reading>,<movement>" 25 times a second, plus "B:<eye movements
// in the last minute>,<REM-like>" every 10 s
void runTestStep() {
  const uint32_t now = millis();
  if (!deviceConnected || now - testStartMs >= TEST_MAX_MS) {
    stopTest();
    return;
  }
  if ((int32_t)(now - nextTestSampleMs) < 0) return;
  nextTestSampleMs += dc::SAMPLE_MS;

  const uint16_t raw = readEyeSensor();
  const dc::Movement movement = testDetector.addSample(raw);
  testTracker.addSample(testDetector.signalOk(), movement);

  const uint32_t t = now - testStartMs;
  sendf("%lu,%u,%u", (unsigned long)t, raw, (unsigned)movement);
  if (t >= (testBinsClosed + 1) * dc::BIN_MS) {
    testTracker.closeBin();
    testBinsClosed++;
    sendf("B:%u,%u", testTracker.eyeMovesLastMinute(), testTracker.remLike() ? 1 : 0);
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
    LED_PIN_on = true;
    setLights(LIGHT_MAX_DUTY);
    ack("light turned on");
  }
  else if (value == "light: off") {
    LED_PIN_on = false;
    setLights(0);
    ack("light turned off");
  }
  else if (value == "trick: yes") {
    trickRequested = true;
  }
  else if (value == "test: start" || value == "qtr: collect") {
    testStartRequested = true;
  }
  else if (value == "test: stop") {
    testStopRequested = true;
  }
  else if (value == "log: get") {
    logRequested = true;
  }
  else if (value == "status: get") {
    statusRequested = true;
  }
  else if (value == "cue: preview") {
    cuePreviewRequested = true;
  }
  else if (value.startsWith("cue:")) {
    settings.cueLevel = dc::clampU8(value.substring(4).toInt(), dc::MIN_CUE_LEVEL, dc::MAX_CUE_LEVEL);
    saveSettings();
    statusRequested = true;
  }
  else if (value.startsWith("sens:")) {
    settings.sensitivity = dc::clampU8(value.substring(5).toInt(), dc::MIN_SENSITIVITY, dc::MAX_SENSITIVITY);
    saveSettings();
    statusRequested = true;
  }
  else if (value.startsWith("now:")) {
    phoneUnixTime = (uint32_t)strtoul(value.substring(4).c_str(), nullptr, 10);
    phoneUnixTimeAtMs = millis();
  }
  else if (value.startsWith("startTime:")) {
    firstSleepTime = value.substring(10).toInt();
    Serial.printf("First sleep time set to: %ld\n", (long)firstSleepTime);
  }
  else if (value.startsWith("scanTime:")) {
    dreamWindow = value.substring(9).toInt();
    Serial.printf("Dream window duration set to: %ld\n", (long)dreamWindow);
  }
}

// BLE Characteristic callbacks
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    String value = pChar->getValue(); // Returns Arduino String

    if (value.length() > 0) {
      Serial.print("Received: ");
      Serial.println(value);
      checkInput(value);
    }
  }
};

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
  // Advertise every 250-500 ms rather than the default ~100 ms to save battery;
  // the app's 3 s scan still finds it
  pAdvertising->setMinInterval(0x190);
  pAdvertising->setMaxInterval(0x320);
  BLEDevice::startAdvertising();

  Serial.println(afterNight ? "Night over - waiting for the phone to collect the log..."
                            : "BLE started - waiting for connection...");
}

// ---- Setup and loop --------------------------------------------------------------

void setup() {
  setCpuFrequencyMhz(80);  // plenty for this job and far less power than 240 MHz
  Serial.begin(115200);
  pinMode(QTR_POWER_PIN, OUTPUT);
  digitalWrite(QTR_POWER_PIN, LOW);
  ledcAttach(LED_PIN, LIGHT_PWM_HZ, LIGHT_PWM_BITS);
  ledcAttach(LED_PIN26, LIGHT_PWM_HZ, LIGHT_PWM_BITS);
  setLights(0);

  ++bootCount;
  Serial.print("Boot count: ");
  Serial.println(bootCount);
  print_wakeup_reason();

  prefs.begin("dreamcatcher", false);
  loadSettings();

  // Woke up at the start of the dream window
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER && rtcState == STATE_WAITING_FOR_WINDOW) {
    rtcState = STATE_IDLE;
    runNight();
    afterNight = true;
  }

  // Otherwise: normal boot -> start BLE for configuration (or to hand over the night's log)
  startBLE();
  lastActivityMs = millis();
}

// if the mask is in the loop, it is waiting for instructions or for the phone to collect the log
void loop() {
  if (trickRequested) {
    trickRequested = false;
    doTrick();
    ack("trick performed");
  }
  if (cuePreviewRequested) {
    cuePreviewRequested = false;
    flashCue(settings.cueLevel);
    if (LED_PIN_on) setLights(LIGHT_MAX_DUTY);
    ack("cue previewed");
  }
  if (statusRequested) {
    statusRequested = false;
    sendStatus();
  }
  if (logRequested) {
    logRequested = false;
    sendNightLog();
  }
  if (testStopRequested) {
    testStopRequested = false;
    if (testRunning) stopTest();
  }
  if (testStartRequested) {
    testStartRequested = false;
    startTest();
  }
  if (testRunning) {
    runTestStep();
  }

  // If we have received both values -> sleep until the dream window
  if (dreamWindow > 0 && firstSleepTime > 0) {
    startWaitingForWindow();
  }

  // Handle BLE advertising restart on disconnect
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarted advertising");
    oldDeviceConnected = false;
    lastActivityMs = millis();
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = true;
  }

  if (!deviceConnected) {
    if (millis() - lastActivityMs >= IDLE_TIMEOUT_MS) {
      sleepUntilReset();
    }
    // Stay dark after a night in case you're still asleep
    if (!afterNight) {
      heartbeat();
    }
  }

  // Short pause during the sensor test so readings stay on time
  delay(testRunning ? 1 : 10);
}
