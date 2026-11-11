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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import Body, Depends, FastAPI, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

BASE = Path(__file__).resolve().parent
DB_PATH = os.environ.get("SMARTGUARD_DB", str(BASE / "smartguard.db"))
WEB_DIR = Path(os.environ.get("SMARTGUARD_WEB_DIR", BASE.parent / "Frontend"))  # Web/Backend dan Web/Frontend bersebelahan
# Hanya file/folder ini yang boleh diunduh browser (Backend/, .venv, node_modules, dll. TIDAK ikut)
STATIC_FILES = {"index.html", "dashboard.html", "config.js", "sw.js", "manifest.webmanifest", "favicon.ico"}
STATIC_DIRS = {"css", "js", "assets", "img", "icons", "fonts"}
LEGACY_DEVICE_ID = os.environ.get("SMARTGUARD_LEGACY_DEVICE", "sg-device-001")  # perangkat untuk /api/telemetry
LEGACY_KEY = os.environ.get("SMARTGUARD_LEGACY_KEY", "")   # bila diisi, firmware wajib kirim header X-Api-Key
DEFAULT_INTERVAL_S = 600               # heartbeat normal: 10 menit
ALARM_INTERVAL_S = 30                  # saat alarm aktif, lapor lebih sering
GRACE_S = 300                          # toleransi sebelum dianggap offline
RETENTION_DAYS = int(os.environ.get("LOCATION_RETENTION_DAYS", "30"))  # lama riwayat lokasi disimpan


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
        CREATE TABLE IF NOT EXISTS locations(
            id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
            recorded_at TEXT NOT NULL, received_at TEXT NOT NULL,
            latitude REAL NOT NULL, longitude REAL NOT NULL,
            speed_kmh REAL, satellites INTEGER, distance_from_home_m REAL,
            alarm INTEGER NOT NULL DEFAULT 0,
            UNIQUE(device_id, recorded_at));
        CREATE INDEX IF NOT EXISTS idx_loc_dev ON locations(device_id, recorded_at DESC);
        CREATE TABLE IF NOT EXISTS device_commands(
            device_id TEXT PRIMARY KEY, relay1 INTEGER NOT NULL DEFAULT 0, relay2 INTEGER NOT NULL DEFAULT 0,
            mode TEXT NOT NULL DEFAULT 'overwatch', geofence_radius_m REAL NOT NULL DEFAULT 30,
            shock_threshold REAL NOT NULL DEFAULT 15, home_valid INTEGER NOT NULL DEFAULT 0,
            home_lat REAL NOT NULL DEFAULT 0, home_lng REAL NOT NULL DEFAULT 0,
            alarm_latched INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
        """)
        cutoff = fmt(datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS))
        con.execute("DELETE FROM locations WHERE recorded_at < ?", (cutoff,))


# ---------- error & respons ----------
class ApiError(Exception):
    def __init__(self, status: int, message: str, headers: Optional[dict] = None):
        self.status, self.message, self.headers = status, message, headers


def envelope(status: int, data=None, error=None, headers=None):
    return JSONResponse({"ok": error is None, "data": data, "error": error},
                        status_code=status, headers=headers)


def ok(data):
    return {"ok": True, "data": data, "error": None}


app = FastAPI(title="SMARTGUARD API", version="0.2")
_origins = [o.strip() for o in os.environ.get("SMARTGUARD_CORS_ORIGINS", "").split(",") if o.strip()]
if _origins:   # hanya perlu bila frontend di-host di origin lain, mis. SMARTGUARD_CORS_ORIGINS=https://app.contoh.com
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT"], allow_headers=["*"])


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


def valid_coord(lat, lon) -> bool:
    return (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and -90 <= lat <= 90 and -180 <= lon <= 180)


def save_location(con, device_id, recorded_at, now, lat, lon, speed=None, sats=None,
                  dist=None, alarm=False):
    """Simpan satu titik riwayat. Titik dengan recorded_at sama diabaikan (retry aman)."""
    con.execute("""INSERT OR IGNORE INTO locations(device_id,recorded_at,received_at,latitude,
                   longitude,speed_kmh,satellites,distance_from_home_m,alarm)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (device_id, recorded_at, now, lat, lon, speed, sats, dist, 1 if alarm else 0))


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


def store_telemetry(con, device_id: str, body: Telemetry) -> int:
    """Simpan status + titik lokasi dari satu laporan (format Bagian 7.2). Mengembalikan interval heartbeat berikutnya."""
    soc = (body.battery or {}).get("soc_percent")
    if soc is not None and not (isinstance(soc, (int, float)) and 0 <= soc <= 100):
        raise ApiError(400, "battery.soc_percent harus 0-100")
    now, reported = now_iso(), fmt(body.reported_at)
    payload = body.model_dump(mode="json")
    gps = body.gps or {}
    lat, lon = gps.get("latitude"), gps.get("longitude")
    has_fix = gps.get("fix") is True and lat is not None and lon is not None
    if has_fix and not valid_coord(lat, lon):
        raise ApiError(400, "gps.latitude/longitude di luar rentang yang valid")
    interval = interval_from(reported, (body.power or {}).get("next_heartbeat_due_at"))
    fix_at = parse_ts(gps.get("updated_at"))
    fix_at = fmt(fix_at) if fix_at and fix_at.tzinfo else reported

    old = con.execute("SELECT last_lat,last_lon,last_fix_at FROM status WHERE device_id=?", (device_id,)).fetchone()
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
    if has_fix:
        save_location(con, device_id, fix_at, now, lat, lon, gps.get("speed_kmh"),
                      gps.get("satellites"), (body.security or {}).get("distance_from_home_m"),
                      (body.security or {}).get("alarm_active") is True)
    touch(con, device_id, now, interval)
    return next_heartbeat(con, device_id)


@app.post("/api/v1/devices/{device_id}/telemetry")
def post_telemetry(device_id: str, body: Telemetry, _=Depends(device_auth)):
    if body.device_id != device_id:
        raise ApiError(400, "device_id pada body tidak sama dengan URL")
    with db() as con:
        nxt = store_telemetry(con, device_id, body)
    return ok({"device_id": device_id, "received_at": now_iso(), "next_heartbeat_seconds": nxt})


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
        loc = body.location or {}
        if loc.get("gps_fix") is True and valid_coord(loc.get("latitude"), loc.get("longitude")):
            save_location(con, device_id, fmt(body.occurred_at), now, loc["latitude"],
                          loc["longitude"], None, None, body.distance_from_home_m,
                          body.event_type == "security_alarm")
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
        st = con.execute("SELECT reported_at, received_at, payload FROM status WHERE device_id=?",
                         (device_id,)).fetchone()
    if not dev:
        return ok({"device_id": device_id, "connection": "never", "last_seen_at": None, "received_at": None,
                   "age_seconds": None, "reported_at": None, "report": None})
    age = int((datetime.now(timezone.utc) - parse_ts(dev["last_seen_at"])).total_seconds())
    conn = "offline" if age > dev["interval_s"] + GRACE_S else "online"
    report = json.loads(st["payload"]) if st else None
    # Payload Bagian 7.2 ditaruh di level atas (sesuai README frontend) dan tetap disalin di "report".
    return ok({**(report or {}), "device_id": device_id, "connection": conn,
               "last_seen_at": dev["last_seen_at"], "received_at": st["received_at"] if st else None,
               "age_seconds": age, "expected_interval_seconds": dev["interval_s"],
               "reported_at": st["reported_at"] if st else None, "report": report})


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


@app.get("/api/v1/devices/{device_id}/locations")
def list_locations(device_id: str, limit: int = Query(100, ge=1, le=500),
                   since: Optional[str] = None, _=Depends(known_device)):
    """Riwayat lokasi, terbaru lebih dulu. `since` = batas waktu awal (ISO 8601, UTC)."""
    since_s = None
    if since:
        dt = parse_ts(since)
        if not dt or not dt.tzinfo:
            raise ApiError(400, "since harus ISO 8601 dengan zona waktu, contoh 2026-11-03T00:00:00Z")
        since_s = fmt(dt)
    with db() as con:
        rows = con.execute("""SELECT recorded_at, latitude, longitude, speed_kmh, satellites,
                              distance_from_home_m, alarm FROM locations
                              WHERE device_id=? AND (? IS NULL OR recorded_at >= ?)
                              ORDER BY recorded_at DESC LIMIT ?""",
                           (device_id, since_s, since_s, limit)).fetchall()
    return ok({"items": [{**dict(r), "alarm": bool(r["alarm"])} for r in rows], "limit": limit})


@app.get("/api/v1/devices/{device_id}/battery")
def get_battery(device_id: str, _=Depends(known_device)):
    with db() as con:
        p = get_payload(con, device_id)
    return ok({"device_id": device_id, "battery": (p or {}).get("battery")})


@app.get("/api/v1/devices/{device_id}/events")
def list_events(device_id: str, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                cursor: Optional[str] = None, _=Depends(known_device)):
    if cursor is not None:                      # cursor = posisi awal halaman berikutnya (dari next_cursor)
        if not cursor.isdigit():
            raise ApiError(400, "cursor tidak valid")
        offset = int(cursor)
    with db() as con:
        rows = con.execute("""SELECT payload, received_at, acknowledged_at FROM events
                              WHERE device_id=? ORDER BY occurred_at DESC LIMIT ? OFFSET ?""",
                           (device_id, limit + 1, offset)).fetchall()
    more = len(rows) > limit
    items = [{**json.loads(r["payload"]), "received_at": r["received_at"],
              "acknowledged_at": r["acknowledged_at"]} for r in rows[:limit]]
    return ok({"items": items, "limit": limit, "offset": offset,
               "next_cursor": str(offset + limit) if more else None})


@app.post("/api/v1/devices/{device_id}/events/{event_id}/acknowledge")
def ack_event(device_id: str, event_id: str, _=Depends(known_device)):
    now = now_iso()
    with db() as con:
        cur = con.execute("""UPDATE events SET acknowledged_at=COALESCE(acknowledged_at, ?)
                             WHERE event_id=? AND device_id=?""", (now, event_id, device_id))
        if cur.rowcount == 0:
            raise ApiError(404, "Event tidak ditemukan")
    return ok({"event_id": event_id, "acknowledged": True})


# ---------- perintah ke perangkat (disimpan di server, diambil perangkat saat polling) ----------
def get_command(con, device_id: str) -> dict:
    con.execute("INSERT OR IGNORE INTO device_commands(device_id, updated_at) VALUES(?,?)", (device_id, now_iso()))
    r = con.execute("SELECT * FROM device_commands WHERE device_id=?", (device_id,)).fetchone()
    return {"relay1": r["relay1"], "relay2": r["relay2"], "alarm_active": bool(r["alarm_latched"]),
            "mode": r["mode"], "geofence_radius_m": r["geofence_radius_m"],
            "shock_threshold": r["shock_threshold"], "home_valid": bool(r["home_valid"]),
            "home_lat": r["home_lat"], "home_lng": r["home_lng"]}


class CommandUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    relay1: Optional[Literal[0, 1]] = None
    relay2: Optional[Literal[0, 1]] = None
    mode: Optional[Literal["armed", "overwatch", "powersafe"]] = None
    geofence_radius_m: Optional[float] = Field(None, gt=0, le=5000)
    shock_threshold: Optional[float] = Field(None, gt=0, le=100)
    home_lat: Optional[float] = Field(None, ge=-90, le=90)
    home_lng: Optional[float] = Field(None, ge=-180, le=180)
    home_valid: Optional[bool] = None


@app.get("/api/v1/devices/{device_id}/command")
def read_command(device_id: str, _=Depends(known_device)):
    with db() as con:
        return ok(get_command(con, device_id))


@app.put("/api/v1/devices/{device_id}/command")
def update_command(device_id: str, body: CommandUpdate, _=Depends(known_device)):
    changes = body.model_dump(exclude_none=True)
    if "home_lat" in changes and "home_lng" in changes and "home_valid" not in changes:
        changes["home_valid"] = True
    if ("home_lat" in changes) != ("home_lng" in changes):
        raise ApiError(400, "home_lat dan home_lng harus dikirim bersamaan")
    with db() as con:
        get_command(con, device_id)
        for k, v in changes.items():     # k berasal dari model (daftar tetap), aman dipakai sebagai nama kolom
            con.execute(f"UPDATE device_commands SET {k}=?, updated_at=? WHERE device_id=?",
                        (int(v) if isinstance(v, bool) else v, now_iso(), device_id))
        return ok(get_command(con, device_id))


@app.post("/api/v1/devices/{device_id}/alarm/reset")
def reset_alarm(device_id: str, _=Depends(known_device)):
    """Melepas kunci alarm di server. Bila kondisi pemicunya masih ada, firmware akan memicu alarm lagi."""
    with db() as con:
        get_command(con, device_id)
        con.execute("UPDATE device_commands SET alarm_latched=0, updated_at=? WHERE device_id=?", (now_iso(), device_id))
        return ok(get_command(con, device_id))


@app.post("/api/v1/devices/{device_id}/home/current")
def set_home_current(device_id: str, _=Depends(known_device)):
    with db() as con:
        r = con.execute("SELECT last_lat,last_lon FROM status WHERE device_id=?", (device_id,)).fetchone()
        if not r or r["last_lat"] is None:
            raise ApiError(409, "Belum ada posisi GPS yang valid untuk dijadikan titik awal")
        get_command(con, device_id)
        con.execute("UPDATE device_commands SET home_lat=?, home_lng=?, home_valid=1, updated_at=? WHERE device_id=?",
                    (r["last_lat"], r["last_lon"], now_iso(), device_id))
        return ok(get_command(con, device_id))


# ---------- kompatibilitas firmware main_1.cpp: POST /api/telemetry & GET /api/command ----------
class LegacyTelemetry(BaseModel):
    model_config = ConfigDict(extra="allow")
    mode: str = "overwatch"
    gps_fix: bool = False
    lat: float = 0
    lng: float = 0
    speed_kmh: float = 0
    satellites: int = 0
    mpu_ax: float = 0
    mpu_ay: float = 0
    mpu_az: float = 0
    mpu_vibration: bool = False
    battery_v: float = 0
    relay1: int = 0
    relay2: int = 0
    alarm_active: bool = False
    geofence_radius_m: float = 30
    dist_home_m: float = -1


def legacy_auth(x_api_key: Optional[str] = Header(default=None)):
    if LEGACY_KEY and not (x_api_key and hmac.compare_digest(x_api_key, LEGACY_KEY)):
        raise ApiError(401, "X-Api-Key tidak valid")


def add_event(con, device_id, etype, severity, occurred, reasons, loc, dist, batt):
    """Buat event (Bagian 7.3) dari sisi server. event_id unik per jenis + detik."""
    eid = f"{device_id}-{etype}-{int(parse_ts(occurred).timestamp())}"
    ev = {"schema_version": 1, "event_id": eid, "device_id": device_id, "event_type": etype,
          "severity": severity, "occurred_at": occurred, "reason": reasons, "location": loc,
          "distance_from_home_m": dist, "battery": batt}
    cur = con.execute("""INSERT OR IGNORE INTO events(event_id,device_id,event_type,severity,occurred_at,received_at,payload)
                         VALUES(?,?,?,?,?,?,?)""", (eid, device_id, etype, severity, occurred, now_iso(), json.dumps(ev)))
    if cur.rowcount == 1 and loc and loc.get("gps_fix"):
        save_location(con, device_id, occurred, now_iso(), loc["latitude"], loc["longitude"], None, None, dist,
                      etype == "security_alarm")
    return ev if cur.rowcount == 1 else None


@app.post("/api/telemetry")
def legacy_telemetry(body: LegacyTelemetry, _=Depends(legacy_auth)):
    dev = LEGACY_DEVICE_ID
    known_device(dev)
    now_dt = datetime.now(timezone.utc); now = fmt(now_dt)
    fix = body.gps_fix and valid_coord(body.lat, body.lng)
    mag = (body.mpu_ax ** 2 + body.mpu_ay ** 2 + body.mpu_az ** 2) ** 0.5
    # Pin ADC yang mengambang (pembagi tegangan belum terpasang) membaca nilai acak kecil, dan firmware mengirim 0 V
    # sampai pembacaan baterai pertama. Baterai Li-ion 1S lewat pembagi 2:1 tidak mungkin di bawah ~2 V.
    measured = body.battery_v >= 2.0
    mpu_ok = not (body.mpu_ax == 0 and body.mpu_ay == 0 and body.mpu_az == 0)   # nol semua = MPU6050 tidak terbaca
    soc = max(0, min(100, round((body.battery_v - 3.3) / (4.2 - 3.3) * 100))) if measured else None
    dist = body.dist_home_m if body.dist_home_m >= 0 else None
    new_events = []
    with db() as con:
        cmd = get_command(con, dev)
        prev = get_payload(con, dev) or {}
        payload = {
            "schema_version": 1, "device_id": dev, "reported_at": now,
            "power": {"mode": "ACTIVE", "operating_mode": body.mode, "last_wake_reason": "continuous",
                      "next_heartbeat_due_at": fmt(now_dt + timedelta(seconds=10))},
            "security": {"state": "ALARM" if body.alarm_active else body.mode.upper(),
                         "alarm_active": body.alarm_active, "geofence_radius_m": body.geofence_radius_m,
                         "distance_from_home_m": dist,
                         **({"home": {"latitude": cmd["home_lat"], "longitude": cmd["home_lng"]}} if cmd["home_valid"] else {})},
            "gps": {"fix": fix, "latitude": body.lat if fix else None, "longitude": body.lng if fix else None,
                    "speed_kmh": body.speed_kmh, "satellites": body.satellites, "updated_at": now},
            "motion": {"available": mpu_ok, "detected": body.mpu_vibration if mpu_ok else False,
                       "acceleration_mps2": round(abs(mag - 9.81), 2) if mpu_ok else None, "updated_at": now},
            "battery": {"voltage_v": body.battery_v if measured else None, "soc_percent": soc,
                        "status": None if soc is None else ("critical" if soc < 10 else "low" if soc < 20 else "normal"),
                        "charging": None, "updated_at": now},
            "connectivity": {"wifi_connected": True, "api_reachable": True, "ble_available": False,
                             "last_successful_sync_at": now},
            "health": {"gps": "ok" if fix else "no_fix", "motion_sensor": "ok" if mpu_ok else "fault", "battery_monitor": "ok" if measured else "unknown",
                       "event_queue_size": 0},
        }
        store_telemetry(con, dev, Telemetry.model_validate(payload))
        loc = {"latitude": body.lat, "longitude": body.lng, "gps_fix": True} if fix else {"gps_fix": False}
        batt = {"soc_percent": soc, "voltage_v": body.battery_v} if measured else None
        if body.alarm_active:
            con.execute("UPDATE device_commands SET alarm_latched=1, updated_at=? WHERE device_id=?", (now, dev))
            if not (prev.get("security") or {}).get("alarm_active"):      # transisi tidak aktif -> aktif
                reasons = []
                if dist is not None and dist > body.geofence_radius_m:
                    reasons.append("geofence_exceeded")
                if body.mpu_vibration:
                    reasons.append("motion_detected")
                ev = add_event(con, dev, "security_alarm", "high", now, reasons or ["device_reported"], loc, dist, batt)
                if ev: new_events.append(ev)
        prev_soc = (prev.get("battery") or {}).get("soc_percent")
        if soc is not None and soc < 20 and (prev_soc is None or prev_soc >= 20):
            ev = add_event(con, dev, "battery_low", "medium", now, [], loc, dist, batt)
            if ev: new_events.append(ev)
        reply = get_command(con, dev)
    for ev in new_events:
        notify(ev)
    return reply      # firmware menyimpan balasan ini; bentuknya sama dengan GET /api/command (tanpa pembungkus)


@app.get("/api/command")
def legacy_command(_=Depends(legacy_auth)):
    known_device(LEGACY_DEVICE_ID)
    with db() as con:
        return get_command(con, LEGACY_DEVICE_ID)   # firmware membaca JSON polos, jadi tanpa {ok,data,error}


# ---------- frontend statis: hanya file/folder pada daftar putih ----------
@app.get("/", include_in_schema=False)
@app.get("/{path:path}", include_in_schema=False)
def web(path: str = ""):
    path = path or "index.html"
    # Selama css/app.css (hasil build Tailwind frontend utama) belum ada, "/" menampilkan dashboard.html
    if path == "index.html" and not (WEB_DIR / "css" / "app.css").is_file() and (WEB_DIR / "dashboard.html").is_file():
        path = "dashboard.html"
    parts = Path(path).parts
    if ".." in parts or "\\" in path or Path(path).is_absolute():      # tolak path traversal
        raise ApiError(404, "Tidak ditemukan")
    root = WEB_DIR.resolve()
    f = (root / path).resolve()
    if len(parts) == 1 and parts[0] in STATIC_FILES:
        allowed = f.parent == root
    elif len(parts) >= 2 and parts[0] in STATIC_DIRS:
        allowed = (root / parts[0]) in f.parents          # file harus benar-benar di dalam folder yang diizinkan
    else:
        allowed = False
    if not allowed or not f.is_file():
        raise ApiError(404, "Tidak ditemukan")
    headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "index.html", "config.js") else None
    return FileResponse(f, headers=headers)
