#include <Arduino.h>
#include "FS.h"
#include "SPIFFS.h"  // For file system storage (if configured)

void setup() {
  Serial.begin(115200);
  delay(1000);  // Short delay to ensure Serial is ready

  // RAM (Heap) Information
  Serial.println("=== RAM (Heap) Information ===");
  Serial.print("Total Heap Size: ");
  Serial.print(ESP.getHeapSize());
  Serial.println(" bytes");
  
  Serial.print("Free Heap: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  
  Serial.print("Minimum Ever Free Heap: ");
  Serial.print(ESP.getMinFreeHeap());
  Serial.println(" bytes");

  // Storage (Flash) Information
  Serial.println("=== Flash Storage Information ===");
  Serial.print("Total Flash Chip Size: ");
  Serial.print(ESP.getFlashChipSize());
  Serial.println(" bytes");
  
  Serial.print("Sketch Size (used by program): ");
  Serial.print(ESP.getSketchSize());
  Serial.println(" bytes");
  
  Serial.print("Free Sketch Space (for OTA updates): ");
  Serial.print(ESP.getFreeSketchSpace());
  Serial.println(" bytes");

  // File System Storage (SPIFFS, if partitioned and enabled)
  Serial.println("=== File System (SPIFFS) Information ===");
  if (SPIFFS.begin(true)) {  // true = format if mount fails
    Serial.print("Total SPIFFS Bytes: ");
    Serial.print(SPIFFS.totalBytes());
    Serial.println(" bytes");
    
    Serial.print("Used SPIFFS Bytes: ");
    Serial.print(SPIFFS.usedBytes());
    Serial.println(" bytes");
    
    Serial.print("Free SPIFFS Bytes: ");
    Serial.print(SPIFFS.totalBytes() - SPIFFS.usedBytes());
    Serial.println(" bytes");
  } else {
    Serial.println("SPIFFS mount failed. Ensure partitions are configured for SPIFFS.");
  }
}

void loop() {
  // No ongoing operations needed
}