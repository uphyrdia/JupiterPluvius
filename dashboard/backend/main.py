"""AquaWatch backend.

A thin read-only layer between the dashboard and Supabase:
  - signs in to Supabase as the "backend" user (who has SELECT permission via RLS)
  - exposes two JSON endpoints the frontend polls
  - serves the static frontend from ../frontend

The ESP32 writes to Supabase directly; this server never writes anything.
"""

import os
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

PAGE_SIZE = 1000   # Supabase's default max rows per request
MAX_PAGES = 50     # hard cap: never pull more than 50k rows for one request

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="AquaWatch API")
# Allows the frontend to be hosted elsewhere (e.g. a Render Static Site) too.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

# an HTTP client to fetch data from Supabase
supabase = httpx.AsyncClient(base_url=SUPABASE_URL, headers={"apikey": SUPABASE_KEY}, timeout=15)
_token = {"value": None, "expires_at": 0.0}


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
    hours: float = Query(1, gt=0, le=24 * 31),
    after_id: int | None = None,
    device_id: str | None = None,
    include_test: bool = True,
    max_points: int = Query(1500, ge=10, le=10000),
):
    """Readings from the last `hours`, oldest first.

    `after_id` returns only rows newer than that id (used by the frontend's polling).
    Long ranges are evenly thinned to at most `max_points` rows so the browser stays fast.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    params = base_filters(device_id, include_test) | {
        "created_at": f"gte.{since.isoformat()}",
        "order": "id.asc",
        "limit": str(PAGE_SIZE),
    }
    if after_id is not None:
        params["id"] = f"gt.{after_id}"

    rows: list[dict] = []
    for page in range(MAX_PAGES):
        batch = await select_readings(params | {"offset": str(page * PAGE_SIZE)})
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break

    if len(rows) > max_points:
        step = len(rows) / max_points
        thinned = [rows[int(i * step)] for i in range(max_points)]
        thinned[-1] = rows[-1]  # always keep the newest reading
        rows = thinned
    return rows


@app.on_event("shutdown")
async def close_client():
    await supabase.aclose()


# Mounted last so /api/* routes take priority. html=True serves index.html at "/".
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
