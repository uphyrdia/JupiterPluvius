from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    database: Path = ROOT / "data" / "greenhouse.sqlite3"
    api_key: str = ""
    base_url: str = "https://soclaas-api.comp.nus.edu.sg/v1"
    model: str = "default"
    simulator_enabled: bool = True
    stale_seconds: int = 30
    cooldown_seconds: int = 60
    recommendation_seconds: int = 900

    @classmethod
    def from_environment(cls):
        requested = os.environ.get("SOCLAAS_ENV_FILE")
        default = Path(r"C:\wjw\soclaas.env")
        env_file = Path(requested) if requested else default if default.is_file() else ROOT / ".env"
        values = dotenv_values(env_file) if env_file.is_file() else {}
        def read(name, fallback=""):
            return os.environ.get(name, values.get(name) or fallback)
        return cls(
            database=Path(os.environ.get("GREENHOUSE_DB_PATH", str(ROOT / "data" / "greenhouse.sqlite3"))),
            api_key=read("SOCLAAS_API_KEY"),
            base_url=read("SOCLAAS_BASE_URL", "https://soclaas-api.comp.nus.edu.sg/v1").rstrip("/"),
            model=read("SOCLAAS_MODEL", "default"),
            simulator_enabled=os.environ.get("GREENHOUSE_SIMULATOR", "1") != "0",
        )

    def ai_ready(self):
        try:
            url = urlsplit(self.base_url)
            return bool(self.api_key and self.model and url.scheme == "https"
                        and url.hostname == "soclaas-api.comp.nus.edu.sg"
                        and url.port in (None, 443) and not url.username
                        and not url.password and not url.query and not url.fragment
                        and url.path.rstrip("/") in ("", "/v1"))
        except ValueError:
            return False

    def endpoint(self):
        return self.base_url.rstrip("/") + ("/chat/completions" if urlsplit(self.base_url).path.rstrip("/") == "/v1" else "/v1/chat/completions")
