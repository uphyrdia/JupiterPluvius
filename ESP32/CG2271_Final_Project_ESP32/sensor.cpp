#include "sensor.h"

#include <Arduino.h>
#include <DHTesp.h>
#include <math.h>

static DHTesp dht;
float temperatureC = NAN;
float humidityPercent = NAN;
int lightRaw = 0;

static bool dhtValid = false;
static bool lightValid = false;
static unsigned long dhtSampleMs = 0;
static unsigned long lightSampleMs = 0;

void initSensors() {
  // DHT11 on GPIO7.
  dht.setup(DHT_PIN, DHTesp::DHT11);

  // LDR analog voltage on GPIO8, 12-bit result (0-4095).
  pinMode(LIGHT_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(LIGHT_PIN, ADC_11db);
}

// ==========================================================
// SENSOR READINGS
// ==========================================================
void readDHT11() {
  TempAndHumidity data = dht.getTempAndHumidity();

  if (!isfinite(data.temperature) || !isfinite(data.humidity) ||
      data.temperature < -40.0f || data.temperature > 125.0f ||
      data.humidity < 0.0f || data.humidity > 100.0f) {
    dhtValid = false;
    Serial.print("[DHT11] Invalid reading: ");
    Serial.println(dht.getStatusString());
    return;
  }

  temperatureC = data.temperature;
  humidityPercent = data.humidity;
  dhtValid = true;
  dhtSampleMs = millis();

  Serial.printf("[DHT11] %.1f C | %.1f %% RH\n",
                temperatureC, humidityPercent);
}

static int medianLightADC() {
  const int N = 9;
  int samples[N];

  for (int i = 0; i < N; ++i) {
    samples[i] = analogRead(LIGHT_PIN);
    delay(2);
  }

  for (int i = 1; i < N; ++i) {
    int key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      --j;
    }
    samples[j + 1] = key;
  }
  return samples[N / 2];
}

void readLightSensor() {
  lightRaw = medianLightADC();
  lightValid = true;
  lightSampleMs = millis();
  Serial.printf("[LIGHT] Raw ADC: %d\n", lightRaw);
}

bool dhtIsFresh(unsigned long now) {
  return dhtValid && (now - dhtSampleMs <= SENSOR_MAX_AGE_MS);
}

bool lightIsFresh(unsigned long now) {
  return lightValid && (now - lightSampleMs <= SENSOR_MAX_AGE_MS);
}
