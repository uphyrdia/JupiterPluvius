#include "supabase.h"
#include "root_ca_certs.h"
#include "sensor.h"
#include "uart.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino_JSON.h>
#include <time.h>
#include <math.h>

static String accessToken;
static unsigned long tokenIssuedAt = 0;
static unsigned long tokenLifetimeMs = 0;

static int postJson(const SupabaseConfig& config, const String& path,
                    const String& body, bool authenticated, String& response) {
  response = "";
  WiFiClientSecure client;
  client.setCACert(ROOT_CA_CERTIFICATES);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  if (!http.begin(client, String(config.url) + path)) {
    Serial.println("Could not initialize HTTPS request.");
    return -1;
  }
  http.addHeader("apikey", config.publishableKey);
  http.addHeader("Content-Type", "application/json");
  if (authenticated) {
    http.addHeader("Authorization", String("Bearer ") + accessToken);
    http.addHeader("Prefer", "return=minimal");
  }
  int status = http.POST(body);
  if (status > 0) {
    response = http.getString();
  } else {
    Serial.print("Transport error: ");
    Serial.println(HTTPClient::errorToString(status));
    Serial.println("Check Wi-Fi, DNS, clock and the trusted root certificates.");
  }
  http.end();
  return status;
}

static bool ensureSignedIn(const SupabaseConfig& config) {
  if (accessToken.length() > 0 &&
      millis() - tokenIssuedAt < tokenLifetimeMs) return true;

  accessToken = "";
  JSONVar credentials;
  credentials["email"] = config.deviceEmail;
  credentials["password"] = config.devicePassword;
  String response;
  const unsigned long started = millis();
  int status = postJson(config, "/auth/v1/token?grant_type=password",
                        JSON.stringify(credentials), false, response);
  Serial.print("Sign-in HTTP status: ");
  Serial.println(status);
  // Never print the login response: it contains access and refresh tokens.
  if (status != 200) {
    Serial.println("Check publishable key, device account, password and email confirmation.");
    return false;
  }
  JSONVar result = JSON.parse(response);
  if (JSON.typeof(result) != "object" ||
      JSON.typeof(result["access_token"]) != "string" ||
      JSON.typeof(result["expires_in"]) != "number") {
    Serial.println("Unexpected sign-in response.");
    return false;
  }
  double seconds = (double)result["expires_in"];
  if (!isfinite(seconds) || seconds <= 60.0) return false;
  // Sign in again 60 seconds early; cap local cache to a day to avoid overflow.
  if (seconds > 86400.0) seconds = 86400.0;
  tokenLifetimeMs = (unsigned long)((seconds - 60.0) * 1000.0);
  tokenIssuedAt = started;
  accessToken = (const char*)result["access_token"];
  return accessToken.length() > 0;
}

// ==========================================================
// 8. SUPABASE READINGS (dashboard/sql_1.txt)
// ==========================================================
static String buildReadingJSON(const SupabaseConfig& config, const MCXStatus& mcx) {
  unsigned long now = millis();
  bool haveDHT = dhtIsFresh(now);
  bool haveLight = lightIsFresh(now);
  bool haveMCX = mcxIsFresh(mcx, now);

  JSONVar reading;
  reading["device_id"] = config.deviceId;
  if (haveDHT) {
    reading["temperature"] = (double)temperatureC;
    reading["humidity"] = (double)humidityPercent;
  } else {
    reading["temperature"] = nullptr;
    reading["humidity"] = nullptr;
  }
  if (haveLight) {
    reading["light_state"] = lightRaw < config.lightStateThreshold;
  } else {
    reading["light_state"] = nullptr;
  }
  if (haveMCX) {
    reading["soil_adc_raw"] = mcx.soilADC;
    reading["reservoir_state"] = mcx.waterFlag != config.waterLowCode;
    reading["led_state"] = mcx.ledOn;
  } else {
    reading["soil_adc_raw"] = nullptr;
    reading["reservoir_state"] = nullptr;
    reading["led_state"] = nullptr;
  }

  JSONVar faults = JSON.parse("[]");
  int count = 0;
  if (!haveDHT) faults[count++] = "DHT11_UNAVAILABLE";
  if (!haveLight) faults[count++] = "LIGHT_SENSOR_UNAVAILABLE";
  if (!haveMCX) faults[count++] = "MCXC444_UNAVAILABLE";
  if (haveMCX && mcx.alarm) faults[count++] = "MCXC444_ALARM";
  reading["faults"] = faults;
  reading["test_data"] = false;
  // PostgreSQL supplies id and created_at. Pump state has no column here.
  return JSON.stringify(reading);
}

void sendReadingsToSupabase(const SupabaseConfig& config, MCXStatus& mcx) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (time(nullptr) < 1700000000) {
    Serial.println("[Supabase] Waiting for NTP time before HTTPS");
    return;
  }
  if (!ensureSignedIn(config)) return;

  // Drain any status frames received during sign-in before making the sample.
  receiveFromMCXC444(mcx);
  String payload = buildReadingJSON(config, mcx);
  String response;
  int status = postJson(config, "/rest/v1/readings", payload, true, response);
  Serial.printf("[Supabase] Insert HTTP status: %d\n", status);
  if (status == 201) {
    Serial.println("[Supabase] Reading inserted");
  } else {
    if (status > 0) Serial.println(response);
    if (status == 401) accessToken = ""; // Sign in again next interval.
    // A timed-out insert may have succeeded; send a fresh sample next interval.
  }
}
