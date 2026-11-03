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
    MCU -> ESP32: SOIL:2048,WATER:1,PUMP:0,ALARM:0,LED:1

  Network:
    HTTPS sign-in with the Supabase device account from dashboard/as4/as4.ino.
    POST /rest/v1/readings  - real readings matching dashboard/sql_1.txt

*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino_JSON.h>
#include <DHTesp.h>
#include <time.h>
#include <math.h>
#include <string.h>

// ==========================================================
// 1. CHANGE THESE SETTINGS
// ==========================================================
const char* WIFI_SSID = "utakata";
const char* WIFI_PASSWORD = "phlorova";
const char* SUPABASE_URL = "https://swdnnvrihfaetgvsxaht.supabase.co";
const char* SUPABASE_PUBLISHABLE_KEY = "sb_publishable_sJjt6SXXxUpcYvcTUe7UCA_fNBiWSQ9";
const char* DEVICE_EMAIL = "uphyrdia@gmail.com";
const char* DEVICE_PASSWORD = "uphyrdia";
const char* DEVICE_ID = "esp32"; // Must match the RLS policy.

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
// MCXC444 sends reservoir_level_ok: WATER:0 means LOW, WATER:1 means OK.
const int WATER_LOW_CODE = 0;

// Same bright/dark threshold as MCXC444/source/main.c; lower ADC is brighter.
const int LIGHT_STATE_THRESHOLD = 1000;

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

extern const char ROOT_CA_CERTIFICATES[];
String accessToken;
unsigned long tokenIssuedAt = 0;
unsigned long tokenLifetimeMs = 0;

// Match the MCXC444 frame limit, including the terminating NUL.
const size_t RX_BUFFER_SIZE = 256;
char uartLine[RX_BUFFER_SIZE];
size_t uartLength = 0;

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
// 5. UART FRAMING AND TX: ESP32-S2 -> MCXC444
// ==========================================================
/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF,
 * no reflection, no final XOR. Covers DATA|payload only. */
static uint16_t packetCRC(const char *data, size_t length)
{
	uint16_t crc = 0xFFFFU;
	for (size_t i = 0; i < length; i++) {
		crc ^= (uint16_t)(uint8_t)data[i] << 8;
		for (unsigned int bit = 0; bit < 8; bit++)
			crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
			                      : (uint16_t)(crc << 1);
	}
	return crc;
}

// Validate the frame and replace it with the plain payload.
bool decodePacket(char *message)
{
	size_t length = strlen(message);
	if (length < 13U || strncmp(message, "@DATA|", 6) != 0 ||
	    message[length - 1] != '\n') return false;

	char *end = strchr(message + 6, '*');
	if (end != message + length - 6U ||
	    strpbrk(message + 6, "@\r") != NULL) return false;

	uint16_t received_crc = 0U;
	for (unsigned int i = 1; i <= 4; i++) {
		char c = end[i];
		unsigned int digit;
		if (c >= '0' && c <= '9') digit = (unsigned int)(c - '0');
		else if (c >= 'A' && c <= 'F') digit = (unsigned int)(c - 'A' + 10);
		else if (c >= 'a' && c <= 'f') digit = (unsigned int)(c - 'a' + 10);
		else return false;
		received_crc = (uint16_t)((received_crc << 4) | digit);
	}
	if (received_crc != packetCRC(message + 1,
	                             (size_t)(end - message - 1))) return false;

	*end = '\0';
	memmove(message, message + 6, (size_t)(end - message - 6) + 1U);
	return true;
}

void sendToMCXC444() {
  unsigned long now = millis();
  if (!dhtIsFresh(now) || !lightIsFresh(now)) {
    Serial.println("[UART TX] Waiting for valid sensor readings");
    return;
  }

  char packet[RX_BUFFER_SIZE];
  int n = snprintf(packet, sizeof(packet),
                   "@DATA|TEMP:%.1f,HUM:%.1f,LIGHT_ADC:%d",
                   temperatureC, humidityPercent, lightRaw);
  if (n < 0 || (size_t)n + 7U > sizeof(packet)) {
    Serial.println("[UART TX] Packet formatting error");
    return;
  }

  uint16_t crc = packetCRC(packet + 1, (size_t)n - 1U);
  snprintf(packet + n, sizeof(packet) - (size_t)n,
           "*%04X\n", (unsigned int)crc);
  n += 6; // *HHHH and the newline.

  Serial1.write((const uint8_t*)packet, n);
  Serial.print("[UART TX -> MCXC444] ");
  Serial.print(packet);
}

// ==========================================================
// 6. UART RX: MCXC444 -> ESP32-S2
// ==========================================================
void processMCXPacket(char* line) {
  if (!decodePacket(line)) {
    Serial.println("[UART RX] Invalid frame or CRC");
    return;
  }
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

// Collect @...\n frames. A new @ restarts an incomplete frame.
void receiveFromMCXC444() {
  while (Serial1.available() > 0) {
    char ch = (char)Serial1.read();

    if (ch == '@') uartLength = 0;
    else if (uartLength == 0) continue;

    if (uartLength >= sizeof(uartLine) - 1) {
      uartLength = 0;
      Serial.println("[UART RX] Buffer overflow");
      continue;
    }

    uartLine[uartLength++] = ch;
    if (ch == '\n') {
      uartLine[uartLength] = '\0';
      uartLength = 0;
      processMCXPacket(uartLine);
    }
  }
}

// ==========================================================
// 7. WIFI AND SUPABASE CONNECTION
// ==========================================================
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

  wifiWasConnected = false;
  if (millis() - lastWiFiAttempt >= WIFI_RETRY_MS) {
    lastWiFiAttempt = millis();
    Serial.println("[WiFi] Reconnecting...");
    WiFi.reconnect();
  }
}

int postJson(const String& path, const String& body,
             bool authenticated, String& response) {
  response = "";
  WiFiClientSecure client;
  client.setCACert(ROOT_CA_CERTIFICATES);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  if (!http.begin(client, String(SUPABASE_URL) + path)) {
    Serial.println("Could not initialize HTTPS request.");
    return -1;
  }
  http.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
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

bool ensureSignedIn() {
  if (accessToken.length() > 0 &&
      millis() - tokenIssuedAt < tokenLifetimeMs) return true;

  accessToken = "";
  JSONVar credentials;
  credentials["email"] = DEVICE_EMAIL;
  credentials["password"] = DEVICE_PASSWORD;
  String response;
  const unsigned long started = millis();
  int status = postJson("/auth/v1/token?grant_type=password",
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
String buildReadingJSON() {
  unsigned long now = millis();
  bool haveDHT = dhtIsFresh(now);
  bool haveLight = lightIsFresh(now);
  bool haveMCX = mcxIsFresh(now);

  JSONVar reading;
  reading["device_id"] = DEVICE_ID;
  if (haveDHT) {
    reading["temperature"] = (double)temperatureC;
    reading["humidity"] = (double)humidityPercent;
  } else {
    reading["temperature"] = nullptr;
    reading["humidity"] = nullptr;
  }
  if (haveLight) {
    reading["light_state"] = lightRaw < LIGHT_STATE_THRESHOLD;
  } else {
    reading["light_state"] = nullptr;
  }
  if (haveMCX) {
    reading["soil_adc_raw"] = mcx.soilADC;
    reading["reservoir_state"] = mcx.waterFlag != WATER_LOW_CODE;
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

void sendReadingsToSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (time(nullptr) < 1700000000) {
    Serial.println("[Supabase] Waiting for NTP time before HTTPS");
    return;
  }
  if (!ensureSignedIn()) return;

  // Drain any status frames received during sign-in before making the sample.
  receiveFromMCXC444();
  String payload = buildReadingJSON();
  String response;
  int status = postJson("/rest/v1/readings", payload, true, response);
  Serial.printf("[Supabase] Insert HTTP status: %d\n", status);
  if (status == 201) {
    Serial.println("[Supabase] Reading inserted");
  } else {
    if (status > 0) Serial.println(response);
    if (status == 401) accessToken = ""; // Sign in again next interval.
    // A timed-out insert may have succeeded; send a fresh sample next interval.
  }
}

// ==========================================================
// 9. SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== CG2271 ESP32-S2 GREENHOUSE GATEWAY ===");

  // DHT11 on GPIO7.
  dht.setup(DHT_PIN, DHTesp::DHT11);

  // LDR analog voltage on GPIO8, 12-bit result (0-4095).
  pinMode(LIGHT_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(LIGHT_PIN, ADC_11db);

  // Dedicated TTL UART between MCU boards (NOT the USB Serial Monitor).
  Serial1.begin(UART_BAUD, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  Serial.println("[UART] Serial1 ready, 9600 8N1");

  // Wi-Fi credentials and Supabase authentication follow dashboard/as4/as4.ino.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttempt = millis();
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

// ==========================================================
// 10. MAIN LOOP
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
    sendReadingsToSupabase();
  }
}

/*
  Public trust anchors from the system CA store: GTS Root R1, R3, R4,
  ISRG Root X1 and X2. These cover common Google/Let's Encrypt TLS chains.
  The project's live chain could not be checked from this environment.
  If its CA changes or uses another issuer, update this PEM block using the
  verified issuing CA's root certificate. Do not disable certificate checks.
*/
const char ROOT_CA_CERTIFICATES[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPluILrIPglJ209ZjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjMwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjMwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AAQfTzOHMymKoYTey8chWEGJ6ladK0uFxh1MJ7x/JlFyb+Kf1qPKzEUURout736G
jOyxfi//qXGdGIRFBEFVbivqJn+7kAHjSxm65FSWRQmx1WyRRK2EE46ajA2ADDL2
4CejQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBTB8Sa6oC2uhYHP0/EqEr24Cmf9vDAKBggqhkjOPQQDAwNpADBmAjEA9uEglRR7
VKOQFhG/hMjqb2sXnh5GmCCbn9MN2azTL818+FsuVbu/3ZL3pAzcMeGiAjEA/Jdm
ZuVDFhOD3cffL74UOO0BzrEXGhF16b0DjyZ+hOXJYKaV11RZt+cRLInUue4X
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
)PEM";
