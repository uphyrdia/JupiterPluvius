/*
  CG2271 Smart Irrigation - ESP32-S2 Gateway

  Hardware:
    DHT11 DATA              -> GPIO7
    Analog LDR signal       -> GPIO8
    ESP32-S2 UART1 TX       -> GPIO17 -> MCXC444 UART RX
    ESP32-S2 UART1 RX       -> GPIO16 <- MCXC444 UART TX
    ESP32-S2 GND            -> MCXC444 GND

  UART: 9600 baud, 8N1, @DATA|payload*HHHH\n frames (CRC-16/CCITT-FALSE)
    ESP32 -> MCU: TEMP:22.5,HUM:53.1,LIGHT_ADC:500
    MCU -> ESP32: SOIL:2048,WATER:1,ALARM:0,LED:1

  Network:
    HTTPS sign-in with the Supabase device account from dashboard/as4/as4.ino.
    POST /rest/v1/readings  - real readings matching dashboard/sql_1.txt

*/

#include <Arduino.h>
#include <WiFi.h>
#include "uart.h"
#include "sensor.h"
#include "supabase.h"
#include <time.h>

constexpr char WIFI_SSID[] = "utakata";
constexpr char WIFI_PASSWORD[] = "phlorova";
constexpr char SUPABASE_URL[] = "https://swdnnvrihfaetgvsxaht.supabase.co";
constexpr char SUPABASE_PUBLISHABLE_KEY[] = "sb_publishable_sJjt6SXXxUpcYvcTUe7UCA_fNBiWSQ9";
constexpr char DEVICE_EMAIL[] = "uphyrdia@gmail.com";
constexpr char DEVICE_PASSWORD[] = "uphyrdia";
constexpr char DEVICE_ID[] = "esp32";

// ==========================================================
// 2. PIN AND TIMING SETTINGS
// ==========================================================
#define UART_RX_PIN 16
#define UART_TX_PIN 17
#define UART_BAUD 9600

constexpr unsigned long DHT_INTERVAL_MS   = 3000;
constexpr unsigned long LIGHT_INTERVAL_MS = 1000;
constexpr unsigned long UART_INTERVAL_MS  = 5000;
constexpr unsigned long API_INTERVAL_MS   = 5000;

// WATER is a binary reservoir-threshold flag, not a percentage.
// MCXC444 sends reservoir_level_ok: WATER:0 means LOW, WATER:1 means OK.
const int WATER_LOW_CODE = 0;

// Same bright/dark threshold as MCXC444/source/main.c; lower ADC is brighter.
const int LIGHT_STATE_THRESHOLD = 1000;

// Soil calibration is optional. Record ADC readings in fully DRY and
// fully WET reference conditions, then enter both below (0..4095).
// Until then, only soil_adc_raw is uploaded; soil_moisture_index = null.
const int SOIL_ADC_DRY = -1;  // TODO: replace with measured dry ADC
const int SOIL_ADC_WET = -1;  // TODO: replace with measured wet ADC

const SupabaseConfig supabaseConfig = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  DEVICE_EMAIL,
  DEVICE_PASSWORD,
  DEVICE_ID,
  LIGHT_STATE_THRESHOLD,
  WATER_LOW_CODE
};

MCXStatus mcx;

unsigned long lastDHTPoll = 0;
unsigned long lastLightPoll = 0;
unsigned long lastUARTSend = 0;
unsigned long lastAPISend = 0;
bool wifiWasConnected = false;

void manageWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.print("[WiFi] Connected; ESP32 IP: ");
      Serial.println(WiFi.localIP());
      // NTP runs in the background; HTTPS waits for a valid clock below.
      configTime(0, 0, "pool.ntp.org", "time.google.com");
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("[WiFi] Connection lost; automatic reconnection enabled");
  }
  // Let auto-reconnect finish its attempt; a manual reconnect can overlap it.
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== CG2271 ESP32-S2 GREENHOUSE GATEWAY ===");

  initSensors();

  // Dedicated TTL UART between MCU boards (NOT the USB Serial Monitor).
  Serial1.begin(UART_BAUD, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  Serial.println("[UART] Serial1 ready, 9600 8N1");

  // Wi-Fi credentials and Supabase authentication follow dashboard/as4/as4.ino.
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) {
    Serial.printf("[WiFi] Disconnected, reason: %u\n",
                  (unsigned int)info.wifi_sta_disconnected.reason);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);

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

void loop() {
  // Always service UART before potentially blocking network activity.
  receiveFromMCXC444(mcx);
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
    unsigned long sampleNow = millis();
    sendToMCXC444(temperatureC, humidityPercent, lightRaw,
                  dhtIsFresh(sampleNow) && lightIsFresh(sampleNow));
  }
  
  if (now - lastAPISend >= API_INTERVAL_MS) {
    lastAPISend = now;
    sendReadingsToSupabase(supabaseConfig, mcx);
  }
}
