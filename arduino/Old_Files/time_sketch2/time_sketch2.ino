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

const char* ssid     = "HOMM";
const char* password = "min0taur";

const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -25200; // mountain time differs from gmt by 7 hours (-25200 seconds)
const int   daylightOffset_sec = 0; //3600 during daylight savings, 0 o.w.
const int ledPin = 2;

void setup(){
  Serial.begin(115200);

  // Connect to Wi-Fi
  Serial.print("Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi connected.");
  
  // Init and get the time
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  getLocalTime();

  //disconnect WiFi as it's no longer needed 
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Set LED as output
  pinMode(ledPin, OUTPUT);
}

void loop(){
  delay(5000);
  struct tm timeinfo = getLocalTime();

  Serial.println();
  Serial.println("Fuck this I hate it here");

  Serial.print("Hour (12 hour format): ");
  Serial.println(&timeinfo, "%I");
  Serial.print("Minute: ");
  Serial.println(&timeinfo, "%M");

  char timeHour[3];
  strftime(timeHour,3, "%H", &timeinfo);

  char timeMinute[4];
  strftime(timeMinute,4, "%M", &timeinfo);

  Serial.print("TimeHour: ");
  Serial.println(timeHour);

  if (strcmp(timeHour, "20") == 0) {
  Serial.println("this bitch is working");
  }

  Serial.println();
}

struct tm getLocalTime(){
  struct tm timeinfo;

  if(!getLocalTime(&timeinfo)){
    Serial.println("Failed to obtain time");
    return timeinfo;
  }return timeinfo;
}