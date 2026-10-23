# Greenhouse dashboard

Local telemetry, sensor history, and SoCLaaS care advice for the CG2271 prototype.
The dashboard runs independently of the MCXC444 project. It starts an isolated simulator,
and can later accept ESP32 snapshots using the same ingestion logic.

## Start on Windows

Python 3.11 is required. Open PowerShell in this folder:

```powershell
.\start.ps1 -Install -EnvFile 'C:\wjw\soclaas.env'
```

The first run creates `.venv` and installs the pinned dependencies. On later runs:

```powershell
.\start.ps1 -EnvFile 'C:\wjw\soclaas.env'
```

Open **http://127.0.0.1:8000**. Stop with Ctrl+C. If PowerShell blocks an unsigned local
script, use a single-process invocation (no machine-wide execution-policy change):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -EnvFile 'C:\wjw\soclaas.env'
```

For ESP32 testing on the same trusted network:

```powershell
.\start.ps1 -LAN -EnvFile 'C:\wjw\soclaas.env'
```

Use the laptop's reachable IPv4 address in the ESP32 sketch, for example
`http://192.168.1.100:8000`. `localhost` on ESP32 refers to ESP32, not your laptop.
Your hotspot must permit client-to-client communication, and Windows Firewall must allow
the backend on your private test network. LAN mode binds to `0.0.0.0`; default mode is
loopback-only. This is a trusted-network prototype, with no login or internet deployment.

Options: `-Port 8001`, `-NoSimulator`, `-Install` to reinstall requirements, and `-Test`.
Run a single worker. Simulation and pending analyses belong to that process; do not use
multiple Uvicorn workers or automatic development reload during a demo.

## Configuration and stored data

The key stays in the downloaded file, outside the repository. Expected variables:

```dotenv
SOCLAAS_BASE_URL=https://soclaas-api.comp.nus.edu.sg/v1
SOCLAAS_API_KEY=<your local key>
SOCLAAS_MODEL=default
```

`SOCLAAS_ENV_FILE` chooses a different file. Existing process variables override file
values. The default file is `C:\wjw\soclaas.env` if present, otherwise this folder's `.env`.
The backend only sends credentials to the official HTTPS SoCLaaS hostname, never follows
redirects, and never returns configuration or provider response bodies to the browser.
`.env.example` contains no credentials. Wi-Fi credentials in a personal test sketch must
also stay out of commits and submissions; the supplied sketch contains placeholders.

SQLite data lives in ignored `data/greenhouse.sqlite3`. Override its location with
`GREENHOUSE_DB_PATH`. History survives restarts. Startup marks unfinished analyses failed.
All stored timestamps are UTC; the interface displays Asia/Singapore time.

No calibration or physical-control thresholds are defined by the dashboard. The profiles
are names for the MCXC444 team's tested behavior. Generic Demo does not claim optimized
plant care. An Analyze click is the only trigger for a SoCLaaS query.

## Try the dashboard

1. Select `demo-greenhouse` (reserved simulator ID).
2. Try Normal, Drying Soil, Low Reservoir, or Sensor Fault. These are illustrative signals,
   not biological simulations. Updates arrive every two seconds.
3. Pause for over 30 seconds: readings are marked stale and profile delivery is withheld.
4. Click Analyze readings. The backend submits actual available history (up to ten minutes).
5. A valid recommendation shows its reason, expiry, and a **simulated** acknowledgement.
   No physical actuator has been commanded. Low-water/fault advice is visible, but withheld
   from delivery when safety conditions are unresolved.

The four charts offer 10-minute, 1-hour, and 24-hour ranges, with at most 1,200 bucketed
observations. Missing values break the line. Raw ADC remains raw and never becomes a
moisture percentage or light index automatically. The calibrated indices run from
0 (dry/dark) to 100 (wet/bright); calibration belongs to the sensor firmware.

## API contract for Member 1

Interactive documentation is at `/docs`; the complete schema is `/openapi.json`.
All paths below begin with `/api/v1`. JSON fields are strict; undeclared fields and
strings where numbers are expected are rejected. Responses do not echo rejected inputs.

| Method and path | Behavior |
|---|---|
| `POST /telemetry` | Store a reading; HTTP 200, including an idempotent duplicate |
| `GET /devices` | List device snapshots, source, and freshness |
| `GET /devices/{id}/dashboard` | Latest readings, AI state, delivery reason, events |
| `GET /devices/{id}/history?range=10m` | History; range is `10m`, `1h`, or `24h` |
| `POST /devices/{id}/analyze` | Start analysis; HTTP 202; 429 while running/on cooldown |
| `GET /devices/{id}/recommendation` | Compact profile; HTTP 204 if unavailable |
| `POST /devices/{id}/ack` | MCXC444 result relayed by ESP32 |
| `POST /simulation` | Simulator scenario and pause/resume controls |
| `GET /health` | Backend and AI configuration availability, without secrets |

### Telemetry

Upload a snapshot every five seconds. A reboot generates a new `boot_id` and restarts
`sequence` at zero. Sequence must increase within a boot; exact retries are idempotent.
Conflicting duplicates and out-of-order/superseded-boot packets return HTTP 409.
The backend's receipt timestamp is authoritative; no ESP32 wall-clock setup is required.

```json
{
  "schema_version": 1,
  "device_id": "home-esp32",
  "boot_id": "esp-a135c912",
  "sequence": 12,
  "temperature_c": 29.5,
  "humidity_percent": 65.0,
  "soil_moisture_index": 40.0,
  "light_index": 35.0,
  "soil_adc_raw": null,
  "light_adc_raw": null,
  "reservoir_state": "OK",
  "watering_active": false,
  "led_brightness": 160,
  "active_profile": "NORMAL",
  "faults": [],
  "sample_age_ms": 100,
  "test_data": false
}
```

Identity fields and `sample_age_ms` are required. Device IDs use 1-64 letters, digits,
underscores, or hyphens. Numeric readings are nullable: omit or use null when unavailable.
Temperature range is -40 to 125 C; humidity and calibrated indices are 0-100; raw ADC
is 0-4095; LED is 0-255. Reservoir is `OK`, `LOW`, or `UNKNOWN` (default). Unknown actuator
state is null; never report false merely because UART data is missing. `faults` is a list
of up to 20 short strings. `test_data` defaults to false; set true for dummy readings
uploaded by a real board. It adds an explicit test-data label without claiming simulation
or physical application.

`sample_age_ms` is the age of the **oldest included reading**, accounting for delayed UART
data as well as ESP32 acquisition. Effective age is this value plus time since receipt;
over 30 seconds is stale. A repeated packet does not refresh freshness.

The existing repository code produces soil/light raw ADC values; normalized fields can
remain null while calibration and outgoing UART packets are implemented. Preserve raw
diagnostics. Do not manufacture missing water-level or actuator state from defaults.

### Advice and profile delivery

```json
{"care_profile":"NORMAL","advisory_code":"NONE","reason":"Limited history; use the tested default profile."}
```

Profiles: `NORMAL`, `CONSERVATIVE`, `HIGH_DEMAND`. Advisory codes: `NONE`, `LOW_LIGHT`,
`REFILL_RESERVOIR`, `CHECK_SENSOR`, `CHECK_WATER_DELIVERY`. Only these three JSON fields are
accepted; reason length is 1-160 characters. Markdown-wrapped JSON and duplicate keys are
rejected. Requests use a 45-second total timeout and a bounded 256-KiB API response.
One request per device may run; another is allowed after 60 seconds. No automatic retries.

ESP32 retrieves every five seconds:

```json
{"recommendation_id":"<uuid>","profile":"NORMAL","ttl_seconds":895}
```

HTTP 204 means no deliverable recommendation. Use the local NORMAL fallback after expiry
or link failure. Validity lasts 15 minutes from successful analysis; failed queries never
extend it. Delivery requires fresh telemetry, reservoir `OK`, no reported faults, a
calibrated soil index, and no safety-check advisory. Simulated profiles never leave through
the ESP32 endpoint. Do not transfer profiles between device IDs.

MCXC444 validates profile names and keeps its maximum watering duration, soak interval,
low-water inhibition, fresh-reading checks, and local lighting logic. It owns actual
profile settings. Cloud recommendations are not immediate actuator commands.

### Acknowledgement

ESP32 sends this **only after a matching MCXC444 acknowledgement**:

```json
{"recommendation_id":"<uuid>","result":"APPLIED","origin":"MCXC444","reason":null}
```

For rejection use `"result":"REJECTED"` and a short reason. Recommendations must belong
to the addressed device. Repeating the same acknowledgement is idempotent; changing an
existing result returns HTTP 409. Late acknowledgements are recorded as historical facts
but do not renew the profile. An ESP32 receipt alone is not an applied acknowledgement.
Rejected recommendations are withheld from further delivery. For repeated retrieval of
an applied profile, retain the recommendation ID and use its decreasing TTL; do not
restart a watering action or extend the original validity on every poll.

## Home ESP32 test

Open `esp32/GreenhouseConnectionTest/GreenhouseConnectionTest.ino` and install Arduino_JSON
(verified with 0.2.2). Copy `wifi_config.example.h` to `wifi_config.h` in the same sketch
folder, then fill in the hotspot name, password, and laptop address locally. This private
header is ignored by Git; never put real credentials in the example header or sketch.
Use a 2.4 GHz hotspot (on an iPhone, enable Maximize Compatibility if needed).
Select your own ESP32 target. The detected home board is ESP32-S3 on COM5 through a CP210x
USB-to-UART bridge, with 8 MB flash. For that board select **ESP32S3 Dev Module**, **Flash
Size: 8MB**, **Partition Scheme: 8M with spiffs**, and **USB CDC On Boot: Disabled**.
Other boards may require different settings; do not reuse COM5 without checking.
The sketch has no sensor pins or actuator code. It sends `test_data:true`, leaves actuator
state unavailable, and prints received profiles to Serial Monitor at 115200 baud.

1. Start the backend with `-LAN`; join the same hotspot/network on the laptop and ESP32.
2. Upload the sketch. Look for `Telemetry HTTP: 200`.
3. Select `home-esp32` in the dashboard; confirm `Live board · test data`.
4. Click Analyze. Look for `Profile RECEIVED (not applied)` in Serial Monitor.
5. The dashboard must still show **Waiting for controller acknowledgement**.

The connection sketch replaces the board's current program. If preserving it matters,
make a full flash backup before upload and keep it outside commits. Build output also
contains the local Wi-Fi settings and must stay in ignored `data/` or a private build
directory. The test does not require or contain the SoCLaaS API key.

Do not copy this entire sketch into Member 1's firmware. Integrate only the HTTP upload,
profile retrieval, and ACK relay functions; keep one Wi-Fi owner, main initialization,
and UART owner. Handle network calls away from time-sensitive acquisition/UART work.

## Verification

```powershell
.\start.ps1 -Test
# Or:
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe test_soclaas.py --env-file 'C:\wjw\soclaas.env'
```

Automated tests inject temporary databases and mocked HTTP transports, never real API
keys or real SoCLaaS requests. They cover validation, persistence, duplicates, stale data,
profile expiry, malformed/error responses, acknowledgements, concurrency, and source
isolation. The manual connection script sends one small real request and prints no key.
Verify desktop and narrow-screen layouts in a browser. Physical-board verification needs
your ESP32 connected and flashed with the test sketch; a software API probe is not proof
of a physical-board connection.

### Verification in this workspace

- Python 3.11 backend: automated tests pass with mocked SoCLaaS and temporary databases.
- Desktop and narrow-screen browser checks: readings, charts, low-water withholding,
  stale data, missing values, raw ADC labels, and device switching verified.
- A real SoCLaaS analysis returned a validated JSON recommendation; its acknowledgement
  was explicitly simulated.
- Local HTTP upload/retrieval probe succeeded without claiming a hardware connection.
- ESP32 test sketch compiled for `esp32:esp32:esp32` with core 3.3.7 and Arduino_JSON 0.2.2.
- ESP32-S3 test compiled with 8 MB flash settings and uploaded on COM5; the uploader
  verified the firmware hash. Original 8 MB flash is backed up in ignored
  `data/esp32s3-COM5-before-connection-test.bin`.
- Physical upload/retrieval test passed on 13 October 2026 using the home ESP32-S3 on
  COM5 and a 2.4 GHz phone hotspot. The board uploaded dummy telemetry every five seconds
  (`Telemetry HTTP: 200`), a manual SoCLaaS analysis returned a validated `NORMAL` profile,
  and serial output confirmed `Profile RECEIVED (not applied): NORMAL`.
- The browser showed `Live board · test data`, fresh readings, unavailable actuator
  states, and `Waiting for controller acknowledgement`. No hardware application was
  reported. Screenshot and serial evidence are in ignored `data/`.
- Arduino_JSON 0.2.2 requires assigning the empty fault array through a named `JSONVar`;
  assigning `JSON.parse("[]")` directly to an object property selects its move assignment
  and leaves the property null, which the telemetry API correctly rejects with HTTP 422.
