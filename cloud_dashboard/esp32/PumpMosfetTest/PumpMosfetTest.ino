/*
  ESP32-S3 standalone pump test: Serial Monitor at 115200 baud.
  Send 1 for a two-second pulse; send 0 to stop; send ? for help.

  Wiring (identify G/D/S using your exact MOSFET's datasheet):
    GPIO4 -> 330 ohm resistor -> MOSFET Gate
    Gate -> 10k ohm resistor -> Source
    Source -> external pump supply GND -> ESP32 GND
    Drain -> pump negative wire
    Pump positive wire -> external regulated 5V
    1N4001 across pump: striped cathode to +5V, anode to Drain

  Power the ESP32 through USB. Do not connect the external +5V to a
  GPIO or join it to the ESP32's USB-powered 5V rail. Disconnect any
  AD3 digital output previously connected to the Gate.
  Keep this submersible pump in water and electrical connections dry.

  A 30N06L is not necessarily specified for full conduction at 3.3V.
  If the pump struggles or the MOSFET heats up, stop and check the
  gate-drive suitability. Serial messages report commands, not flow.
*/

#include <Arduino.h>

constexpr uint8_t PUMP_PIN = 4;  // Board pin labelled GPIO4 / IO4; must be unused.
constexpr uint32_t RUN_TIME_MS = 2000;

bool pumpRunning = false;
uint32_t startedAt = 0;

void stopPump() {
  digitalWrite(PUMP_PIN, LOW);
  pumpRunning = false;
  Serial.println("Pump command OFF");
}

void setup() {
  digitalWrite(PUMP_PIN, LOW);
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);
  Serial.begin(115200);
  Serial.println("Pump test: 1 = run 2 seconds, 0 = stop, ? = help");
}

void loop() {
  // Check the deadline before processing new commands; no blocking delays.
  if (pumpRunning && uint32_t(millis() - startedAt) >= RUN_TIME_MS) {
    stopPump();
  }

  if (Serial.available() > 0) {
    const char command = char(Serial.read());
    if (command == '1') {
      if (!pumpRunning) {
        startedAt = millis();
        pumpRunning = true;
        digitalWrite(PUMP_PIN, HIGH);
        Serial.println("Pump command ON for 2 seconds");
      } else {
        Serial.println("Already running; shutoff deadline unchanged");
      }
    } else if (command == '0') {
      stopPump();
    } else if (command == '?') {
      Serial.println("1 = run 2 seconds, 0 = stop, ? = help");
    }
  }
}
