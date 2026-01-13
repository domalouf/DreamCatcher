// this code simply connects to the qtr-1a ir sensor module
// it calibrates the board, collects data for 10 seconds into memory,
// then outputs all data at once to serial for plotting
// here is the inspiration
// https://github.com/pololu/qtr-sensors-arduino/blob/master/examples/QTRRCExample/QTRRCExample.ino

#include <QTRSensors.h>

QTRSensors qtr;

const uint8_t SensorCount = 1;
uint16_t sensorValues[SensorCount];

// Define arrays to store data (max 150 points, assuming ~100 for 10s at 100ms intervals)
const int MAX_SAMPLES = 150;
unsigned long timestamps[MAX_SAMPLES];
uint16_t values[MAX_SAMPLES];
int sampleCount = 0;

void setup()
{
  pinMode(2, OUTPUT); //blinking light on ESP
  pinMode(27, OUTPUT); //optional power pin to turn qtr on/off
  // configure the sensors
  qtr.setTypeAnalog();
  qtr.setSensorPins((const uint8_t[]){32}, SensorCount); // Input pin on ESP
  //qtr.setEmitterPin(2);

  delay(500);
  digitalWrite(2, HIGH); // turn on Arduino's LED to indicate we are in calibration mode
  digitalWrite(27, HIGH);

  Serial.begin(115200); // Moved up for earlier serial output
  Serial.println("starting calibration");
  
  // Brief calibration: Reduced from 400 to 100 iterations for brevity
  for (uint16_t i = 0; i < 100; i++)
  {
    qtr.calibrate();
  }
  digitalWrite(2, LOW); // turn off Arduino's LED to indicate we are through with calibration

  // print the calibration minimum values measured when emitters were on
  for (uint8_t i = 0; i < SensorCount; i++)
  {
    Serial.print("minimum value was: ");
    Serial.println(qtr.calibrationOn.minimum[i]);
  }

  // print the calibration maximum values measured when emitters were on
  for (uint8_t i = 0; i < SensorCount; i++)
  {
    Serial.print("maximum value was: ");
    Serial.println(qtr.calibrationOn.maximum[i]);
  }
  
  Serial.println("Calibration complete. Starting 10-second data collection...");
  delay(1000); // Short pause before data collection

  // Collect data for 10 seconds into arrays
  unsigned long startTime = millis();
  while (millis() - startTime < 10000 && sampleCount < MAX_SAMPLES) // 10 seconds = 10000 ms, with safety limit
  {
    qtr.read(sensorValues);
    
    // Store timestamp (ms since start) and sensor value
    timestamps[sampleCount] = millis() - startTime;
    values[sampleCount] = sensorValues[0]; // Assuming single sensor
    sampleCount++;
    
    delay(100); // Sample every 100ms, adjust if needed for higher resolution
  }
  
  Serial.println("Data collection complete. Outputting data for plotting...");

  // Output all collected data at once (timestamp,value format for Serial Plotter)
  for (int i = 0; i < sampleCount; i++)
  {
    Serial.print(timestamps[i]);
    Serial.print(",");
    Serial.println(values[i]);
  }
  
  Serial.println("Data output complete. Stopping measurements.");
  digitalWrite(27, LOW); // Turn off sensor power to stop measuring
}

void loop()
{
  // Empty loop: No further measurements or outputs
}