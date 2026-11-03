/*
  ESP32 -> Supabase readings table (educational adaptation).
  Arduino IDE: select your ESP32 board and install Arduino_JSON by Arduino.
  This uses Arduino_JSON (with an underscore), as in the original sketch.

  SETUP
  1. Fill WIFI_SSID, WIFI_PASSWORD, SUPABASE_PUBLISHABLE_KEY,
     DEVICE_EMAIL and DEVICE_PASSWORD below.
  2. Create a confirmed email/password user under Supabase Authentication > Users.
     This is a dedicated device account, not your Supabase dashboard login.
  3. In the SQL Editor, replace DEVICE_USER_UUID with that user's UUID and run:

     ALTER TABLE public.readings ENABLE ROW LEVEL SECURITY;
     GRANT INSERT ON TABLE public.readings TO authenticated;
     GRANT USAGE ON SEQUENCE public.readings_id_seq TO authenticated;
     CREATE POLICY "esp32_1_insert" ON public.readings
       FOR INSERT TO authenticated
       WITH CHECK (
         (SELECT auth.uid()) = 'DEVICE_USER_UUID'::uuid
         AND device_id = 'esp32-1'
       );

     The sequence name above matches the CREATE TABLE in our conversation.
     Other existing permissive policies can also allow access; review those.
     No SELECT policy is needed for this uploader (return=minimal).
  4. Implement buildReading() using your sensor libraries and pin assignments.
     To test the network first, explicitly set SEND_DEMO_READINGS=true.
     Demo mode inserts FIXED SYNTHETIC DATA, not real sensor measurements.
  5. Open Serial Monitor at 115200 baud. Successful insertion: HTTP 201.

  No offline queue or retry of a failed sample is implemented. Each interval
  attempts a fresh reading; created_at is database insertion time.
  Never put an sb_secret_... / service_role key in this sketch.
  Keep device and Wi-Fi passwords private when sharing your filled-in copy.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino_JSON.h>
#include <math.h>
#include <time.h>

const char* WIFI_SSID = "utakata";
const char* WIFI_PASSWORD = "phlorova";
const char* SUPABASE_URL = "https://swdnnvrihfaetgvsxaht.supabase.co";
const char* SUPABASE_PUBLISHABLE_KEY = "sb_publishable_sJjt6SXXxUpcYvcTUe7UCA_fNBiWSQ9";
const char* DEVICE_EMAIL = "uphyrdia@gmail.com";
const char* DEVICE_PASSWORD = "uphyrdia";
const char* DEVICE_ID = "esp32"; // Must match the RLS policy.

const bool SEND_DEMO_READINGS = true;
const unsigned long SEND_INTERVAL_MS = 60000UL;

// Public root certificates are defined at the bottom, keeping the logic readable.
// The server certificate's hostname and chain are verified; no setInsecure().
extern const char ROOT_CA_CERTIFICATES[];

String accessToken;
unsigned long tokenIssuedAt = 0;
unsigned long tokenLifetimeMs = 0;
unsigned long lastAttempt = 0;

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println("Connecting to Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000UL) {
    delay(250);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi unavailable; will try at the next interval.");
    return false;
  }
  Serial.print("Local IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool ensureClock() {
  // TLS certificate validity checks require a reasonably correct system clock.
  if (time(nullptr) >= 1700000000) return true; // a date in November 2023, sanity check only
  // time(nullptr) returns Calendar time, in Unix seconds
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("Synchronizing time for HTTPS...");
  const unsigned long started = millis(); // Elapsed milliseconds since program startup
  while (time(nullptr) < 1700000000 && millis() - started < 15000UL) {
    delay(250);
  }
  if (time(nullptr) < 1700000000) {
    Serial.println("Time sync failed; check that the network allows NTP.");
    return false;
  }
  return true;
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

bool buildReading(JSONVar& reading) {
  if (!SEND_DEMO_READINGS) {
    Serial.println("No sensor driver configured. Implement buildReading(), or enable demo mode.");
    return false;
  }

  // REPLACE THESE FIXED TEST VALUES with actual sensor reads.
  // After wiring real sensors, remove the early-return/demo block above.
  // Initialize the sensors in setup() as required by their libraries.
  double temperature = 28.5;
  double humidity = 72.0;
  bool light_state = false;
  int soil_adc_raw = 1800;
  bool reservoir_state = true;
  bool led_state = false;

  // This version assumes the NOT NULL table defined in the conversation.
  // Skip an incomplete/invalid sample rather than inserting fabricated zeros.
  // Add your other sensors' failure checks here as appropriate.
  if (!isfinite(temperature) || !isfinite(humidity) ||
      humidity < 0.0 || humidity > 100.0) {
    Serial.println("Invalid measurement; skipping this sample.");
    return false;
  }

  reading["device_id"] = DEVICE_ID;
  reading["temperature"] = temperature;
  reading["humidity"] = humidity;
  reading["light_state"] = light_state;
  reading["soil_adc_raw"] = soil_adc_raw;
  reading["reservoir_state"] = reservoir_state; // JSON boolean, not "true"/"false" text.
  reading["led_state"] = led_state;
  // id and created_at are omitted: PostgreSQL supplies them.
  return true;
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (SEND_DEMO_READINGS) {
    Serial.println("DEMO MODE: fixed synthetic readings will be uploaded.");
  } else {
    Serial.println("Implement buildReading() before collecting real measurements.");
  }
  // Arrange for the first attempt to happen immediately in loop().
  lastAttempt = millis() - SEND_INTERVAL_MS;
}

void loop() {
  if (millis() - lastAttempt < SEND_INTERVAL_MS) {
    delay(10);
    return;
  }
  lastAttempt = millis(); // Also throttle failures; never spin on an error.
  if (!connectWiFi() || !ensureClock()) return;

  JSONVar reading;
  if (!buildReading(reading) || !ensureSignedIn()) return;
  if (SEND_DEMO_READINGS) Serial.println("Uploading DEMO data.");
  String payload = JSON.stringify(reading);
  Serial.print("Reading: ");
  Serial.println(payload);

  String response;
  int status = postJson("/rest/v1/readings", payload, true, response);
  Serial.print("Insert HTTP status: ");
  Serial.println(status);
  if (status == 201) {
    Serial.println("Reading inserted.");
  } else {
    if (status > 0) Serial.println(response); // PostgREST error details.
    if (status == 401) accessToken = ""; // Sign in again at the next interval.
    // Do not blindly retry the same POST after a timeout: it may have committed.
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
