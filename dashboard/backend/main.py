"""JupiterPluvius backend.

A thin read-only layer between the dashboard and Supabase:
  - signs in to Supabase as the "backend" user (who has SELECT permission via RLS)
  - exposes two JSON endpoints the frontend polls
  - offers an "AI check-up" that asks DeepSeek to summarise recent readings
  - serves the built React frontend from ../frontend/dist (`npm run build` creates it)

The ESP32 writes to Supabase directly; this server never writes anything.
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from config import FRONTEND_DIR
from insights import deepseek, generate_insights
from readings import fetch_latest, fetch_readings, supabase

app = FastAPI(title="JupiterPluvius API")
# Allows the frontend to be hosted elsewhere (e.g. a Render Static Site) too.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
# Compress responses: the 3D chunk shrinks from ~790 kB to ~240 kB, 1000 readings to ~30 kB.
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def cache_headers(request, call_next):
    """Tell browsers how long they may reuse the page files.

    The build puts a hash of each file's content in its name (assets/index-3f9a1c.js), so a file
    under /assets/ never changes and can be cached for good. index.html must be re-checked on every
    load (a cheap 304 if unchanged), so a redeploy is picked up right away.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/latest")
async def latest(device_id: str | None = None, include_test: bool = True):
    """The most recent reading, or null if the table is empty."""
    return await fetch_latest(device_id=device_id, include_test=include_test)


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
    return await fetch_readings(
        hours=hours, after_id=after_id, device_id=device_id, include_test=include_test
    )


@app.post("/api/insights")
async def insights(
    hours: float = Query(1, gt=0, le=24),
    include_test: bool = True,
    tz_offset_min: int = Query(0, ge=-720, le=840),  # the browser's offset from UTC, e.g. 480 for UTC+8
    soil_dry_raw: int = 1900,
    soil_wet_raw: int = 500,
):
    """Ask DeepSeek for a short summary of, and advice on, the readings from the last `hours`."""
    return await generate_insights(
        hours=hours,
        include_test=include_test,
        tz_offset_min=tz_offset_min,
        soil_dry_raw=soil_dry_raw,
        soil_wet_raw=soil_wet_raw,
    )


@app.on_event("shutdown")
async def close_client():
    await supabase.aclose()
    await deepseek.aclose()


# Mounted last so /api/* routes take priority. html=True serves index.html at "/".
# (No dist folder yet? Run `npm run build` in ../frontend, or use `npm run dev` while developing.)
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
