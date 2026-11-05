# JupiterPluvius dashboard

```
MCXC444 --UART--> ESP32 --HTTPS insert--> Supabase (readings table)
                                              ^
                                              | read (backend user, RLS)
Browser <--polls every 5 s-- FastAPI backend --+
        (React app, built into frontend/dist and served by the same backend)
                                  |
                                  +-- "Run analysis" button --> DeepSeek API
```

- `backend/main.py`: FastAPI. Signs in to Supabase as the read-only backend user, caches the token, and exposes:
  - `GET /api/latest`: newest reading (or `null`)
  - `GET /api/readings?hours=1&after_id=123&include_test=true`: readings in the window (at most 24 h), oldest first. If the window holds more than 1000 readings, they are evenly thinned to 1000. As a safeguard it reads at most the newest 20,000 rows, so if the ESP32 uploads far too often, the oldest part of the window is left out.
  - `POST /api/insights?hours=24&tz_offset_min=480`: the "AI check-up". It sends the same (up to 1000) readings as CSV, plus a description of the device and some precomputed statistics, to DeepSeek (`deepseek-flash`, low reasoning effort). It returns JSON: `status` (good / attention / urgent), `headline`, `summary` points and `advice` items. It allows at most one call per 15 s, so repeated clicks can't drain the API balance. A 24 h analysis takes about 10–15 s and about 30k tokens.
  - `GET /api/health`
  - `/`: serves the built frontend (`frontend/dist`). Files under `/assets/` have a content hash in their name and are cached for a year; `index.html` is re-checked on every load, so a redeploy shows up right away. Responses are gzip-compressed.
- `frontend/`: a React + TypeScript app built with Vite (see [The frontend](#the-frontend) below).

## Supabase prerequisites

1. Run `sql_1.txt`, `sql_2.txt` and **`sql_3.txt`** in the Supabase SQL editor. Without `sql_3.txt`, the backend
   gets `permission denied for table readings`.
2. Check that the UUID in `sql_3.txt` is the UUID of the backend user (`Authentication → Users`).

## Run locally

You need **Python 3.10+** and **Node.js 20.19+** (any current LTS, e.g. 24; get it from https://nodejs.org).

**Backend** (terminal 1):

```bash
cd dashboard/backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then fill in the values (already done on this machine)
uvicorn main:app --reload --port 8000
```

**Frontend** (terminal 2), while you're working on it:

```bash
cd dashboard/frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite serves the app with instant reload on every save and forwards `/api/*` to the
backend on port 8000 (see `vite.config.ts`).

To try the production build instead, run `npm run build` (it writes `frontend/dist`) and open http://localhost:8000:
the backend serves the build itself, exactly as on Render.

Other scripts: `npm run typecheck` runs the TypeScript compiler over the code (the build itself doesn't type-check),
and `npm run preview` serves `dist` on its own.

## Deploy on Render (free tier)

One Render **Web Service** builds the frontend, runs the backend and serves both. Because the page and the API share one
origin, you don't need any CORS or URL configuration.

1. **Push the project to GitHub.** `.gitignore` keeps `backend/.env` (your password), `node_modules` and `dist` out of
   the repo. Check that they aren't committed.
2. In Render: **New → Web Service → connect the GitHub repo** (or open your existing service's **Settings**).
3. Settings:
   | Field | Value |
   |---|---|
   | Root Directory | `dashboard` (the path of this folder inside the repo) |
   | Runtime | Python 3 |
   | Build Command | `pip install -r backend/requirements.txt && npm ci --prefix frontend --include=dev && npm run build --prefix frontend` |
   | Start Command | `uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT` |
   | Instance Type | Free |
   | Health Check Path (Advanced) | `/api/health` |

   Render's Python runtime includes Node.js and npm, so the build command can build the React app. If you already
   have the service, only the **Build Command** changes.
4. **Environment variables** (Environment tab):
   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://swdnnvrihfaetgvsxaht.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key |
   | `BACKEND_EMAIL` | backend user's email |
   | `BACKEND_PASSWORD` | backend user's password |
   | `DEEPSEEK_API_KEY` | DeepSeek API key (optional; without it, only the AI check-up fails) |
   | `PYTHON_VERSION` | `3.11.9` (optional, pins Python) |
   | `NODE_VERSION` | `24` (optional, pins Node.js for the frontend build) |
5. Click **Deploy**. When the deploy finishes, open `https://<your-service>.onrender.com`. `/api/health` should return `{"ok": true}`.

Every push to the branch redeploys automatically.

**Free-tier note:** the service sleeps after about 15 minutes without visitors, and the next visit takes about 30 to 60 s to wake it.
Meanwhile the top bar says "Connecting". No data is lost, because the ESP32 writes to Supabase directly and doesn't go through Render.

### Optional: frontend as a separate Static Site

If you'd rather host the frontend separately (Render **Static Site**, root directory `dashboard/frontend`, build command
`npm ci && npm run build`, publish directory `dist`), add an environment variable `VITE_API_BASE` with the backend URL,
for example `https://jupiterpluvius-api.onrender.com`. Vite bakes it into the build (see `src/config.ts`). The backend
already allows cross-origin requests.

## The frontend

Four full-screen pages, all in the same paper-and-ink colours. **Overview** shows the live readings around a 3D
infinity sign whose colour shows the soil moisture, plus two black windows: the soil moisture window (left) opens
**Trends** (charts) and the AI check-up window (top right) opens **Analysis**. Scrolling only moves between the overview and **Log** (states
over time, recent readings): the page first creeps and resists, and past a threshold it jumps. Every move plays the same
glitch transition. On Trends and Analysis, Esc, the "Overview" button or scrolling up goes back. Arrow keys, Page Up/Down,
Space and Home/End also work, as do swipes on a phone.

| Library | Used for |
|---|---|
| [React](https://react.dev) 19 | components and state |
| [TypeScript](https://www.typescriptlang.org) | types for the data and props |
| [Vite](https://vite.dev) | dev server and production build |
| [Motion](https://motion.dev) | the view position as an animated value, and the page transitions |
| [three.js](https://threejs.org) + [React Three Fiber](https://r3f.docs.pmnd.rs) | the 3D ribbon (WebGL) |
| [d3-scale / d3-shape](https://d3js.org) | chart maths; the charts themselves are plain SVG |
| [Fontsource](https://fontsource.org) | Montserrat and JetBrains Mono, served with the app |

Where to start reading:

```
src/
  main.tsx              entry point: loads fonts and styles, renders <App/>
  App.tsx               wires everything: filters, data hooks, the pager, the four pages
  config.ts             settings: calibration (SOIL_DRY_RAW / SOIL_WET_RAW), poll rate, pages (and which open from where)
  hooks/
    useTelemetry.ts     loads readings, then polls /api/latest and fetches only new rows
    useAiCheckup.ts     the AI check-up request and its idle/running/done/error states
    usePager.ts         wheel/touch/keyboard/clicks -> the "resist, then jump" page navigation
  pages/                Overview, Trends, Analysis, Log
  charts/               LineChart (SVG + d3), StatesTimeline, ReadingsTable
  components/           Chrome (top bar, rail, bottom bar), Backdrop, GlitchBurst, PageFrame, ...
  scene/                the 3D ribbon on the overview: poses.ts (where it sits), Ribbon.tsx, ribbonShader.ts
  lib/                  API client and types, formatting, moisture maths, status labels
  styles/               base.css (tokens, layers), chrome.css, pages.css
```

The ribbon only appears on the overview. When you leave the page, it drifts up and fades out with it, and the 3D scene
stops rendering until you come back. It is one box shape drawn about 460 times with a custom shader (one draw call).
Each slat works out its own place on the curve, so the band can breathe and twist. Its colour goes from white-ish blue
(dry) to deep ultramarine (wet).

While `npm run dev` is running, a few URL parameters help with design work (they don't exist in the production build):
`?m=0.2` pretends the soil moisture is 20 %, `?p=0.5#trends` freezes the view halfway from the overview to the page in
the hash, and `?still` skips fade-ins.
