"""Uji cepat backend tanpa ESP32. Jalankan server dulu, lalu: python test_api.py"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8000"
DEV = "sg-device-001"
TOKEN = "dev-token-ganti-ini"


def ts(delta=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta)).strftime("%Y-%m-%dT%H:%M:%SZ")


def call(method, path, body=None, token=TOKEN):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def show(title, res):
    print(f"\n== {title} -> {res[0]}")
    print(json.dumps(res[1], indent=2, ensure_ascii=False)[:700])


telemetry = {
    "schema_version": 1, "device_id": DEV, "reported_at": ts(),
    "power": {"mode": "ARMED_SLEEP", "last_wake_reason": "timer", "next_heartbeat_due_at": ts(600)},
    "security": {"state": "ARMED", "alarm_active": False,
                 "home": {"latitude": -7.797, "longitude": 110.370},
                 "geofence_radius_m": 30, "distance_from_home_m": 4.8},
    "gps": {"fix": True, "latitude": -7.7971, "longitude": 110.3702, "speed_kmh": 0.2,
            "satellites": 8, "updated_at": ts(-2)},
    "motion": {"available": True, "detected": False, "acceleration_mps2": 0.14, "updated_at": ts(-1)},
    "battery": {"voltage_v": 3.91, "soc_percent": 72, "status": "normal", "charging": None,
                "updated_at": ts(-5)},
    "connectivity": {"wifi_connected": True, "api_reachable": True, "ble_available": True,
                     "last_successful_sync_at": ts()},
    "health": {"gps": "ok", "motion_sensor": "ok", "battery_monitor": "ok", "event_queue_size": 0},
}
alarm = {
    "schema_version": 1, "event_id": "TEST-ALARM-" + ts().replace(":", ""), "device_id": DEV,
    "event_type": "security_alarm", "severity": "high", "occurred_at": ts(),
    "reason": ["motion_detected", "geofence_exceeded"],
    "location": {"latitude": -7.7975, "longitude": 110.3711, "gps_fix": True},
    "distance_from_home_m": 46.2, "battery": {"soc_percent": 71, "voltage_v": 3.89},
}

show("telemetry", call("POST", f"/api/v1/devices/{DEV}/telemetry", telemetry))
show("event pertama", call("POST", f"/api/v1/devices/{DEV}/events", alarm))
show("event dikirim ulang (harus duplicate=true)", call("POST", f"/api/v1/devices/{DEV}/events", alarm))
show("heartbeat", call("POST", f"/api/v1/devices/{DEV}/heartbeat"))
show("tanpa token (harus 401)", call("POST", f"/api/v1/devices/{DEV}/heartbeat", token=None))
show("token salah (harus 403)", call("POST", f"/api/v1/devices/{DEV}/heartbeat", token="salah"))
show("payload rusak (harus 400)", call("POST", f"/api/v1/devices/{DEV}/events", {"event_id": "x"}))
show("status", call("GET", f"/api/v1/devices/{DEV}/status", token=None))
show("location", call("GET", f"/api/v1/devices/{DEV}/location", token=None))
show("events", call("GET", f"/api/v1/devices/{DEV}/events?limit=5", token=None))
show("acknowledge", call("POST", f"/api/v1/devices/{DEV}/events/{alarm['event_id']}/acknowledge", token=None))
