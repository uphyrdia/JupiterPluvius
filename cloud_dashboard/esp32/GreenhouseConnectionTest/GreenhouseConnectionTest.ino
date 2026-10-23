// Standalone Wi-Fi/API probe. It does not read sensors or operate actuators.
// Install Arduino_JSON in Arduino IDE. Select the correct ESP32 board target.
// Keep your real Wi-Fi credentials local; do not commit them to this sketch.
#include <WiFi.h>
#include <HTTPClient.h>
#include <Arduino_JSON.h>
#include <esp_system.h>

#if __has_include("wifi_config.h")
#include "wifi_config.h" // Local ignored settings; use the example header as a template.
#else
const char* WIFI_SSID = "YOUR_HOTSPOT";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* BACKEND_URL = "http://192.168.1.100:8000";
#endif
const char* DEVICE_ID = "home-esp32"; // Never use demo-greenhouse.
String bootId;
uint32_t sequenceNumber = 0;
unsigned long lastUpload = 0;
unsigned long lastConnectionNotice = 0;
bool connectionReported = false;

void setup() {
  Serial.begin(115200);
  bootId = "esp-" + String(esp_random(), HEX) + String(esp_random(), HEX);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Connecting. Uploading dummy readings only; no actuator control.");
}

void uploadReadings() {
  JSONVar data;
  data["schema_version"] = 1;
  data["device_id"] = DEVICE_ID;
  data["boot_id"] = bootId;
  data["sequence"] = sequenceNumber++;
  data["temperature_c"] = 29.5;
  data["humidity_percent"] = 65.0;
  data["soil_moisture_index"] = 40.0;
  data["light_index"] = 35.0;
  data["reservoir_state"] = "OK";
  data["watering_active"] = nullptr;
  data["led_brightness"] = nullptr;
  data["active_profile"] = nullptr;
  // Assign an lvalue: Arduino_JSON 0.2.2 moves temporaries without replacing
  // an object's child node, leaving this field null instead of an array.
  JSONVar noFaults = JSON.parse("[]");
  data["faults"] = noFaults;
  data["sample_age_ms"] = 0;
  data["test_data"] = true;
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(2000);
  http.begin(String(BACKEND_URL) + "/api/v1/telemetry");
  http.addHeader("Content-Type", "application/json");
  int status = http.POST(JSON.stringify(data));
  Serial.printf("Telemetry HTTP: %d\n", status);
  if (status == 422) {
    // Our backend returns field/type errors without echoing submitted values.
    String validation = http.getString();
    if (validation.length() <= 2048) Serial.println(validation);
  }
  http.end();
}

void retrieveProfile() {
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(2000);
  http.begin(String(BACKEND_URL) + "/api/v1/devices/" + DEVICE_ID + "/recommendation");
  int status = http.GET();
  if (status == 200) {
    // Backend guarantees a compact recommendation. Bound test parsing too.
    if (http.getSize() > 2048) {
      Serial.println("Unexpectedly large profile response; ignored.");
    } else {
      String body = http.getString();
      if (body.length() <= 2048) {
        JSONVar profile = JSON.parse(body);
        if (JSON.typeof(profile) != "undefined" && JSON.typeof(profile["profile"]) == "string") {
          Serial.print("Profile RECEIVED (not applied): ");
          Serial.println((const char*)profile["profile"]);
          // In the integrated firmware, validate and forward through UART.
          // POST /ack only after receiving a matching MCXC444 ACK.
        }
      }
    }
  } else if (status == 204) {
    Serial.println("No deliverable profile. Keep the local NORMAL fallback.");
  } else {
    Serial.printf("Profile HTTP: %d\n", status);
  }
  http.end();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectionReported = false;
    if (millis() - lastConnectionNotice >= 10000) {
      lastConnectionNotice = millis();
      Serial.printf("Waiting for Wi-Fi. Status: %d\n", (int)WiFi.status());
    }
    delay(100);
    return;
  }
  if (!connectionReported) {
    connectionReported = true;
    Serial.print("Wi-Fi connected. ESP32 address: ");
    Serial.println(WiFi.localIP());
  }
  if (millis() - lastUpload >= 5000) {
    lastUpload = millis();
    uploadReadings();
    retrieveProfile();
  }
  delay(10);
}
