"""SMARTGUARD backend awal (FastAPI + SQLite).

Mengikuti kontrak di SMARTGUARD_Core v5.1 Bagian 7-8:
- perangkat (ESP32) POST heartbeat / telemetry / events dengan Bearer token per perangkat
- event didedup memakai event_id (retry aman)
- dashboard GET status / location / battery / events, dan acknowledge event
- status offline dihitung dari waktu laporan terakhir, bukan dari isi payload
"""
import hmac
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import Body, Depends, FastAPI, Header, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

BASE = Path(__file__).resolve().parent
DB_PATH = os.environ.get("SMARTGUARD_DB", str(BASE / "smartguard.db"))
INDEX_FILE = BASE.parent / "index.html"  # Backend/ berada di dalam Web/, index.html ada di folder induknya
DEFAULT_INTERVAL_S = 600               # heartbeat normal: 10 menit
ALARM_INTERVAL_S = 30                  # saat alarm aktif, lapor lebih sering
GRACE_S = 300                          # toleransi sebelum dianggap offline


def load_tokens() -> dict:
    # Format env: SMARTGUARD_DEVICE_TOKENS="sg-device-001=tokenrahasia,sg-device-002=token2"
    raw = os.environ.get("SMARTGUARD_DEVICE_TOKENS", "sg-device-001=dev-token-ganti-ini")
    out = {}
    for pair in raw.split(","):
        if "=" in pair:
            dev, tok = pair.split("=", 1)
            out[dev.strip()] = tok.strip()
    return out


TOKENS = load_tokens()


# ---------- util ----------
def fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso() -> str:
    return fmt(datetime.now(timezone.utc))


def parse_ts(s: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except (ValueError, AttributeError):
        return None


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS devices(
            device_id TEXT PRIMARY KEY, last_seen_at TEXT, interval_s INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS status(
            device_id TEXT PRIMARY KEY, reported_at TEXT NOT NULL, received_at TEXT NOT NULL,
            payload TEXT NOT NULL, last_lat REAL, last_lon REAL, last_fix_at TEXT);
        CREATE TABLE IF NOT EXISTS events(
            event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, event_type TEXT NOT NULL,
            severity TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
            payload TEXT NOT NULL, acknowledged_at TEXT);
        CREATE INDEX IF NOT EXISTS idx_events_dev ON events(device_id, occurred_at DESC);
        """)


# ---------- error & respons ----------
class ApiError(Exception):
    def __init__(self, status: int, message: str, headers: Optional[dict] = None):
        self.status, self.message, self.headers = status, message, headers


def envelope(status: int, data=None, error=None, headers=None):
    return JSONResponse({"ok": error is None, "data": data, "error": error},
                        status_code=status, headers=headers)


def ok(data):
    return {"ok": True, "data": data, "error": None}


app = FastAPI(title="SMARTGUARD API", version="0.1")


@app.on_event("startup")
def _startup():
    init_db()


@app.exception_handler(ApiError)
async def _api_error(_, e: ApiError):
    return envelope(e.status, error=e.message, headers=e.headers)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_, e: StarletteHTTPException):
    return envelope(e.status_code, error=str(e.detail))


@app.exception_handler(RequestValidationError)
async def _validation_error(_, e: RequestValidationError):
    msgs = [f"{'.'.join(str(x) for x in err['loc'][1:])}: {err['msg']}" for err in e.errors()[:5]]
    return envelope(400, error="Payload tidak valid — " + "; ".join(msgs))


# ---------- autentikasi perangkat ----------
def device_auth(device_id: str, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "Token perangkat tidak ada")
    expected = TOKENS.get(device_id)
    if expected is None:
        raise ApiError(404, "Device tidak ditemukan")
    if not hmac.compare_digest(authorization[7:], expected):
        raise ApiError(403, "Token perangkat tidak valid")
    return device_id


def known_device(device_id: str):
    if device_id not in TOKENS:
        raise ApiError(404, "Device tidak ditemukan")
    return device_id


# ---------- model payload (Bagian 7) ----------
class Telemetry(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: int
    device_id: str
    reported_at: AwareDatetime
    power: Optional[dict] = None
    security: Optional[dict] = None
    gps: Optional[dict] = None
    motion: Optional[dict] = None
    battery: Optional[dict] = None
    connectivity: Optional[dict] = None
    health: Optional[dict] = None


class Event(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: int
    event_id: str = Field(min_length=1, max_length=100)
    device_id: str
    event_type: Literal["security_alarm", "battery_low", "battery_critical", "device_started",
                        "sensor_fault", "connectivity_restored", "event_queue_overflow"]
    severity: Literal["info", "medium", "high"]
    occurred_at: AwareDatetime
    reason: list[str] = []
    location: Optional[dict] = None
    distance_from_home_m: Optional[float] = None
    battery: Optional[dict] = None


# ---------- helper ----------
def interval_from(reported_at: Optional[str], due_at: Optional[str]) -> Optional[int]:
    a, b = parse_ts(reported_at), parse_ts(due_at)
    if a and b:
        return max(10, min(86400, int((b - a).total_seconds())))
    return None


def touch(con, device_id: str, now: str, interval_s: Optional[int] = None):
    con.execute("INSERT OR IGNORE INTO devices(device_id, last_seen_at, interval_s) VALUES(?,?,?)",
                (device_id, now, DEFAULT_INTERVAL_S))
    con.execute("UPDATE devices SET last_seen_at=?, interval_s=COALESCE(?, interval_s) WHERE device_id=?",
                (now, interval_s, device_id))


def get_payload(con, device_id: str) -> Optional[dict]:
    row = con.execute("SELECT payload FROM status WHERE device_id=?", (device_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def alarm_active(con, device_id: str) -> bool:
    p = get_payload(con, device_id) or {}
    return bool((p.get("security") or {}).get("alarm_active"))


def next_heartbeat(con, device_id: str) -> int:
    return ALARM_INTERVAL_S if alarm_active(con, device_id) else DEFAULT_INTERVAL_S


def notify(event: dict):
    """Titik sambung notifikasi (push/Telegram/email). Hanya dipanggil untuk event BARU."""
    print(f"[NOTIF] {event['severity'].upper()} {event['event_type']} dari {event['device_id']}")


# ---------- endpoint perangkat ----------
@app.post("/api/v1/devices/{device_id}/heartbeat")
def post_heartbeat(device_id: str, body: Optional[dict] = Body(default=None),
                   _=Depends(device_auth)):
    now = now_iso()
    interval = None
    if body:
        interval = interval_from(body.get("reported_at"),
                                 (body.get("power") or {}).get("next_heartbeat_due_at"))
    with db() as con:
        touch(con, device_id, now, interval)
        nxt = next_heartbeat(con, device_id)
    return ok({"device_id": device_id, "received_at": now, "next_heartbeat_seconds": nxt})


@app.post("/api/v1/devices/{device_id}/telemetry")
def post_telemetry(device_id: str, body: Telemetry, _=Depends(device_auth)):
    if body.device_id != device_id:
        raise ApiError(400, "device_id pada body tidak sama dengan URL")
    soc = (body.battery or {}).get("soc_percent")
    if soc is not None and not (isinstance(soc, (int, float)) and 0 <= soc <= 100):
        raise ApiError(400, "battery.soc_percent harus 0-100")

    now, reported = now_iso(), fmt(body.reported_at)
    payload = body.model_dump(mode="json")
    gps = body.gps or {}
    lat, lon = gps.get("latitude"), gps.get("longitude")
    has_fix = gps.get("fix") is True and lat is not None and lon is not None
    interval = interval_from(reported, (body.power or {}).get("next_heartbeat_due_at"))

    with db() as con:
        old = con.execute("SELECT last_lat,last_lon,last_fix_at FROM status WHERE device_id=?",
                          (device_id,)).fetchone()
        if has_fix:
            ll = (lat, lon, gps.get("updated_at") or reported)
        elif old:
            ll = (old["last_lat"], old["last_lon"], old["last_fix_at"])
        else:
            ll = (None, None, None)
        # laporan lama yang telat datang tidak menimpa status yang lebih baru
        con.execute("""INSERT INTO status(device_id,reported_at,received_at,payload,last_lat,last_lon,last_fix_at)
                       VALUES(?,?,?,?,?,?,?)
                       ON CONFLICT(device_id) DO UPDATE SET reported_at=excluded.reported_at,
                         received_at=excluded.received_at, payload=excluded.payload,
                         last_lat=excluded.last_lat, last_lon=excluded.last_lon,
                         last_fix_at=excluded.last_fix_at
                       WHERE excluded.reported_at >= status.reported_at""",
                    (device_id, reported, now, json.dumps(payload), *ll))
        touch(con, device_id, now, interval)
        nxt = next_heartbeat(con, device_id)
    return ok({"device_id": device_id, "received_at": now, "next_heartbeat_seconds": nxt})


@app.post("/api/v1/devices/{device_id}/events")
def post_event(device_id: str, body: Event, _=Depends(device_auth)):
    if body.device_id != device_id:
        raise ApiError(400, "device_id pada body tidak sama dengan URL")
    now = now_iso()
    payload = body.model_dump(mode="json")
    with db() as con:
        cur = con.execute("""INSERT OR IGNORE INTO events(event_id,device_id,event_type,severity,
                             occurred_at,received_at,payload) VALUES(?,?,?,?,?,?,?)""",
                          (body.event_id, device_id, body.event_type, body.severity,
                           fmt(body.occurred_at), now, json.dumps(payload)))
        is_new = cur.rowcount == 1
        touch(con, device_id, now)
        nxt = next_heartbeat(con, device_id)
    if is_new:
        notify(payload)
    return ok({"event_id": body.event_id, "received_at": now, "duplicate": not is_new,
               "next_heartbeat_seconds": nxt})


# ---------- endpoint web app ----------
@app.get("/api/v1/devices/{device_id}/status")
def get_status(device_id: str, _=Depends(known_device)):
    with db() as con:
        dev = con.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()
        st = con.execute("SELECT reported_at, payload FROM status WHERE device_id=?",
                         (device_id,)).fetchone()
    if not dev:
        return ok({"device_id": device_id, "connection": "never", "last_seen_at": None,
                   "age_seconds": None, "reported_at": None, "report": None})
    age = int((datetime.now(timezone.utc) - parse_ts(dev["last_seen_at"])).total_seconds())
    conn = "offline" if age > dev["interval_s"] + GRACE_S else "online"
    return ok({"device_id": device_id, "connection": conn, "last_seen_at": dev["last_seen_at"],
               "age_seconds": age, "expected_interval_seconds": dev["interval_s"],
               "reported_at": st["reported_at"] if st else None,
               "report": json.loads(st["payload"]) if st else None})


@app.get("/api/v1/devices/{device_id}/location")
def get_location(device_id: str, _=Depends(known_device)):
    with db() as con:
        r = con.execute("SELECT last_lat,last_lon,last_fix_at FROM status WHERE device_id=?",
                        (device_id,)).fetchone()
    has = bool(r and r["last_lat"] is not None)
    return ok({"device_id": device_id, "has_fix": has,
               "latitude": r["last_lat"] if has else None,
               "longitude": r["last_lon"] if has else None,
               "fix_at": r["last_fix_at"] if has else None})


@app.get("/api/v1/devices/{device_id}/battery")
def get_battery(device_id: str, _=Depends(known_device)):
    with db() as con:
        p = get_payload(con, device_id)
    return ok({"device_id": device_id, "battery": (p or {}).get("battery")})


@app.get("/api/v1/devices/{device_id}/events")
def list_events(device_id: str, limit: int = Query(20, ge=1, le=100),
                offset: int = Query(0, ge=0), _=Depends(known_device)):
    with db() as con:
        rows = con.execute("""SELECT payload, received_at, acknowledged_at FROM events
                              WHERE device_id=? ORDER BY occurred_at DESC LIMIT ? OFFSET ?""",
                           (device_id, limit, offset)).fetchall()
    items = [{**json.loads(r["payload"]), "received_at": r["received_at"],
              "acknowledged_at": r["acknowledged_at"]} for r in rows]
    return ok({"items": items, "limit": limit, "offset": offset})


@app.post("/api/v1/devices/{device_id}/events/{event_id}/acknowledge")
def ack_event(device_id: str, event_id: str, _=Depends(known_device)):
    now = now_iso()
    with db() as con:
        cur = con.execute("""UPDATE events SET acknowledged_at=COALESCE(acknowledged_at, ?)
                             WHERE event_id=? AND device_id=?""", (now, event_id, device_id))
        if cur.rowcount == 0:
            raise ApiError(404, "Event tidak ditemukan")
    return ok({"event_id": event_id, "acknowledged": True})


# Dashboard: hanya index.html yang disajikan (bukan seluruh folder Web),
# supaya main.py, smartguard.db, dan .venv tidak bisa diunduh lewat browser.
@app.get("/", include_in_schema=False)
def index():
    if not INDEX_FILE.is_file():
        raise ApiError(404, f"index.html tidak ditemukan di {INDEX_FILE}")
    return FileResponse(INDEX_FILE)
