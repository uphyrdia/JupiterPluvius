"""Environment settings and shared constants for the dashboard backend."""

import os
from pathlib import Path

from dotenv import load_dotenv

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

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
