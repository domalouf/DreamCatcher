/*
  Rui Santos
  Complete project details at https://RandomNerdTutorials.com/esp32-date-time-ntp-client-server-arduino/
  
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files.
  
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
*/

#include <WiFi.h>
#include "time.h"
#include <cstdlib> // for atoi
#include <cstring> // for strcmp

#define uS_TO_S_FACTOR 1000000ULL  /* Conversion factor for micro seconds to seconds */
#define TIME_TO_SLEEP  600        /* Time ESP32 will go to sleep (in seconds) */

RTC_DATA_ATTR int bootCount = 0;

const char* ssid     = "HOMM";
const char* password = "min0taur";

const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -25200; // mountain time differs from gmt by 7 hours (-25200 seconds)
const int   daylightOffset_sec = 3600; //3600 during daylight savings, 0 o.w.
const int ledPin1 = 2;
const int ledPin2 = 26;
const int BEEP_TIME = 500; /* Time LED on ESP32 will flash (in milliseconds) */


void setup() {
  // Set LED as output
  pinMode(ledPin1, OUTPUT);
  pinMode(ledPin2, OUTPUT);
  Serial.begin(115200);
  delay(1000); //Take some time to open up the Serial Monitor

  //Increment boot number and print it every reboot
  ++bootCount;
  Serial.println("the boot count is: ");
  Serial.println(bootCount);

  print_wakeup_reason();

  // wait 6 hours before waking up, then wake up at normal interval
  if (bootCount == 1) esp_sleep_enable_timer_wakeup(TIME_TO_SLEEP * 60 * 360 * uS_TO_S_FACTOR);
  else esp_sleep_enable_timer_wakeup(TIME_TO_SLEEP * uS_TO_S_FACTOR);

  Serial.println("Setup ESP32 to sleep for every " + String(TIME_TO_SLEEP) +
  " Seconds");

  int tempHour = findHour();
  int tempMinute = findMinute();
  Serial.println("the hour is: ");
  Serial.println(tempHour);
  if (tempHour == 4 && tempMinute > 10) blinkLED(5);

  Serial.println("Going to sleep now");
  Serial.flush(); 
  esp_deep_sleep_start();
}

void loop() {

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

/*
blinks the blue led on the ESP32 board
*/
void blinkLED(int count){
  for (int i = 0; i < count; i++){
    digitalWrite(ledPin1, HIGH);
    digitalWrite(ledPin2, HIGH);
    delay(BEEP_TIME);
    digitalWrite(ledPin1, LOW);
    digitalWrite(ledPin2, LOW);
    delay(BEEP_TIME);
  }
}

/*
connects to wifi using given ssid and password
*/
void connectWifi(){
  Serial.print("Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi connected.");
}

/*
disconnects wifi to save power
*/
void disconnectWifi(){
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

/*
returns the current hour (24 hour format)
*/
int findHour(){
  struct tm timeinfo = findLocalTime();
  char timeHour[3];
  strftime(timeHour,3, "%H", &timeinfo);
  return atoi(timeHour);
}

/*
returns the current minute (0-59)
*/
int findMinute(){
  struct tm timeinfo = findLocalTime();
  char timeMinute[4];
  strftime(timeMinute,4, "%M", &timeinfo);
  return atoi(timeMinute);
}

/*
gets a time struct with the local time
called by findHour and findMinute
*/
struct tm findLocalTime(){
  connectWifi();
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  struct tm timeinfo;

  if(!getLocalTime(&timeinfo)){
    Serial.println("Failed to obtain time");
  }
  disconnectWifi();
  return timeinfo;
}