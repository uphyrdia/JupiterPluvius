"""JupiterPluvius backend.

A thin read-only layer between the dashboard and Supabase:
  - signs in to Supabase as the "backend" user (who has SELECT permission via RLS)
  - exposes two JSON endpoints the frontend polls
  - offers an "AI check-up" that asks DeepSeek to summarise recent readings
  - serves the static frontend from ../frontend

The ESP32 writes to Supabase directly; this server never writes anything.
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# convenience for local dev, Render uses an "Environment" tab
# .env is in .gitignore, load_dotenv does nothing if .env doesn't exist
load_dotenv(Path(__file__).with_name(".env"))

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]
BACKEND_EMAIL = os.environ["BACKEND_EMAIL"]
BACKEND_PASSWORD = os.environ["BACKEND_PASSWORD"]

MAX_ROWS = 1000   # Supabase's default max rows per request
MAX_PAGES = 20    # safety cap: at most 20,000 rows (~20 MB in memory) per request

DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY")  # optional: only the AI check-up needs it
DEEPSEEK_MODEL = "deepseek-flash"                  # DeepSeek-V4.1-Flash
AI_COOLDOWN_S = 15         # at most one AI call per 15 s, so button mashing can't drain the balance
PUMP_THRESHOLD_RAW = 1200  # keep in sync with MOISTURE_THRESHOLD in MCXC444/source/main.c

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="JupiterPluvius API")
# Allows the frontend to be hosted elsewhere (e.g. a Render Static Site) too.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])

# an HTTP client to fetch data from Supabase
supabase = httpx.AsyncClient(base_url=SUPABASE_URL, headers={"apikey": SUPABASE_KEY}, timeout=15)
_token = {"value": None, "expires_at": 0.0}

# an HTTP client for DeepSeek's OpenAI-style chat API; answers can take a while
deepseek = httpx.AsyncClient(
    base_url="https://api.deepseek.com", headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"}, timeout=120
)
_last_ai_call = 0.0


async def get_token(force_refresh: bool = False) -> str:
    """Return a cached Supabase access token, signing in again when it is about to expire."""
    if not force_refresh and _token["value"] and time.time() < _token["expires_at"]:
        return _token["value"]
    r = await supabase.post(
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": BACKEND_EMAIL, "password": BACKEND_PASSWORD},
    )
    if r.status_code != 200:
        raise HTTPException(502, f"Supabase sign-in failed ({r.status_code})")
    data = r.json()
    _token["value"] = data["access_token"]
    _token["expires_at"] = time.time() + data.get("expires_in", 3600) - 60 
    # 3600 seconds (1 hour) is Supabase’s default token lifetime
    return _token["value"]


async def select_readings(params: dict) -> list[dict]:
    """GET /rest/v1/readings with PostgREST query params; retries once on an expired token."""
    for attempt in range(2):
        token = await get_token(force_refresh=attempt > 0)
        r = await supabase.get(
            "/rest/v1/readings", params=params, headers={"Authorization": f"Bearer {token}"}
        )
        if r.status_code != 401:
            break
    if r.status_code != 200:
        raise HTTPException(502, f"Supabase query failed ({r.status_code}): {r.text}")
    return r.json()


def base_filters(device_id: str | None, include_test: bool) -> dict:
    params = {"select": "*"}
    if device_id:
        params["device_id"] = f"eq.{device_id}"
    if not include_test:
        params["test_data"] = "is.false"
    return params


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/latest")
async def latest(device_id: str | None = None, include_test: bool = True):
    """The most recent reading, or null if the table is empty."""
    params = base_filters(device_id, include_test) | {"order": "id.desc", "limit": "1"}
    rows = await select_readings(params)
    return rows[0] if rows else None


@app.get("/api/readings")
async def readings(
    hours: float = Query(1, gt=0, le=24),
    after_id: int | None = None,
    device_id: str | None = None,
    include_test: bool = True,
):
    """Readings from the last `hours` (at most 24), oldest first.

    `after_id` returns only rows newer than that id (used by the frontend's polling).
    Supabase returns at most 1000 rows per request, so the window is fetched page by page,
    newest first. At most MAX_PAGES pages are fetched: if the ESP32 uploads far too often,
    the oldest part of the window is dropped instead of exhausting the server's memory.
    If more than 1000 readings remain, they are evenly thinned to 1000.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    params = base_filters(device_id, include_test) | {
        "created_at": f"gte.{since.isoformat()}",
        "order": "id.desc",
        "limit": str(MAX_ROWS),
    }
    id_filters = [f"gt.{after_id}"] if after_id is not None else []

    rows: list[dict] = []
    for _ in range(MAX_PAGES):  # 24 h at one reading per 30 s is only 3 pages
        # Continue below the oldest id so far (not by offset, which shifts as new rows arrive).
        page_filters = id_filters + ([f"lt.{rows[-1]['id']}"] if rows else [])
        page = await select_readings(params | ({"id": page_filters} if page_filters else {}))
        rows.extend(page)
        if len(page) < MAX_ROWS:
            break
    rows.reverse()  # the frontend expects oldest first

    if len(rows) > MAX_ROWS:
        step = len(rows) / MAX_ROWS
        newest = rows[-1]
        rows = [rows[int(i * step)] for i in range(MAX_ROWS)]
        rows[-1] = newest  # always keep the latest reading
    return rows


# ---------------------------------------------------------------------------
# AI check-up
# ---------------------------------------------------------------------------
AI_RULES = """
Write for the plant's owner, who is not an engineer. Be brief, concrete and friendly.
Base every statement on the data. If data is missing or sparse, or the device seems offline
(the last reading is long ago), say so. Never invent readings.
Things that deserve advice: the reservoir is low (refill it); the soil stays dry or keeps drying
despite the pump (check reservoir, pump, tubing, sensor); the soil stays soaked (overwatering or
poor drainage); temperature or humidity uncomfortable for a typical houseplant; the device offline;
sensor faults or implausible values (soil_raw near 0 or 4095, sudden jumps).
If everything looks fine, say so and give little or no advice.
Times are the owner's local time; quote them as given.
Reply with a JSON object only, in exactly this shape:
{"status": "good" | "attention" | "urgent",
 "headline": "<one short sentence>",
 "summary": ["<2 to 4 short points on what happened in this period>"],
 "advice": [{"priority": "info" | "warning" | "urgent", "text": "<one short actionable sentence>"}]}
"advice" may be an empty list.
"""


def ai_context(dry: int, wet: int) -> str:
    """System prompt: how the device works, so the model can interpret the numbers."""
    return f"""You are the assistant built into JupiterPluvius, a student-built automatic
plant-watering device for one potted plant.

How the device works:
- An MCXC444 microcontroller reads a soil-moisture sensor with a 12-bit ADC (soil_raw, 0-4095).
  The reading is INVERSELY related to moisture: about {dry} in dry air, about {wet} in a wet tissue.
  moisture_pct = (soil_raw - {dry}) / ({wet} - {dry}) * 100, clamped to 0-100.
- Whenever soil_raw is above {PUMP_THRESHOLD_RAW} (drier than that), the firmware runs the water pump
  in short bursts (1 s if air humidity > 60 %, otherwise 2 s). Pump activity itself is not logged.
- An ESP32 measures air temperature, air humidity and ambient light, and uploads all readings.
- light_bright = 0 means it is dark; then the firmware switches on a grow LED (led_on = 1).
- reservoir_ok = 0 means the water reservoir feeding the pump is low: the pump cannot water the
  plant until the owner refills it.
- faults lists error codes reported by the device, if any.
{AI_RULES}"""


def parse_time(s: str) -> datetime:
    # Drop fractional seconds: older Pythons can't parse PostgREST's variable-length fractions.
    return datetime.fromisoformat(re.sub(r"\.\d+", "", s))


def stats(values: list) -> str:
    vals = [v for v in values if v is not None]
    if not vals:
        return "no data"
    return f"min {min(vals):.1f}, mean {sum(vals) / len(vals):.1f}, max {max(vals):.1f}, latest {vals[-1]:.1f}"


def ai_prompt(rows: list[dict], hours: float, tz: timezone, dry: int, wet: int) -> str:
    """User message: precomputed facts (models are poor at arithmetic over 1000 rows) + the rows as CSV."""
    now = datetime.now(tz)
    flag = lambda v: "" if v is None else int(v)  # noqa: E731
    pct = lambda raw: None if raw is None else min(100.0, max(0.0, (dry - raw) / (dry - wet) * 100))  # noqa: E731

    moist = [pct(r["soil_adc_raw"]) for r in rows]
    faults = sorted({f for r in rows for f in r.get("faults") or []})
    count = lambda key, value: sum(r.get(key) is value for r in rows)  # noqa: E731
    lines = [
        f"Current local time: {now:%Y-%m-%d %H:%M} (UTC{now:%z})",
        f"Period analysed: the last {hours:g} h, {len(rows)} readings (evenly thinned if there were more than 1000).",
        f"Last reading: {(now - parse_time(rows[-1]['created_at'])).total_seconds() / 60:.0f} min ago.",
        "Statistics over the period:",
        f"- moisture_pct: {stats(moist)}",
        f"- soil_raw: {stats([r['soil_adc_raw'] for r in rows])}",
        f"- temp_c: {stats([r['temperature'] for r in rows])}",
        f"- humidity_pct: {stats([r['humidity'] for r in rows])}",
        f"- readings with reservoir low: {count('reservoir_state', False)}; dark: {count('light_state', False)};"
        f" grow LED on: {count('led_state', True)}",
        f"- faults seen: {', '.join(faults) or 'none'}",
        "",
        "Readings, oldest first (CSV):",
        "time,soil_raw,moisture_pct,temp_c,humidity_pct,light_bright,led_on,reservoir_ok,faults",
    ]
    for r, m in zip(rows, moist):
        lines.append(",".join(str(x) for x in [
            f"{parse_time(r['created_at']).astimezone(tz):%m-%d %H:%M:%S}",
            r["soil_adc_raw"] if r["soil_adc_raw"] is not None else "",
            "" if m is None else round(m),
            r["temperature"] if r["temperature"] is not None else "",
            r["humidity"] if r["humidity"] is not None else "",
            flag(r["light_state"]), flag(r["led_state"]), flag(r["reservoir_state"]),
            "|".join(r.get("faults") or []),
        ]))
    return "\n".join(lines)


@app.post("/api/insights")
async def insights(
    hours: float = Query(1, gt=0, le=24),
    include_test: bool = True,
    tz_offset_min: int = Query(0, ge=-720, le=840),  # the browser's offset from UTC, e.g. 480 for UTC+8
    soil_dry_raw: int = 1900,
    soil_wet_raw: int = 1200,
):
    """Ask DeepSeek for a short summary of, and advice on, the readings from the last `hours`."""
    global _last_ai_call
    if not DEEPSEEK_KEY:
        raise HTTPException(503, "DEEPSEEK_API_KEY is not set on the server")
    wait = AI_COOLDOWN_S - (time.time() - _last_ai_call)
    if wait > 0:
        raise HTTPException(429, f"Please wait {wait:.0f} s before asking again")
    _last_ai_call = time.time()

    rows = await readings(hours=hours, after_id=None, device_id=None, include_test=include_test)
    if not rows:
        raise HTTPException(404, "There are no readings in this time range to analyse")

    tz = timezone(timedelta(minutes=tz_offset_min))
    r = await deepseek.post("/chat/completions", json={
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": ai_context(soil_dry_raw, soil_wet_raw)},
            {"role": "user", "content": ai_prompt(rows, hours, tz, soil_dry_raw, soil_wet_raw)},
        ],
        "response_format": {"type": "json_object"},
        "reasoning_effort": "low",  # a little thinking is plenty for a summary, and keeps it fast and cheap
        "max_tokens": 4000,
    })
    if r.status_code != 200:
        raise HTTPException(502, f"DeepSeek error ({r.status_code}): {r.text[:300]}")
    data = r.json()
    content = data["choices"][0]["message"]["content"] or ""
    try:
        result = json.loads(content)
    except ValueError:
        result = None
    if not isinstance(result, dict):
        result = {"raw": content}  # the frontend shows it as plain text
    return result | {
        "model": data.get("model", DEEPSEEK_MODEL),
        "readings": len(rows),
        "tokens": data.get("usage", {}).get("total_tokens"),
    }


@app.on_event("shutdown")
async def close_client():
    await supabase.aclose()
    await deepseek.aclose()


# Mounted last so /api/* routes take priority. html=True serves index.html at "/".
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
