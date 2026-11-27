# hardprogramming — Firmware ESP32

Firmware perangkat SMARTGUARD. Saat ini hanya berisi satu proyek PlatformIO:

| Folder | Isi |
|---|---|
| [`Smart-Guard-Hardprog/`](Smart-Guard-Hardprog/README.md) | Firmware utama `main_1.cpp` (HTTP client, Blynk dimatikan), `config.h.example`, `platformio.ini` |

Baca [`Smart-Guard-Hardprog/README.md`](Smart-Guard-Hardprog/README.md) untuk:
pin mapping ESP32, mode operasional (`armed` / `overwatch` / `powersafe`),
endpoint yang dipanggil, dan cara build/upload.

Konsep penting: firmware adalah **dumb device** — ia mengirim telemetri mentah ke
Web API dan mengeksekusi perintah dari server; **geofence dan alarm tidak
dievaluasi di ESP32**. Detail di [`../docs/SMARTGUARD_Core_v5.1_Clean.md`](../docs/SMARTGUARD_Core_v5.1_Clean.md).

```powershell
cd hardprogramming/Smart-Guard-Hardprog
copy src\config.h.example src\config.h   # isi WiFi + WEB_API_URL
pio run -t upload
pio device monitor                       # baud 115200
```
