"""Supabase authentication and reading retrieval, shared by the API and AI check-up."""

import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

from config import BACKEND_EMAIL, BACKEND_PASSWORD, MAX_PAGES, MAX_ROWS, SUPABASE_KEY, SUPABASE_URL

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


async def fetch_latest(device_id: str | None = None, include_test: bool = True):
    """The most recent reading, or null if the table is empty."""
    params = base_filters(device_id, include_test) | {"order": "id.desc", "limit": "1"}
    rows = await select_readings(params)
    return rows[0] if rows else None


async def fetch_recent(
    hours: float = 1,
    limit: int = 20,
    device_id: str | None = None,
    include_test: bool = True,
):
    """The newest `limit` readings from the last `hours`, oldest first (one request, never thinned)."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    params = base_filters(device_id, include_test) | {
        "created_at": f"gte.{since.isoformat()}",
        "order": "id.desc",
        "limit": str(limit),
    }
    rows = await select_readings(params)
    rows.reverse()
    return rows


async def fetch_readings(
    hours: float = 1,
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
