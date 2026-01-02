// this code simply connects to the qtr-1a ir sensor module
// it calibrates the board then continuously reads the output
// here is the inspiration
// https://github.com/pololu/qtr-sensors-arduino/blob/master/examples/QTRRCExample/QTRRCExample.ino

#include <QTRSensors.h>

QTRSensors qtr;

const uint8_t SensorCount = 1;
uint16_t sensorValues[SensorCount];

void setup()
{
  pinMode(2, OUTPUT); //blinking light on ESP
  pinMode(27, OUTPUT); //optional power pin to turn qtr on/off
  // configure the sensors
  qtr.setTypeAnalog();
  qtr.setSensorPins((const uint8_t[]){32}, SensorCount); // 4 is the input PIN on ESP
  //qtr.setEmitterPin(2);

  delay(500);
  digitalWrite(2, HIGH); // turn on Arduino's LED to indicate we are in calibration mode
  digitalWrite(27, HIGH);

  Serial.println("starting calibration");
  for (uint16_t i = 0; i < 400; i++)
  {
    qtr.calibrate();
  }
  digitalWrite(2, LOW); // turn off Arduino's LED to indicate we are through with calibration

  // print the calibration minimum values measured when emitters were on
  Serial.begin(115200);
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
  delay(1000);
}

void loop()
{
  qtr.read(sensorValues);

  for (uint8_t i = 0; i < SensorCount; i++)
  {
    //Serial.print("this is a sensor value: ");
    Serial.println(sensorValues[i]);
  }

  delay(100);
}