/*
  CG2271 Smart Irrigation - ESP32-S2 Gateway

  Hardware:
    DHT11 DATA              -> GPIO7
    Analog LDR signal       -> GPIO8
    ESP32-S2 UART1 TX       -> GPIO17 -> MCXC444 UART RX
    ESP32-S2 UART1 RX       -> GPIO16 <- MCXC444 UART TX
    ESP32-S2 GND            -> MCXC444 GND

  UART: 9600 baud, 8N1, newline-terminated messages
    ESP32 -> MCU: TEMP:22.5,HUM:53.1,LIGHT_ADC:500
    MCU -> ESP32: SOIL:40,WATER:80,VALVE:0,ALARM:0, LED:160

  Network:
    GET  /api/v1/health      - optional connectivity check
    POST /api/v1/telemetry   - upload JSON for dashboard

*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <Arduino_JSON.h>
#include <DHTesp.h>
#include <esp_system.h>
#include <math.h>
#include <string.h>

// ==========================================================
// 1. CHANGE THESE SETTINGS
// ==========================================================
const char* ssid = "OnePlus Nord CE 3 Lite 5G";
const char* password = "n4jqtz6y";

const char* TELEMETRY_URL =
    "http://10.243.219.27:8000/api/v1/telemetry";
const char* HEALTH_URL =
    "http://10.243.219.27:8000/api/v1/health";

const char* DEVICE_ID = "greenhouse-01";

// ==========================================================
// 2. PIN AND TIMING SETTINGS
// ==========================================================
#define DHT_PIN 7
#define LIGHT_PIN 8
#define UART_RX_PIN 16
#define UART_TX_PIN 17
#define UART_BAUD 9600

const unsigned long DHT_INTERVAL_MS   = 3000;
const unsigned long LIGHT_INTERVAL_MS = 1000;
const unsigned long UART_INTERVAL_MS  = 5000;
const unsigned long API_INTERVAL_MS   = 5000;
const unsigned long WIFI_RETRY_MS     = 10000;
const unsigned long SENSOR_MAX_AGE_MS = 10000;
const unsigned long MCU_MAX_AGE_MS    = 15000;

// Preliminary sensor calibration from measured readings:
// torch ~100, room ~500, covered ~3000+
const float LIGHT_BRIGHT_ADC = 100.0f;
const float LIGHT_DARK_ADC = 3000.0f;

// WATER is a binary reservoir-threshold flag, not a percentage.
// IMPORTANT: Confirm polarity with the MCXC444 teammate.
// Set to 0 if WATER:0 means LOW and WATER:1 means OK.
const int WATER_LOW_CODE = 1;

// Soil calibration is optional. Record ADC readings in fully DRY and
// fully WET reference conditions, then enter both below (0..4095).
// Until then, only soil_adc_raw is uploaded; soil_moisture_index = null.
const int SOIL_ADC_DRY = -1;  // TODO: replace with measured dry ADC
const int SOIL_ADC_WET = -1;  // TODO: replace with measured wet ADC

// ==========================================================
// 3. STATE
// ==========================================================
DHTesp dht;
float temperatureC = NAN;
float humidityPercent = NAN;
int lightRaw = 0;

bool dhtValid = false;
bool lightValid = false;
unsigned long dhtSampleMs = 0;
unsigned long lightSampleMs = 0;

struct MCXStatus {
  bool valid = false;
  int soilADC = 0;         // Raw 12-bit soil reading (0..4095)
  int waterFlag = 0;       // Binary threshold status (0 or 1)
  bool pumpOn = false;     // 1 = pump/valve active
  bool alarm = false;      // 1 = buzzer on
  bool ledOn = false;      // 1 = external LED on
  unsigned long receivedMs = 0;
};
MCXStatus mcx;

unsigned long lastDHTPoll = 0;
unsigned long lastLightPoll = 0;
unsigned long lastUARTSend = 0;
unsigned long lastAPISend = 0;
unsigned long lastWiFiAttempt = 0;
bool wifiWasConnected = false;

String bootID;
uint32_t sequenceNumber = 0;

char uartLine[128];
size_t uartLength = 0;
bool uartDiscarding = false;

// ==========================================================
// 4. SENSOR READINGS
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

int medianLightADC() {
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

// Relative index, not calibrated lux: 100 = bright, 0 = dark.
float lightIndexFromRaw(int raw) {
  float result = 100.0f *
      (LIGHT_DARK_ADC - raw) /
      (LIGHT_DARK_ADC - LIGHT_BRIGHT_ADC);
  return constrain(result, 0.0f, 100.0f);
}

bool dhtIsFresh(unsigned long now) {
  return dhtValid && (now - dhtSampleMs <= SENSOR_MAX_AGE_MS);
}

bool lightIsFresh(unsigned long now) {
  return lightValid && (now - lightSampleMs <= SENSOR_MAX_AGE_MS);
}

bool mcxIsFresh(unsigned long now) {
  return mcx.valid && (now - mcx.receivedMs <= MCU_MAX_AGE_MS);
}

// ==========================================================
// 5. UART TX: ESP32-S2 -> MCXC444
// ==========================================================
void sendToMCXC444() {
  unsigned long now = millis();
  if (!dhtIsFresh(now) || !lightIsFresh(now)) {
    Serial.println("[UART TX] Waiting for valid sensor readings");
    return;
  }

  char packet[96];
  int n = snprintf(packet, sizeof(packet),
                   "TEMP:%.1f,HUM:%.1f,LIGHT_ADC:%d",
                   temperatureC, humidityPercent, lightRaw);
  if (n < 0 || n >= (int)sizeof(packet)) {
    Serial.println("[UART TX] Packet formatting error");
    return;
  }

  Serial1.print(packet);
  Serial1.print('\n');
  Serial.print("[UART TX -> MCXC444] ");
  Serial.println(packet);
}

// ==========================================================
// 6. UART RX: MCXC444 -> ESP32-S2
// ==========================================================
void processMCXPacket(const char* line) {
  Serial.print("[UART RX <- MCXC444] ");
  Serial.println(line);

  if (strcmp(line, "ACK") == 0) {
    Serial.println("[MCX] ACK received");
    return;
  }

  int soil, water, pump, alarm, led;
  int consumed = 0;

  // Spaces in sscanf format permit either ",LED:" or ", LED:".
  // %n checks that the complete packet matches the expected format.
  int matched = sscanf(line,
      "SOIL:%d,WATER:%d,PUMP:%d,ALARM:%d, LED:%d %n",
      &soil, &water, &pump, &alarm, &led, &consumed);

  if (matched != 5 || consumed == 0 || line[consumed] != '\0' ||
      soil < 0 || soil > 4095 ||
      (water != 0 && water != 1) ||
      (pump  != 0 && pump  != 1) ||
      (alarm != 0 && alarm != 1) ||
      (led   != 0 && led   != 1)) {
    Serial.println("[MCX] Invalid/unsupported status packet");
    return;
  }

  mcx.soilADC = soil;
  mcx.waterFlag = water;
  mcx.pumpOn = (pump == 1);
  mcx.alarm = (alarm == 1);
  mcx.ledOn = (led == 1);
  mcx.valid = true;
  mcx.receivedMs = millis();

  Serial.printf("[MCX] Soil ADC=%d | WaterFlag=%d | Pump=%d | "
                "Alarm=%d | LED=%d\n",
                mcx.soilADC, mcx.waterFlag,
                mcx.pumpOn, mcx.alarm, mcx.ledOn);
}

void receiveFromMCXC444() {
  while (Serial1.available() > 0) {
    char ch = (char)Serial1.read();

    if (ch == '\n') {
      if (!uartDiscarding) {
        uartLine[uartLength] = '\0';
        if (uartLength > 0) processMCXPacket(uartLine);
      }
      uartLength = 0;
      uartDiscarding = false;
    } else if (ch == '\r') {
      // Accept CRLF lines too.
    } else if (uartDiscarding) {
      // Wait for next newline after an oversized message.
    } else if (uartLength < sizeof(uartLine) - 1) {
      uartLine[uartLength++] = ch;
    } else {
      uartLength = 0;
      uartDiscarding = true;
      Serial.println("[UART RX] Line too long; discarded");
    }
  }
}

// ==========================================================
// 7. HTTP GET, FOLLOWING THE ASSIGNMENT SAMPLE
// ==========================================================
String httpGETRequest(const char* serverName) {
  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, serverName)) {
    Serial.println("[HTTP GET] Invalid URL");
    return "";
  }

  http.setConnectTimeout(1500);
  http.setTimeout(2000);
  int code = http.GET();
  String response = "";

  if (code > 0) {
    response = http.getString();
    Serial.printf("[HTTP GET] Status: %d\n", code);
  } else {
    Serial.printf("[HTTP GET] Error: %s\n",
                  http.errorToString(code).c_str());
  }

  http.end();
  return response;
}

// ==========================================================
// 8. WIFI MANAGEMENT
// ==========================================================
void manageWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.print("[WiFi] Connected; ESP32 IP: ");
      Serial.println(WiFi.localIP());

      // GET is just a one-time backend health check.
      String response = httpGETRequest(HEALTH_URL);
      if (response.length() > 0) {
        JSONVar health = JSON.parse(response);
        if (JSON.typeof(health) != "undefined") {
          Serial.print("[API HEALTH] ");
          Serial.println((const char*)health["status"]);
        } else {
          Serial.println("[API HEALTH] Invalid JSON response");
        }
      }
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("[WiFi] Disconnected");
  }

  unsigned long now = millis();
  if (now - lastWiFiAttempt >= WIFI_RETRY_MS) {
    lastWiFiAttempt = now;
    Serial.println("[WiFi] Attempting reconnection...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }
}

// ==========================================================
// 9. BUILD JSON MATCHING FastAPI Telemetry MODEL
// ==========================================================
String buildTelemetryJSON() {
  unsigned long now = millis();
  bool haveDHT = dhtIsFresh(now);
  bool haveLight = lightIsFresh(now);
  bool haveMCX = mcxIsFresh(now);

  JSONVar doc;
  doc["schema_version"] = 1;
  doc["device_id"] = DEVICE_ID;
  doc["boot_id"] = bootID;
  doc["sequence"] = (unsigned long)sequenceNumber++;

  unsigned long oldestAge = 0;
  bool anyMeasurements = false;

  if (haveDHT) {
    doc["temperature_c"] = (double)temperatureC;
    doc["humidity_percent"] = (double)humidityPercent;
    oldestAge = max(oldestAge, now - dhtSampleMs);
    anyMeasurements = true;
  } else {
    doc["temperature_c"] = nullptr;
    doc["humidity_percent"] = nullptr;
  }

  if (haveLight) {
    doc["light_adc_raw"] = lightRaw;
    doc["light_index"] = (double)lightIndexFromRaw(lightRaw);
    oldestAge = max(oldestAge, now - lightSampleMs);
    anyMeasurements = true;
  } else {
    doc["light_adc_raw"] = nullptr;
    doc["light_index"] = nullptr;
  }

  if (haveMCX) {
    doc["soil_adc_raw"] = mcx.soilADC;

    // Convert ADC to relative 0-100 soil index only AFTER calibration.
    if (SOIL_ADC_DRY >= 0 && SOIL_ADC_DRY <= 4095 &&
        SOIL_ADC_WET >= 0 && SOIL_ADC_WET <= 4095 &&
        SOIL_ADC_DRY != SOIL_ADC_WET) {
      float index = 100.0f *
          (SOIL_ADC_DRY - mcx.soilADC) /
          (float)(SOIL_ADC_DRY - SOIL_ADC_WET);
      doc["soil_moisture_index"] = (double)constrain(index, 0.0f, 100.0f);
    } else {
      doc["soil_moisture_index"] = nullptr;
    }

    doc["reservoir_state"] =
        mcx.waterFlag == WATER_LOW_CODE ? "LOW" : "OK";
    doc["watering_active"] = mcx.pumpOn;

    // LED is only on/off, not PWM. Encode ON=255 and OFF=0
    // as the only two representable states in the dashboard schema.
    doc["led_brightness"] = mcx.ledOn ? 255 : 0;

    oldestAge = max(oldestAge, now - mcx.receivedMs);
    anyMeasurements = true;
  } else {
    doc["soil_adc_raw"] = nullptr;
    doc["soil_moisture_index"] = nullptr;
    doc["reservoir_state"] = "UNKNOWN";
    doc["watering_active"] = nullptr;
    doc["led_brightness"] = nullptr;
  }

  // Current MCU message doesn't report a care profile.
  doc["active_profile"] = nullptr;

  JSONVar faults = JSON.parse("[]");
  int faultCount = 0;
  if (!haveDHT) faults[faultCount++] = "DHT11_UNAVAILABLE";
  if (!haveLight) faults[faultCount++] = "LIGHT_SENSOR_UNAVAILABLE";
  if (!haveMCX) faults[faultCount++] = "MCXC444_UNAVAILABLE";
  if (haveMCX && mcx.alarm) faults[faultCount++] = "MCXC444_ALARM";
  doc["faults"] = faults;

  // An empty sensor payload must not look fresh to the backend.
  doc["sample_age_ms"] = anyMeasurements ?
      (unsigned long)oldestAge : (unsigned long)30001;

  // Actual measurements and null values, not fabricated test samples.
  doc["test_data"] = false;

  return JSON.stringify(doc);
}

// ==========================================================
// 10. HTTP POST: SEND TELEMETRY TO LOCAL FASTAPI SERVER
// ==========================================================
void sendTelemetryToDashboard() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP POST] Skipped: Wi-Fi disconnected");
    return;
  }

  String jsonPayload = buildTelemetryJSON();
  Serial.print("[JSON TX] ");
  Serial.println(jsonPayload);

  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, TELEMETRY_URL)) {
    Serial.println("[HTTP POST] Invalid URL");
    return;
  }

  http.setConnectTimeout(1500);
  http.setTimeout(2500);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(jsonPayload);
  if (code > 0) {
    String response = http.getString();
    Serial.printf("[HTTP POST] Status: %d\n", code);
    Serial.print("[HTTP POST] Response: ");
    Serial.println(response);

    if (code == 200) {
      JSONVar reply = JSON.parse(response);
      if (JSON.typeof(reply) != "undefined" &&
          reply.hasOwnProperty("accepted")) {
        Serial.println("[DASHBOARD] Telemetry response received");
      }
    } else if (code == 422) {
      Serial.println("[API] Schema validation error; inspect response");
    } else if (code == 409) {
      Serial.println("[API] Sequence/boot/device conflict");
    }
  } else {
    Serial.printf("[HTTP POST] Error: %s\n",
                  http.errorToString(code).c_str());
  }

  http.end();
}

// ==========================================================
// 11. SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== CG2271 ESP32-S2 GREENHOUSE GATEWAY ===");

  // Unique identity per ESP32 power-on session.
  char idBuffer[32];
  snprintf(idBuffer, sizeof(idBuffer), "esp-%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random());
  bootID = idBuffer;
  Serial.print("[BOOT] ");
  Serial.println(bootID);

  // DHT11 on GPIO7.
  dht.setup(DHT_PIN, DHTesp::DHT11);

  // LDR analog voltage on GPIO8, 12-bit result (0-4095).
  pinMode(LIGHT_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(LIGHT_PIN, ADC_11db);

  // Dedicated TTL UART between MCU boards (NOT the USB Serial Monitor).
  Serial1.begin(UART_BAUD, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  Serial.println("[UART] Serial1 ready, 9600 8N1");

  // PDF Annex A: station connection using WiFi.begin().
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  lastWiFiAttempt = millis();
  Serial.print("[WiFi] Connecting to ");
  Serial.println(ssid);

  // Initial readings (DHT11 needs startup time).
  readLightSensor();
  delay(2000);
  readDHT11();

  unsigned long now = millis();
  lastDHTPoll = now;
  lastLightPoll = now;
  lastUARTSend = now;
  lastAPISend = now;
}

// ==========================================================
// 12. MAIN LOOP
// ==========================================================
void loop() {
  // Always service UART before potentially blocking network activity.
  receiveFromMCXC444();
  manageWiFi();

  unsigned long now = millis();

  if (now - lastLightPoll >= LIGHT_INTERVAL_MS) {
    lastLightPoll = now;
    readLightSensor();
  }

  if (now - lastDHTPoll >= DHT_INTERVAL_MS) {
    lastDHTPoll = now;
    readDHT11();
  }

  if (now - lastUARTSend >= UART_INTERVAL_MS) {
    lastUARTSend = now;
    sendToMCXC444();
  }

  if (now - lastAPISend >= API_INTERVAL_MS) {
    lastAPISend = now;
    sendTelemetryToDashboard();
  }
}
