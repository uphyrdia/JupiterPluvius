"""AI check-up prompts, cooldown, and DeepSeek requests."""

import json
import re
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

from config import (
    AI_COOLDOWN_S, DEEPSEEK_KEY, DEEPSEEK_MODEL, PUMP_COOLDOWN_S, PUMP_DRY_AIR_PCT, PUMP_EXTRA_S,
    PUMP_HOT_C, PUMP_RUN_S, PUMP_THRESHOLD_RAW,
)
from readings import fetch_readings

# an HTTP client for DeepSeek's OpenAI-style chat API; answers can take a while
deepseek = httpx.AsyncClient(
    base_url="https://api.deepseek.com", headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"}, timeout=120
)
_last_ai_call = 0.0


AI_RULES = """
Write for the plant's owner, who is not an engineer. Be brief, concrete and friendly.
Base every statement on the data. If data is missing or sparse, or the device seems offline
(the last reading is long ago), say so. Never invent readings.
Things that deserve advice: the reservoir is low (refill it); the soil stays dry or keeps drying
despite the pump (check reservoir, pump, tubing, sensor); the soil stays soaked (overwatering or
poor drainage); temperature or humidity uncomfortable for a typical houseplant; the device offline;
sensor faults or implausible values (soil_raw near 0 or 4095, sudden jumps).
If everything looks fine, say so and give little or no advice.
Test data is not real: if some or all readings are test data, say so, and base plant-care advice
only on the real readings (give none if there are no real readings).
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
  The reading is INVERSELY related to moisture: about {dry} in dry air, about {wet} when fully wet.
  moisture_pct = (soil_raw - {dry}) / ({wet} - {dry}) * 100, clamped to 0-100.
- Whenever soil_raw is above {PUMP_THRESHOLD_RAW} (drier than that), the firmware runs the water pump
  for {PUMP_RUN_S} s, or {PUMP_RUN_S + PUMP_EXTRA_S} s if the air temperature is {PUMP_HOT_C} °C or more or the
  air humidity is {PUMP_DRY_AIR_PCT} % or less. After each watering it waits {PUMP_COOLDOWN_S} s, then waters
  again if the soil is still that dry. Pump activity itself is not logged.
- An ESP32 measures air temperature, air humidity and ambient light, and uploads all readings.
- light_bright = 0 means it is dark; then the firmware switches on a grow LED (led_on = 1).
- reservoir_ok = 0 means the water reservoir feeding the pump is low: the pump cannot water the
  plant until the owner refills it.
- faults lists error codes reported by the device, if any: DHT11_UNAVAILABLE (no temperature/humidity),
  LIGHT_SENSOR_UNAVAILABLE, MCXC444_UNAVAILABLE (no recent soil/reservoir/LED status from the
  microcontroller).
- test_data = 1 marks a row inserted while testing the system (by hand or by the ESP32's demo
  mode): its values are made up, not measurements of the plant.
{AI_RULES}"""


AI_STATUSES = {"good", "attention", "urgent"}
AI_PRIORITIES = {"info", "warning", "urgent"}


def valid_report(result) -> dict | None:
    """The model's report in exactly the shape AI_RULES asks for (extra keys dropped), or None."""
    if not isinstance(result, dict):
        return None
    status, headline = result.get("status"), result.get("headline")
    summary, advice = result.get("summary"), result.get("advice")
    if (
        status not in AI_STATUSES
        or not isinstance(headline, str)
        or not isinstance(summary, list)
        or not all(isinstance(s, str) for s in summary)
        or not isinstance(advice, list)
        or not all(
            isinstance(a, dict) and a.get("priority") in AI_PRIORITIES and isinstance(a.get("text"), str)
            for a in advice
        )
    ):
        return None
    return {
        "status": status,
        "headline": headline,
        "summary": summary,
        "advice": [{"priority": a["priority"], "text": a["text"]} for a in advice],
    }


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
        f"- test readings (made up, not real measurements): {count('test_data', True)} of {len(rows)}",
        "",
        "Readings, oldest first (CSV):",
        "time,soil_raw,moisture_pct,temp_c,humidity_pct,light_bright,led_on,reservoir_ok,faults,test_data",
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
            flag(r.get("test_data")),
        ]))
    return "\n".join(lines)


async def generate_insights(
    hours: float = 1,
    include_test: bool = True,
    tz_offset_min: int = 0,  # the browser's offset from UTC, e.g. 480 for UTC+8
    soil_dry_raw: int = 1900,
    soil_wet_raw: int = 500,
):
    """Ask DeepSeek for a short summary of, and advice on, the readings from the last `hours`."""
    global _last_ai_call
    if not DEEPSEEK_KEY:
        raise HTTPException(503, "DEEPSEEK_API_KEY is not set on the server")
    wait = AI_COOLDOWN_S - (time.time() - _last_ai_call)
    if wait > 0:
        raise HTTPException(429, f"Please wait {wait:.0f} s before asking again")
    _last_ai_call = time.time()

    rows = await fetch_readings(hours=hours, after_id=None, device_id=None, include_test=include_test)
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
        result = valid_report(json.loads(content))
    except ValueError:
        result = None
    if result is None:
        result = {"raw": content}  # not the shape we asked for: the frontend shows it as plain text
    return result | {
        "model": data.get("model", DEEPSEEK_MODEL),
        "readings": len(rows),
        "tokens": data.get("usage", {}).get("total_tokens"),
    }
