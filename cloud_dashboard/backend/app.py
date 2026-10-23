import asyncio
from contextlib import asynccontextmanager
import time

from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

from .config import ROOT, Settings
from .models import Acknowledgement, SimulationControl, Telemetry
from .service import Runtime
from .store import Store


def create_app(settings=None, transport=None, clock=time.time):
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app):
        store = Store(settings.database)
        async with httpx.AsyncClient(transport=transport, follow_redirects=False, timeout=45) as client:
            runtime = Runtime(settings, store, client, clock)
            app.state.runtime = runtime
            if settings.simulator_enabled:
                runtime.simulation_tick()
            runtime.spawn(runtime.monitor())
            try:
                yield
            finally:
                tasks = list(runtime.tasks)
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                store.close()

    app = FastAPI(title="Greenhouse API", version="1.0.0", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Omit reflected request bodies and validation context from public errors.
        return JSONResponse(status_code=422, content={"detail": [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]})

    def runtime():
        return app.state.runtime

    def require_device(device):
        snap = runtime().snapshot(device)
        if snap is None:
            raise HTTPException(404, "Device not found.")
        return snap

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(ROOT / "frontend" / "index.html")

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "ai_configured": settings.ai_ready(), "simulator_enabled": settings.simulator_enabled}

    @app.post("/api/v1/telemetry")
    def telemetry(sample: Telemetry):
        if sample.device_id == "demo-greenhouse":
            raise HTTPException(409, "demo-greenhouse is reserved for the simulator. Use your own device_id.")
        try:
            inserted = runtime().ingest(sample)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return {"accepted": True, "duplicate": not inserted, "device_id": sample.device_id}

    @app.get("/api/v1/devices")
    def devices():
        return runtime().store.devices(clock(), settings.stale_seconds)

    @app.get("/api/v1/devices/{device}/dashboard")
    def dashboard(device: str):
        snap = require_device(device)
        state = runtime().store.ai_state(device, clock(), settings.cooldown_seconds)
        deliverable, delivery_reason = runtime().deliverable(device)
        return {**snap, "ai_configured": settings.ai_ready(), "ai": state,
                "delivery": {"available": deliverable is not None, "reason": delivery_reason},
                "events": runtime().store.events(device),
                "simulation": runtime().simulation_state() if snap["simulated"] else None}

    @app.get("/api/v1/devices/{device}/history")
    def history(device: str, range: str = "10m"):
        require_device(device)
        seconds = {"10m": 600, "1h": 3600, "24h": 86400}.get(range)
        if seconds is None:
            raise HTTPException(422, "range must be 10m, 1h, or 24h.")
        now = clock()
        return {"range": range, "samples": runtime().store.history(device, now-seconds, now)}

    @app.post("/api/v1/devices/{device}/analyze", status_code=202)
    async def analyze(device: str):
        snap = require_device(device)
        if not settings.ai_ready():
            raise HTTPException(503, "SoCLaaS is not configured. Load a valid local .env file.")
        if not snap["fresh"]:
            raise HTTPException(409, "Analysis requires fresh readings. Resume the simulator or reconnect the device.")
        summary = runtime().summary(device)
        try:
            identity = runtime().store.start_analysis(device, clock(), settings.cooldown_seconds)
        except ValueError as error:
            raise HTTPException(429, str(error)) from None
        runtime().spawn(runtime().analyze(identity, summary))
        return {"analysis_id": identity, "status": "RUNNING"}

    @app.get("/api/v1/devices/{device}/recommendation")
    def recommendation(device: str):
        snap = require_device(device)
        if snap["simulated"]:
            # Simulator recommendations never leave this process through the device endpoint.
            return Response(status_code=204)
        result, _ = runtime().deliverable(device)
        return result if result else Response(status_code=204)

    @app.post("/api/v1/devices/{device}/ack")
    def acknowledgement(device: str, ack: Acknowledgement):
        snap = require_device(device)
        if snap["simulated"]:
            raise HTTPException(409, "Simulator acknowledgements are generated internally.")
        try:
            inserted = runtime().store.acknowledge(device, ack.recommendation_id, ack.model_dump(), clock())
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return {"accepted": True, "duplicate": not inserted}

    @app.post("/api/v1/simulation")
    def simulation(control: SimulationControl):
        if not settings.simulator_enabled:
            raise HTTPException(409, "Simulator is disabled.")
        if control.scenario is not None:
            runtime().scenario = control.scenario
            runtime().phase = 0
        if control.paused is not None:
            runtime().paused = control.paused
        return runtime().simulation_state()

    return app


app = create_app()
