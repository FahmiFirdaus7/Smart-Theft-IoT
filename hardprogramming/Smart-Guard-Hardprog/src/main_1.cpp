// ============================================================================
// SMARTGUARD v5.2.0 — Firmware "Dumb Device" + 3 Mode Operasional
//
// Perubahan v5.2.0 (refactor tanpa Blynk):
//   - Blynk dihapus total (library, virtual pin, auth token)
//   - Logika inti dipindah ke smartguard_core.h agar bisa diuji tanpa hardware
//   - LED alarm/powersafe benar-benar berkedip (sebelumnya hanya ~1 ms)
//   - WiFi reconnect otomatis dengan exponential backoff (tidak mati permanen
//     bila gagal connect saat boot)
//   - GPS tanpa fix mengirim lat/lng = null (bukan 0,0) agar server tidak
//     memicu alarm geofence palsu
//   - Command JSON parsial tidak mereset relay/mode yang sedang aktif
//   - ADC baterai dirata-rata 8 sampel + kalibrasi opsional
//   - Interval telemetri/polling memakai konstanta (bukan angka hardcode)
//   - Buffer UART GPS diperbesar agar tidak overflow saat request HTTP lambat
// ============================================================================

#include "config.h"

#ifndef WEB_API_URL
#error "Tambahkan di config.h: #define WEB_API_URL \"http://IP-LAPTOP:3001\"  (tanpa / di akhir dan tanpa /api)"
#endif

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "smartguard_core.h"

// ----------------------------------------------------------------------------
// Konfigurasi default (bisa dioverride dari config.h)
// ----------------------------------------------------------------------------
#ifndef TELEMETRY_INTERVAL_MS
#define TELEMETRY_INTERVAL_MS 3000
#endif

#ifndef COMMAND_POLL_INTERVAL_MS
#define COMMAND_POLL_INTERVAL_MS 3000
#endif

#ifndef HTTP_CONNECT_TIMEOUT_MS
#define HTTP_CONNECT_TIMEOUT_MS 2000
#endif

#ifndef HTTP_TIMEOUT_MS
#define HTTP_TIMEOUT_MS 3000
#endif

#ifndef WIFI_CONNECT_TIMEOUT_MS
#define WIFI_CONNECT_TIMEOUT_MS 10000
#endif

#ifndef BATTERY_DIVIDER_RATIO
#define BATTERY_DIVIDER_RATIO 2.0f
#endif

#ifndef BATTERY_CALIBRATION
#define BATTERY_CALIBRATION 1.0f
#endif

#ifndef BATTERY_SAMPLES
#define BATTERY_SAMPLES 8
#endif

#ifndef SHOCK_HOLD_MS
#define SHOCK_HOLD_MS 5000
#endif

#define FIRMWARE_VERSION "5.2.0"

// Jeda minimum setelah request gagal, supaya server yang mati tidak membuat
// loop tertahan request terus-menerus.
static const unsigned long NET_RETRY_TELEMETRY_MS = 5000;
static const unsigned long NET_RETRY_COMMAND_MS = 10000;

// ----------------------------------------------------------------------------
// Pin & sensor
// ----------------------------------------------------------------------------
static const int GPS_RX_PIN = 16;
static const int GPS_TX_PIN = 17;
static const uint32_t GPS_BAUD = 9600;

static const int MPU_SDA = 21;
static const int MPU_SCL = 22;

static const int RELAY1_PIN = 32; // Active-LOW
static const int RELAY2_PIN = 33; // Active-LOW, blink 500 ms

static const int LED_GREEN_PIN = 25;
static const int LED_RED_PIN = 26;

static const int BAT_ADC_PIN = 34;

static const unsigned long MPU_INTERVAL = 100;
static const unsigned long GPS_LOG_INTERVAL = 5000;
static const unsigned long BATT_INTERVAL = 30000;
static const unsigned long RELAY2_INTERVAL = 500;

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------
char ssid[] = WIFI_SSID;
char pass[] = WIFI_PASSWORD;

sg::WebCommand g_cmd;
sg::HomePos g_home;
sg::LedController g_leds;
sg::ShockDetector g_shock(SHOCK_HOLD_MS);

float g_geofenceRadiusM = 30.0f;
float g_shockThreshold = 15.0f;

Adafruit_MPU6050 mpu;
bool g_mpu_ok = false;
unsigned long lastMpuTime = 0;
float g_ax = 0, g_ay = 0, g_az = 0;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
unsigned long lastGpsLogTime = 0;
bool g_gpsNoDataWarned = false;

bool g_relay2State = false;
unsigned long lastRelay2Toggle = 0;

WiFiClient plainClient;
HTTPClient http;

unsigned long lastBattTime = 0;
float g_battVoltage = 0.0f;

// WiFi reconnect (backoff) — tanpa ini, gagal connect saat boot = perangkat
// tidak pernah online sampai di-reset.
unsigned long g_nextWifiAttemptAt = 0;
unsigned long g_wifiBackoffMs = 2000;
bool g_wifiWasConnected = false;

// Jadwal jaringan (non-blocking)
unsigned long g_nextTelemetryAt = 0;
unsigned long g_nextCommandPollAt = 0;

// ----------------------------------------------------------------------------
// WiFi
// ----------------------------------------------------------------------------
bool wifiConnected()
{
  return WiFi.status() == WL_CONNECTED;
}

void noteWifiConnected()
{
  g_wifiWasConnected = true;
  g_wifiBackoffMs = 2000;
  g_nextWifiAttemptAt = 0;
  g_nextTelemetryAt = millis(); // kirim secepatnya setelah (re)connect
  g_nextCommandPollAt = millis();
  Serial.print("WiFi terhubung: ");
  Serial.println(WiFi.localIP());
}

void maintainWifi(unsigned long now)
{
  if (wifiConnected())
  {
    if (!g_wifiWasConnected)
      noteWifiConnected();
    return;
  }

  if (g_wifiWasConnected)
  {
    g_wifiWasConnected = false;
    Serial.println("WiFi terputus — mencoba reconnect...");
  }

  if ((long)(now - g_nextWifiAttemptAt) < 0)
    return;

  Serial.print("WiFi reconnect (backoff ");
  Serial.print(g_wifiBackoffMs);
  Serial.println(" ms)");
  WiFi.disconnect();
  WiFi.begin(ssid, pass);

  g_nextWifiAttemptAt = now + g_wifiBackoffMs;
  g_wifiBackoffMs = min(g_wifiBackoffMs * 2UL, 60000UL);
}

// ----------------------------------------------------------------------------
// HTTP helper
// ----------------------------------------------------------------------------
void addCommonHeaders()
{
#ifdef WEB_API_KEY
  http.addHeader("X-Api-Key", WEB_API_KEY);
#endif
#ifdef DEVICE_ID
  // Opsional: bedakan beberapa perangkat di server (default server: "default").
  http.addHeader("X-Device-Id", DEVICE_ID);
#endif
}

bool httpPostTelemetry(const String &payload)
{
  if (!http.begin(plainClient, WEB_API_URL "/api/telemetry"))
  {
    Serial.println("HTTP begin telemetri gagal");
    return false;
  }

  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(true);
  addCommonHeaders();
  http.addHeader("Content-Type", "application/json");

  const int httpCode = http.POST(payload);
  const bool ok = httpCode >= 200 && httpCode < 300;

  if (httpCode > 0)
  {
    // Habiskan body (termasuk saat error) agar koneksi keep-alive tidak kotor.
    http.getString();
  }

  if (!ok)
  {
    if (httpCode < 0)
    {
      Serial.print("POST telemetri gagal: ");
      Serial.println(http.errorToString(httpCode));
    }
    else
    {
      Serial.print("POST telemetri HTTP ");
      Serial.println(httpCode);
    }
  }

  http.end();
  return ok;
}

// ----------------------------------------------------------------------------
// Baterai
// ----------------------------------------------------------------------------
float readBatteryVoltage()
{
  uint32_t sum = 0;
  for (int i = 0; i < BATTERY_SAMPLES; i++)
  {
    sum += analogRead(BAT_ADC_PIN);
  }
  const float average = static_cast<float>(sum) / static_cast<float>(BATTERY_SAMPLES);
  return sg::adcToBatteryVoltage(average, 4095.0f, 3.3f,
                                 BATTERY_DIVIDER_RATIO, BATTERY_CALIBRATION);
}

// ----------------------------------------------------------------------------
// GPS
// ----------------------------------------------------------------------------
bool gpsFixValid()
{
  return gps.location.isValid() && gps.location.age() < 5000;
}

void readGps()
{
  // Batasi byte per loop supaya sensor lain tetap terlayani.
  size_t budget = 256;
  while (budget-- > 0 && gpsSerial.available() > 0)
  {
    gps.encode(gpsSerial.read());
  }
}

// ----------------------------------------------------------------------------
// Telemetri
// ----------------------------------------------------------------------------
void sendTelemetry(unsigned long now)
{
  static JsonDocument telemetryDoc;

  telemetryDoc.clear();

  sg::TelemetryInput in;
  in.mode = g_cmd.mode;
  in.gps_fix = gpsFixValid();
  in.lat = in.gps_fix ? gps.location.lat() : 0.0f;
  in.lng = in.gps_fix ? gps.location.lng() : 0.0f;
  in.speed_kmh = in.gps_fix ? gps.speed.kmph() : 0.0f;
  in.satellites = gps.satellites.value();
  in.mpu_ax = g_ax;
  in.mpu_ay = g_ay;
  in.mpu_az = g_az;
  in.mpu_vibration = g_shock.active();
  in.battery_v = g_battVoltage;
  in.command = &g_cmd;
  in.home = g_home;
  in.geofence_radius_m = g_geofenceRadiusM;

  sg::buildTelemetry(telemetryDoc, in);

  String out;
  out.reserve(512);
  serializeJson(telemetryDoc, out);

  if (httpPostTelemetry(out))
  {
    g_nextTelemetryAt = now + TELEMETRY_INTERVAL_MS;
  }
  else
  {
    // Server tidak terjangkau: jangan spam, beri jeda lebih panjang.
    g_nextTelemetryAt = now + NET_RETRY_TELEMETRY_MS;
  }

  Serial.print("Telemetri: ");
  Serial.println(out);
}

// ----------------------------------------------------------------------------
// Command dari web
// ----------------------------------------------------------------------------
void applyCommand(const sg::WebCommand &cmd)
{
  if (cmd.home_updated)
  {
    g_home.valid = cmd.home_valid;
    if (g_home.valid)
    {
      g_home.lat = cmd.home_lat;
      g_home.lng = cmd.home_lng;
    }
    Serial.print("HOME diperbarui: ");
    Serial.println(g_home.valid ? "valid" : "belum valid");
  }

  g_geofenceRadiusM = cmd.geofence_radius_m;
  g_shockThreshold = cmd.shock_threshold;
}

void pollCommand(unsigned long now)
{
  if (!http.begin(plainClient, WEB_API_URL "/api/command"))
  {
    g_nextCommandPollAt = now + NET_RETRY_COMMAND_MS;
    return;
  }

  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(true);
  addCommonHeaders();

  const int httpCode = http.GET();

  if (httpCode == 200)
  {
    const String payload = http.getString();
    const char *error = nullptr;

    if (sg::parseCommand(payload.c_str(), g_cmd, &error))
    {
      applyCommand(g_cmd);
      Serial.print("Command web: ");
      Serial.println(payload);
    }
    else
    {
      Serial.print("Command JSON tidak valid: ");
      Serial.println(error != nullptr ? error : "unknown");
    }
  }
  else if (httpCode > 0 && httpCode != 204)
  {
    http.getString(); // buang body error agar koneksi tetap bersih
    Serial.print("GET command HTTP ");
    Serial.println(httpCode);
  }
  else if (httpCode < 0)
  {
    Serial.print("GET command gagal: ");
    Serial.println(http.errorToString(httpCode));
    g_nextCommandPollAt = now + NET_RETRY_COMMAND_MS;
    http.end();
    return;
  }
  // 204 = tidak ada command baru (normal).

  http.end();
  g_nextCommandPollAt = now + COMMAND_POLL_INTERVAL_MS;
}

// ----------------------------------------------------------------------------
// Setup
// ----------------------------------------------------------------------------
void setup()
{
  Serial.begin(115200);
  delay(200); // beri waktu USB CDC; tidak menahan lama

  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(BAT_ADC_PIN, INPUT);

  // Kondisi aman saat boot: relay mati (Active-LOW = HIGH), LED mati.
  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  analogReadResolution(12);
  analogSetPinAttenuation(BAT_ADC_PIN, ADC_11db);
  g_battVoltage = readBatteryVoltage();

  Serial.print("SMARTGUARD v");
  Serial.println(FIRMWARE_VERSION);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, pass);

  Serial.print("Menghubungkan WiFi");
  const unsigned long wifiStart = millis();
  while (!wifiConnected() && millis() - wifiStart < WIFI_CONNECT_TIMEOUT_MS)
  {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (wifiConnected())
  {
    noteWifiConnected();
  }
  else
  {
    // Jangan menyerah: loop akan mencoba lagi dengan backoff.
    Serial.println("WiFi belum terhubung — reconnect otomatis aktif");
    g_nextWifiAttemptAt = millis() + g_wifiBackoffMs;
  }
  Serial.println("Target API: " WEB_API_URL);

  Wire.begin(MPU_SDA, MPU_SCL);
  if (!mpu.begin())
  {
    Serial.println("MPU6050 tidak ditemukan");
    g_mpu_ok = false;
  }
  else
  {
    g_mpu_ok = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);
    Serial.println("MPU6050 siap");
  }

  gpsSerial.setRxBufferSize(1024); // tahan NMEA saat loop sempat sibuk HTTP
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Serial.print("Mode awal: ");
  Serial.println(sg::modeToString(g_cmd.mode));
  Serial.println("SmartGuard siap (HTTP client, tanpa Blynk)");
}

// ----------------------------------------------------------------------------
// Loop
// ----------------------------------------------------------------------------
void loop()
{
  const unsigned long now = millis();

  readGps();

  // --- Sensor gerak ---
  if (g_mpu_ok && now - lastMpuTime >= MPU_INTERVAL)
  {
    lastMpuTime = now;

    sensors_event_t accelEvent, gyroEvent, tempEvent;
    mpu.getEvent(&accelEvent, &gyroEvent, &tempEvent);
    g_ax = accelEvent.acceleration.x; // m/s²
    g_ay = accelEvent.acceleration.y;
    g_az = accelEvent.acceleration.z;

    const float magnitude = sqrtf(g_ax * g_ax + g_ay * g_ay + g_az * g_az);
    if (g_shock.update(now, magnitude, g_shockThreshold))
    {
      Serial.print("Getaran terdeteksi [");
      Serial.print(sg::modeToString(g_cmd.mode));
      Serial.print("] mag=");
      Serial.println(magnitude, 2);
    }
  }

  // --- Baterai (30 detik) ---
  if (now - lastBattTime >= BATT_INTERVAL)
  {
    lastBattTime = now;
    g_battVoltage = readBatteryVoltage();
    Serial.print("Baterai: ");
    Serial.print(g_battVoltage, 2);
    Serial.println(" V");
  }

  // --- Log GPS (5 detik) ---
  if (now - lastGpsLogTime >= GPS_LOG_INTERVAL)
  {
    lastGpsLogTime = now;
    Serial.print("GPS fix: ");
    Serial.println(gpsFixValid() ? "VALID" : "BELUM VALID");
    Serial.printf("GPS karakter: %lu, satelit: %lu\n",
                  gps.charsProcessed(),
                  static_cast<unsigned long>(gps.satellites.value()));

    if (!g_gpsNoDataWarned && gps.charsProcessed() < 10 && now > 10000)
    {
      g_gpsNoDataWarned = true;
      Serial.println("PERINGATAN: tidak ada data UART GPS — cek wiring/baud/tegangan");
    }
  }

  // --- Jaringan (non-blocking) ---
  maintainWifi(now);

  if (wifiConnected())
  {
    if ((long)(now - g_nextTelemetryAt) >= 0)
    {
      sendTelemetry(now);
    }

    // Polling hanya setelah jadwalnya; request gagal memberi jeda lebih panjang.
    if ((long)(now - g_nextCommandPollAt) >= 0)
    {
      pollCommand(now);
    }
  }

  // --- LED otomatis (mode + alarm) ---
  const sg::LedState led = g_leds.update(now, g_cmd.mode, g_cmd.alarm_active);
  digitalWrite(LED_GREEN_PIN, led.green ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, led.red ? HIGH : LOW);

  // --- Relay 1 (Active-LOW, stabil) ---
  digitalWrite(RELAY1_PIN, g_cmd.relay1 == 1 ? LOW : HIGH);

  // --- Relay 2 (Active-LOW, blink 500 ms) ---
  if (g_cmd.relay2 == 1)
  {
    if (now - lastRelay2Toggle >= RELAY2_INTERVAL)
    {
      lastRelay2Toggle = now;
      g_relay2State = !g_relay2State;
      digitalWrite(RELAY2_PIN, g_relay2State ? LOW : HIGH);
    }
  }
  else
  {
    if (g_relay2State)
    {
      g_relay2State = false;
      digitalWrite(RELAY2_PIN, HIGH);
    }
  }
}
