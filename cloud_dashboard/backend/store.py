from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from threading import RLock
import uuid


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z") if value is not None else None


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, simulated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
                boot_id TEXT NOT NULL, sequence INTEGER NOT NULL, received REAL NOT NULL,
                sampled REAL NOT NULL, payload TEXT NOT NULL,
                UNIQUE(device_id, boot_id, sequence));
            CREATE INDEX IF NOT EXISTS telemetry_history ON telemetry(device_id, received);
            CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
                started REAL NOT NULL, completed REAL, status TEXT NOT NULL, error TEXT);
            CREATE TABLE IF NOT EXISTS recommendations (
                id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES analyses(id),
                device_id TEXT NOT NULL REFERENCES devices(id), created REAL NOT NULL,
                expires REAL NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS recommendation_device ON recommendations(device_id, created);
            CREATE TABLE IF NOT EXISTS acknowledgements (
                recommendation_id TEXT PRIMARY KEY REFERENCES recommendations(id),
                device_id TEXT NOT NULL REFERENCES devices(id), created REAL NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
                created REAL NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL);
        """)
        # An interrupted process must not leave an analysis permanently running.
        self.db.execute("UPDATE analyses SET status='FAILED', error='Analysis interrupted by a backend restart.' WHERE status='RUNNING'")
        self.db.commit()

    @contextmanager
    def transaction(self):
        with self.lock, self.db:
            yield self.db

    def close(self):
        with self.lock:
            self.db.close()

    def _latest(self, db, device_id):
        return db.execute("SELECT * FROM telemetry WHERE device_id=? ORDER BY id DESC LIMIT 1", (device_id,)).fetchone()

    def _event(self, db, device, now, kind, message):
        db.execute("INSERT INTO events(device_id,created,kind,message) VALUES(?,?,?,?)", (device, now, kind, message))

    def event(self, device, now, kind, message):
        with self.transaction() as db:
            self._event(db, device, now, kind, message)

    def ingest(self, sample, now, simulated=False):
        payload = sample.model_dump()
        encoded = json.dumps(payload, sort_keys=True, allow_nan=False)
        device = sample.device_id
        with self.transaction() as db:
            db.execute("INSERT OR IGNORE INTO devices VALUES(?,?)", (device, int(simulated)))
            identity = db.execute("SELECT simulated FROM devices WHERE id=?", (device,)).fetchone()
            if bool(identity[0]) != simulated:
                raise ValueError("Device source cannot change between simulated and live.")
            duplicate = db.execute("SELECT payload FROM telemetry WHERE device_id=? AND boot_id=? AND sequence=?", (device, sample.boot_id, sample.sequence)).fetchone()
            if duplicate:
                if duplicate[0] != encoded:
                    raise ValueError("This packet identity already has different readings.")
                return False
            previous = self._latest(db, device)
            if previous:
                if previous["boot_id"] == sample.boot_id and sample.sequence <= previous["sequence"]:
                    raise ValueError("Sequence must increase within a boot session.")
                if previous["boot_id"] != sample.boot_id and db.execute("SELECT 1 FROM telemetry WHERE device_id=? AND boot_id=? LIMIT 1", (device, sample.boot_id)).fetchone():
                    raise ValueError("Packet belongs to a superseded boot session.")
            db.execute("INSERT INTO telemetry(device_id,boot_id,sequence,received,sampled,payload) VALUES(?,?,?,?,?,?)", (device, sample.boot_id, sample.sequence, now, now - sample.sample_age_ms / 1000, encoded))
            old = json.loads(previous["payload"]) if previous else {}
            if not previous:
                self._event(db, device, now, "CONNECTED", "Simulated device started." if simulated else "Device connected.")
            if payload["watering_active"] is not None and payload["watering_active"] != old.get("watering_active"):
                self._event(db, device, now, "WATERING", "Watering active." if payload["watering_active"] else "Watering stopped.")
            if payload["reservoir_state"] != old.get("reservoir_state"):
                self._event(db, device, now, "RESERVOIR", "Reservoir: " + payload["reservoir_state"].lower() + ".")
            if payload["faults"] != old.get("faults", []):
                self._event(db, device, now, "FAULT", "Sensor/device faults reported." if payload["faults"] else "Reported faults cleared.")
            return True

    def snapshot(self, device, now, stale_seconds):
        with self.lock:
            identity = self.db.execute("SELECT * FROM devices WHERE id=?", (device,)).fetchone()
            if not identity:
                return None
            row = self._latest(self.db, device)
            age = max(0, now - row["sampled"]) if row else None
            return {
                "device_id": device, "simulated": bool(identity["simulated"]),
                "fresh": age is not None and age <= stale_seconds,
                "age_seconds": round(age, 1) if age is not None else None,
                "received_at": iso(row["received"]) if row else None,
                "sampled_at": iso(row["sampled"]) if row else None,
                "telemetry": json.loads(row["payload"]) if row else None,
            }

    def devices(self, now, stale_seconds):
        with self.lock:
            names = [row[0] for row in self.db.execute("SELECT id FROM devices ORDER BY simulated DESC,id")]
        return [self.snapshot(name, now, stale_seconds) for name in names]

    def history(self, device, since, now, limit=1200):
        with self.lock:
            # Bucket long ranges so charts stay bounded without dropping old history.
            rows = self.db.execute("""SELECT * FROM telemetry WHERE device_id=? AND received>=?
                AND id IN (SELECT MAX(id) FROM telemetry WHERE device_id=? AND received>=?
                GROUP BY CAST((received-?)/? AS INTEGER)) ORDER BY received LIMIT ?""",
                (device, since, device, since, since, max(1, (now - since) / limit), limit)).fetchall()
            return [{"received_at": iso(row["received"]), "sampled_at": iso(row["sampled"]), **json.loads(row["payload"])} for row in rows]

    def recent_samples(self, device, since):
        with self.lock:
            rows = self.db.execute("SELECT sampled,payload FROM telemetry WHERE device_id=? AND sampled>=? ORDER BY sampled LIMIT 10000", (device, since)).fetchall()
            return [(r["sampled"], json.loads(r["payload"])) for r in rows]

    def start_analysis(self, device, now, cooldown):
        with self.transaction() as db:
            previous = db.execute("SELECT * FROM analyses WHERE device_id=? ORDER BY started DESC LIMIT 1", (device,)).fetchone()
            if previous and previous["status"] == "RUNNING":
                raise ValueError("An analysis is already running for this device.")
            if previous and now - previous["started"] < cooldown:
                raise ValueError("Please wait for the 60-second analysis cooldown.")
            identity = str(uuid.uuid4())
            db.execute("INSERT INTO analyses(id,device_id,started,status) VALUES(?,?,?,'RUNNING')", (identity, device, now))
            self._event(db, device, now, "AI", "Care analysis started.")
            return identity

    def finish_analysis(self, identity, now, advice=None, error=None, lifetime=900):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM analyses WHERE id=?", (identity,)).fetchone()
            if not row or row["status"] != "RUNNING":
                return
            db.execute("UPDATE analyses SET completed=?,status=?,error=? WHERE id=?", (now, "SUCCEEDED" if advice else "FAILED", error, identity))
            if advice:
                db.execute("INSERT INTO recommendations VALUES(?,?,?,?,?,?)", (identity, identity, row["device_id"], now, now + lifetime, json.dumps(advice.model_dump())))
            self._event(db, row["device_id"], now, "AI", "Care recommendation ready." if advice else error or "Care analysis failed.")

    def ai_state(self, device, now, cooldown):
        with self.lock:
            attempt = self.db.execute("SELECT * FROM analyses WHERE device_id=? ORDER BY started DESC LIMIT 1", (device,)).fetchone()
            rec = self.db.execute("SELECT * FROM recommendations WHERE device_id=? ORDER BY created DESC LIMIT 1", (device,)).fetchone()
            ack = self.db.execute("SELECT * FROM acknowledgements WHERE recommendation_id=?", (rec["id"],)).fetchone() if rec else None
            return {
                "analysis": {"id": attempt["id"], "status": attempt["status"], "started_at": iso(attempt["started"]), "error": attempt["error"]} if attempt else None,
                "cooldown_seconds": max(0, int(cooldown - (now - attempt["started"]) + 0.999)) if attempt else 0,
                "recommendation": {"recommendation_id": rec["id"], "created_at": iso(rec["created"]), "expires_at": iso(rec["expires"]), "expired": rec["expires"] <= now, **json.loads(rec["payload"])} if rec else None,
                "acknowledgement": {"created_at": iso(ack["created"]), **json.loads(ack["payload"])} if ack else None,
            }

    def acknowledge(self, device, identity, payload, now, simulated=False):
        with self.transaction() as db:
            rec = db.execute("SELECT * FROM recommendations WHERE id=? AND device_id=?", (identity, device)).fetchone()
            if not rec:
                raise ValueError("Recommendation does not belong to this device.")
            encoded = json.dumps(payload, sort_keys=True)
            old = db.execute("SELECT payload FROM acknowledgements WHERE recommendation_id=?", (identity,)).fetchone()
            if old:
                if old[0] != encoded:
                    raise ValueError("Recommendation already has a different acknowledgement.")
                return False
            db.execute("INSERT INTO acknowledgements VALUES(?,?,?,?)", (identity, device, now, encoded))
            self._event(db, device, now, "ACK", ("Simulated " if simulated else "MCXC444 ") + payload["result"].lower() + " profile.")
            return True

    def events(self, device):
        with self.lock:
            return [{"id": row["id"], "created_at": iso(row["created"]), "kind": row["kind"], "message": row["message"]} for row in self.db.execute("SELECT * FROM events WHERE device_id=? ORDER BY id DESC LIMIT 30", (device,))]
