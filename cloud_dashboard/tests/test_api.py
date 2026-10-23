import asyncio
import json
import time

from fastapi.testclient import TestClient
import httpx
import pytest

from backend.app import create_app
from backend.config import Settings


class Clock:
    def __init__(self):
        self.now = time.time()
    def __call__(self):
        return self.now
    def advance(self, seconds):
        self.now += seconds


def sample(device="home-esp32", sequence=1, **changes):
    return {"schema_version": 1, "device_id": device, "boot_id": "boot-one", "sequence": sequence,
            "temperature_c": 29.5, "humidity_percent": 65, "soil_moisture_index": 40,
            "light_index": 35, "reservoir_state": "OK", "watering_active": False,
            "led_brightness": 160, "active_profile": "NORMAL", "faults": [], "sample_age_ms": 0, **changes}


def advice(profile="NORMAL", code="NONE", reason="Limited history; use the tested default profile."):
    return {"care_profile": profile, "advisory_code": code, "reason": reason}


def success(request):
    assert request.url.host == "soclaas-api.comp.nus.edu.sg"
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(advice())}}]})


def make_app(tmp_path, handler=success, clock=None, simulator=False, **changes):
    settings = Settings(**{"database":tmp_path / "test.sqlite3", "api_key":"test-secret-not-a-real-key", "simulator_enabled":simulator, **changes})
    return create_app(settings, transport=httpx.MockTransport(handler), clock=clock or Clock())


def wait_done(client, device="home-esp32"):
    for _ in range(100):
        result = client.get(f"/api/v1/devices/{device}/dashboard").json()
        if result["ai"]["analysis"] and result["ai"]["analysis"]["status"] != "RUNNING":
            return result
        time.sleep(.01)
    raise AssertionError("Mock analysis did not finish")


def analyze(client, device="home-esp32"):
    assert client.post(f"/api/v1/devices/{device}/analyze").status_code == 202
    return wait_done(client, device)


def test_telemetry_persistence_and_duplicate_identity(tmp_path):
    clock = Clock()
    with TestClient(make_app(tmp_path, clock=clock)) as client:
        assert client.post("/api/v1/telemetry", json=sample()).json()["duplicate"] is False
        assert client.post("/api/v1/telemetry", json=sample()).json()["duplicate"] is True
        assert client.post("/api/v1/telemetry", json=sample(temperature_c=31)).status_code == 409
        assert client.post("/api/v1/telemetry", json=sample(sequence=0)).status_code == 409
        assert client.post("/api/v1/telemetry", json=sample(sequence=0, boot_id="boot-two")).status_code == 200
        assert client.post("/api/v1/telemetry", json=sample(sequence=2)).status_code == 409
    with TestClient(make_app(tmp_path, clock=clock)) as client:
        assert client.get("/api/v1/devices/home-esp32/dashboard").json()["telemetry"]["boot_id"] == "boot-two"
        assert len(client.get("/api/v1/devices/home-esp32/history").json()["samples"]) >= 1


@pytest.mark.parametrize("changes", [
    {"humidity_percent": 101}, {"soil_moisture_index": -1}, {"light_index": 101},
    {"soil_adc_raw": 4096}, {"led_brightness": 256}, {"sequence": -1},
    {"sample_age_ms": -1}, {"temperature_c": "29"}, {"watering_active": "false"},
    {"device_id": "../wrong"}, {"schema_version": 2}, {"schema_version": True}, {"unexpected": "field"},
])
def test_invalid_telemetry(tmp_path, changes):
    with TestClient(make_app(tmp_path)) as client:
        assert client.post("/api/v1/telemetry", json=sample(**changes)).status_code == 422


def test_raw_and_missing_values_are_preserved(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        client.post("/api/v1/telemetry", json=sample(soil_moisture_index=None, soil_adc_raw=2950, light_index=None, light_adc_raw=3800, temperature_c=None, watering_active=None))
        d = client.get("/api/v1/devices/home-esp32/dashboard").json()["telemetry"]
        assert d["soil_moisture_index"] is None and d["soil_adc_raw"] == 2950
        assert d["light_index"] is None and d["temperature_c"] is None and d["watering_active"] is None


def test_freshness_includes_sensor_age(tmp_path):
    clock=Clock()
    with TestClient(make_app(tmp_path, clock=clock)) as client:
        client.post("/api/v1/telemetry", json=sample(sample_age_ms=31000))
        assert client.get("/api/v1/devices/home-esp32/dashboard").json()["fresh"] is False
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code == 409
        client.post("/api/v1/telemetry", json=sample(sequence=2))
        assert client.get("/api/v1/devices/home-esp32/dashboard").json()["fresh"] is True
        clock.advance(31)
        assert client.get("/api/v1/devices/home-esp32/dashboard").json()["fresh"] is False


def test_valid_advice_delivery_and_expiry(tmp_path):
    clock=Clock()
    with TestClient(make_app(tmp_path, clock=clock)) as client:
        client.post("/api/v1/telemetry", json=sample())
        result=analyze(client)
        assert result["ai"]["analysis"]["status"] == "SUCCEEDED"
        rec=client.get("/api/v1/devices/home-esp32/recommendation").json()
        assert rec["profile"] == "NORMAL" and 899 <= rec["ttl_seconds"] <= 900
        assert "reason" not in rec
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code == 429
        clock.advance(31)
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 204
        client.post("/api/v1/telemetry", json=sample(sequence=2))
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 200
        clock.advance(870)
        client.post("/api/v1/telemetry", json=sample(sequence=3))
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 204


@pytest.mark.parametrize("changes", [{"reservoir_state": "LOW"}, {"reservoir_state": "UNKNOWN"}, {"faults": ["SENSOR_FAULT"]}, {"soil_moisture_index": None}])
def test_unsafe_profiles_withheld_but_advice_visible(tmp_path, changes):
    with TestClient(make_app(tmp_path)) as client:
        client.post("/api/v1/telemetry", json=sample(**changes))
        result=analyze(client)
        assert result["ai"]["recommendation"]
        assert result["delivery"]["available"] is False
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 204


@pytest.mark.parametrize("code", ["REFILL_RESERVOIR", "CHECK_SENSOR", "CHECK_WATER_DELIVERY"])
def test_safety_advisory_withholds_delivery(tmp_path, code):
    def handler(request):
        return httpx.Response(200,json={"choices":[{"message":{"content":json.dumps(advice(code=code))}}]})
    with TestClient(make_app(tmp_path, handler)) as client:
        client.post("/api/v1/telemetry", json=sample())
        analyze(client)
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 204


@pytest.mark.parametrize("content", [
    "not json", '```json\n{}\n```', '{"care_profile":"OVERRIDE","advisory_code":"NONE","reason":"x"}',
    json.dumps({**advice(),"reason":"x"*161}), json.dumps({**advice(),"pump_on":True}),
    '{"care_profile":"NORMAL","care_profile":"HIGH_DEMAND","advisory_code":"NONE","reason":"x"}',
    json.dumps({**advice(),"reason":"test-secret-not-a-real-key"}),
])
def test_invalid_ai_response_is_not_published(tmp_path, content):
    def handler(request):
        return httpx.Response(200,json={"choices":[{"message":{"content":content}}]})
    with TestClient(make_app(tmp_path, handler)) as client:
        client.post("/api/v1/telemetry",json=sample())
        result=analyze(client)
        assert result["ai"]["analysis"]["status"] == "FAILED"
        assert result["ai"]["recommendation"] is None
        assert "test-secret-not-a-real-key" not in json.dumps(result)


@pytest.mark.parametrize("status", [401,403,429,500])
def test_service_errors_do_not_expose_body_or_key(tmp_path, status):
    def handler(request):
        return httpx.Response(status,json={"error":"test-secret-not-a-real-key raw confidential response"})
    with TestClient(make_app(tmp_path,handler)) as client:
        client.post("/api/v1/telemetry",json=sample())
        result=analyze(client)
        assert result["ai"]["analysis"]["status"] == "FAILED"
        assert "test-secret-not-a-real-key" not in json.dumps(result)
        assert "confidential" not in json.dumps(result)


def test_timeout_does_not_block_telemetry(tmp_path):
    async def handler(request):
        await asyncio.sleep(.08)
        raise httpx.ReadTimeout("secret error text")
    with TestClient(make_app(tmp_path,handler)) as client:
        client.post("/api/v1/telemetry",json=sample())
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code == 202
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code == 429
        assert client.post("/api/v1/telemetry",json=sample(sequence=2)).status_code == 200
        result=wait_done(client)
        assert "timed out" in result["ai"]["analysis"]["error"]
        assert "secret" not in json.dumps(result)


def test_acknowledgements_are_idempotent_and_device_scoped(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        client.post("/api/v1/telemetry",json=sample())
        client.post("/api/v1/telemetry",json=sample(device="group-esp32"))
        identity=analyze(client)["ai"]["recommendation"]["recommendation_id"]
        ack={"recommendation_id":identity,"result":"APPLIED","origin":"MCXC444","reason":None}
        assert client.post("/api/v1/devices/group-esp32/ack",json=ack).status_code == 409
        assert client.post("/api/v1/devices/home-esp32/ack",json=ack).json()["duplicate"] is False
        assert client.post("/api/v1/devices/home-esp32/ack",json=ack).json()["duplicate"] is True
        assert client.post("/api/v1/devices/home-esp32/ack",json={**ack,"result":"REJECTED"}).status_code == 409
        assert client.post("/api/v1/devices/home-esp32/ack",json={**ack,"origin":"ESP32"}).status_code == 422
        assert client.get("/api/v1/devices/group-esp32/recommendation").status_code == 204


def test_simulator_isolation_and_scenarios(tmp_path):
    clock=Clock()
    app=make_app(tmp_path,clock=clock,simulator=True)
    with TestClient(app) as client:
        assert client.get("/api/v1/devices").json()[0]["simulated"] is True
        assert client.post("/api/v1/telemetry",json=sample(device="demo-greenhouse")).status_code == 409
        client.post("/api/v1/telemetry",json=sample())
        analyze(client,"demo-greenhouse")
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code == 204
        assert client.get("/api/v1/devices/demo-greenhouse/recommendation").status_code == 204
        app.state.runtime.simulation_tick()
        assert client.get("/api/v1/devices/demo-greenhouse/dashboard").json()["ai"]["acknowledgement"]["origin"] == "SIMULATED"
        for scenario, expected in [("LOW_RESERVOIR","LOW"),("NORMAL","OK")]:
            client.post("/api/v1/simulation",json={"scenario":scenario})
            app.state.runtime.simulation_tick()
            assert client.get("/api/v1/devices/demo-greenhouse/dashboard").json()["telemetry"]["reservoir_state"] == expected
        client.post("/api/v1/simulation",json={"scenario":"SENSOR_FAULT"})
        app.state.runtime.simulation_tick()
        assert client.get("/api/v1/devices/demo-greenhouse/dashboard").json()["telemetry"]["soil_moisture_index"] is None
        client.post("/api/v1/simulation",json={"paused":True})
        clock.advance(31)
        app.state.runtime.check_freshness()
        snap=client.get("/api/v1/devices/demo-greenhouse/dashboard").json()
        assert snap["fresh"] is False
        assert any(e["kind"]=="DISCONNECTED" for e in snap["events"])


def test_failed_analysis_does_not_extend_prior_recommendation(tmp_path):
    clock=Clock(); calls=[]
    def handler(request):
        calls.append(request)
        return success(request) if len(calls)==1 else httpx.Response(500)
    with TestClient(make_app(tmp_path,handler,clock)) as client:
        client.post("/api/v1/telemetry",json=sample())
        expiry=analyze(client)["ai"]["recommendation"]["expires_at"]
        clock.advance(61)
        client.post("/api/v1/telemetry",json=sample(sequence=2))
        result=analyze(client)
        assert result["ai"]["analysis"]["status"] == "FAILED"
        assert result["ai"]["recommendation"]["expires_at"] == expiry


def test_summary_reports_actual_history_not_fake_ten_minutes(tmp_path):
    clock=Clock(); bodies=[]
    def handler(request):
        bodies.append(json.loads(request.content))
        return success(request)
    with TestClient(make_app(tmp_path,handler,clock)) as client:
        client.post("/api/v1/telemetry",json=sample())
        clock.advance(5)
        client.post("/api/v1/telemetry",json=sample(sequence=2,soil_moisture_index=35))
        analyze(client)
        summary=json.loads(bodies[0]["messages"][1]["content"])
        assert summary["sample_count"]==2 and summary["observed_window_seconds"]==5
        assert summary["trends"]["soil_moisture_index"]["change"]==-5


def test_dashboard_assets_and_unconfigured_ai(tmp_path):
    with TestClient(make_app(tmp_path,api_key="")) as client:
        assert client.get("/").status_code==200
        assert client.get("/static/styles.css").status_code==200
        assert client.get("/static/app.js").status_code==200
        client.post("/api/v1/telemetry",json=sample())
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code==503
        assert client.get("/api/v1/devices/home-esp32/history?range=wrong").status_code==422
        assert client.get("/api/v1/devices/unknown/dashboard").status_code==404


def test_empty_missing_readings_and_zero_are_distinct(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        client.post("/api/v1/telemetry",json={"schema_version":1,"device_id":"empty-board","boot_id":"start","sequence":0,"sample_age_ms":0})
        empty=client.get("/api/v1/devices/empty-board/dashboard").json()["telemetry"]
        assert empty["temperature_c"] is None and empty["reservoir_state"]=="UNKNOWN"
        client.post("/api/v1/telemetry",json=sample(temperature_c=0,soil_moisture_index=0,led_brightness=0))
        zero=client.get("/api/v1/devices/home-esp32/dashboard").json()["telemetry"]
        assert zero["temperature_c"]==0 and zero["soil_moisture_index"]==0 and zero["led_brightness"]==0


def test_network_error_is_safe(tmp_path):
    def handler(request):
        raise httpx.ConnectError("test-secret-not-a-real-key provider details")
    with TestClient(make_app(tmp_path,handler)) as client:
        client.post("/api/v1/telemetry",json=sample())
        result=analyze(client)
        assert result["ai"]["analysis"]["status"]=="FAILED"
        assert "provider details" not in json.dumps(result)


def test_oversized_ai_response_is_rejected(tmp_path):
    def handler(request):
        return httpx.Response(200,content=b"x"*262145)
    with TestClient(make_app(tmp_path,handler)) as client:
        client.post("/api/v1/telemetry",json=sample())
        result=analyze(client)
        assert "size" in result["ai"]["analysis"]["error"]
        assert result["ai"]["recommendation"] is None


def test_restart_preserves_advice_and_ack(tmp_path):
    clock=Clock()
    with TestClient(make_app(tmp_path,clock=clock)) as client:
        client.post("/api/v1/telemetry",json=sample())
        rec=analyze(client)["ai"]["recommendation"]
        assert client.post("/api/v1/devices/home-esp32/ack",json={"recommendation_id":rec["recommendation_id"],"origin":"MCXC444","result":"REJECTED","reason":"Local limit"}).status_code==200
    with TestClient(make_app(tmp_path,clock=clock)) as client:
        state=client.get("/api/v1/devices/home-esp32/dashboard").json()["ai"]
        assert state["recommendation"]["recommendation_id"]==rec["recommendation_id"]
        assert state["acknowledgement"]["result"]=="REJECTED"
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code==204


def test_history_ranges_are_device_scoped(tmp_path):
    clock=Clock()
    with TestClient(make_app(tmp_path,clock=clock)) as client:
        client.post("/api/v1/telemetry",json=sample())
        clock.advance(601)
        client.post("/api/v1/telemetry",json=sample(sequence=2))
        client.post("/api/v1/telemetry",json=sample(device="group-esp32"))
        ten=client.get("/api/v1/devices/home-esp32/history?range=10m").json()["samples"]
        hour=client.get("/api/v1/devices/home-esp32/history?range=1h").json()["samples"]
        assert len(ten)==1 and len(hour)==2
        assert all(s["device_id"]=="home-esp32" for s in hour)


def test_untrusted_service_url_never_gets_credentials(tmp_path):
    def handler(request):
        pytest.fail("No HTTP request should be sent")
    with TestClient(make_app(tmp_path,handler,base_url="https://other-host.example/v1")) as client:
        client.post("/api/v1/telemetry",json=sample())
        assert client.post("/api/v1/devices/home-esp32/analyze").status_code==503


def test_test_board_is_marked_and_receipt_is_not_application(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        client.post("/api/v1/telemetry",json=sample(test_data=True,watering_active=None,led_brightness=None,active_profile=None))
        result=analyze(client)
        assert result["telemetry"]["test_data"] is True
        assert result["ai"]["acknowledgement"] is None
        assert client.get("/api/v1/devices/home-esp32/recommendation").status_code==200


def test_simulator_reverts_after_advice_expiry(tmp_path):
    clock=Clock()
    def handler(request):
        return httpx.Response(200,json={"choices":[{"message":{"content":json.dumps(advice("CONSERVATIVE"))}}]})
    app=make_app(tmp_path,handler,clock,simulator=True)
    with TestClient(app) as client:
        analyze(client,"demo-greenhouse")
        app.state.runtime.simulation_tick()
        assert app.state.runtime.simulated_profile=="CONSERVATIVE"
        clock.advance(901)
        app.state.runtime.simulation_tick()
        assert app.state.runtime.simulated_profile=="NORMAL"
