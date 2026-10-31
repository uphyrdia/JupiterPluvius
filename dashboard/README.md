# AquaWatch dashboard

```
MCXC444 --UART--> ESP32 --HTTPS insert--> Supabase (readings table)
                                              ^
                                              | read (backend user, RLS)
Browser <--polls every 5 s-- FastAPI backend --+
        (frontend served by the same backend)
```

- `backend/main.py`: FastAPI. Signs in to Supabase as the read-only backend user, caches the token, and exposes:
  - `GET /api/latest`: newest reading (or `null`)
  - `GET /api/readings?hours=1&after_id=123&include_test=true`: readings in the window, oldest first. Long ranges are thinned to ≤ 1500 points.
  - `GET /api/health`
  - `/`: serves `frontend/`
- `frontend/`: plain HTML/CSS/JS, using Chart.js from a CDN. It needs no build step. Calibration constants (`SOIL_DRY_RAW`, `SOIL_WET_RAW`) and the poll rate are at the top of `frontend/app.js`.

## Supabase prerequisites

1. Run `sql_1.txt`, `sql_2.txt` and **`sql_3.txt`** in the Supabase SQL editor. Without `sql_3.txt`, the backend
   gets `permission denied for table readings`.
2. Check that the UUID in `sql_3.txt` is the UUID of the backend user (`Authentication → Users`).

## Run locally

```bash
cd dashboard/backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then fill in the values (already done on this machine)
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000.

## Deploy on Render (free tier)

One Render **Web Service** runs the backend and serves the frontend. Because the page and the API share one origin, you don't need any CORS or URL configuration.

1. **Push the project to GitHub.** `.gitignore` keeps `backend/.env` (your password) out of the repo. Check that it isn't committed.
2. In Render: **New → Web Service → connect the GitHub repo**.
3. Settings:
   | Field | Value |
   |---|---|
   | Root Directory | `dashboard` (the path of this folder inside the repo) |
   | Runtime | Python 3 |
   | Build Command | `pip install -r backend/requirements.txt` |
   | Start Command | `uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT` |
   | Instance Type | Free |
   | Health Check Path (Advanced) | `/api/health` |
4. **Environment variables** (Environment tab):
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://swdnnvrihfaetgvsxaht.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key |
   | `BACKEND_EMAIL` | backend user's email |
   | `BACKEND_PASSWORD` | backend user's password |
   | `PYTHON_VERSION` | `3.11.9` (optional, pins Python) |
5. Click **Deploy**. When the deploy finishes, open `https://<your-service>.onrender.com`. `/api/health` should return `{"ok": true}`.

Every push to the branch redeploys automatically.

**Free-tier note:** the service sleeps after about 15 minutes without visitors, and the next visit takes about 30 to 60 s to wake it.
No data is lost, because the ESP32 writes to Supabase directly and doesn't go through Render.

### Optional: frontend as a separate Static Site

If you'd rather host `frontend/` separately (Render **Static Site**, publish directory `dashboard/frontend`, no build command), set
`API_BASE` at the top of `frontend/app.js` to the backend URL, for example `https://aquawatch-api.onrender.com`. The backend already allows
cross-origin GET requests.
