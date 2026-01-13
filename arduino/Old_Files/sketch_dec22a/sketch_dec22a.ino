// LED on GPIO2
int ledPin1 = 2;
int ledPin2 = 26;
 
void setup()
{
    // Set LED as output
    pinMode(ledPin1, OUTPUT);
    pinMode(ledPin2, OUTPUT);
    
    // Serial monitor setup
    Serial.begin(115200);
    Serial.println("Setup done");
}
 
void loop()
{
    Serial.print("Hello");
    digitalWrite(ledPin1, HIGH);
    digitalWrite(ledPin2, HIGH);
    
    delay(2000);
    
    Serial.println(" world!");
    digitalWrite(ledPin1, LOW);
    digitalWrite(ledPin2, LOW);

    delay(2000);
}