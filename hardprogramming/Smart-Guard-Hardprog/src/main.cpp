// ============================================================================
// SMARTGUARD v5.1 — Firmware prototipe (Blynk dulu, belum HTTP/Web API)
// Target: ESP32 DevKit V1
// Referensi: docs/SMARTGUARD_Core_v5.1_Clean.md
// ============================================================================

// 1. Kredensial Blynk / WiFi (JANGAN commit ke repo publik)
#define BLYNK_TEMPLATE_ID "TMPL6WboNZksG"
#define BLYNK_TEMPLATE_NAME "Prototype FinPro"
#define BLYNK_AUTH_TOKEN "giRDyLSMMTS0VMxW3iaVxkAT2gXOdP1y"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <BlynkSimpleEsp32.h>

// --------------------------- WiFi ---------------------------
char ssid[] = "ext2gMeidi";
char pass[] = "Meidi7172";

// --------------------------- Pin mapping (v5.1 bab 4.2) ---------------------------
static const int GPS_RX_PIN = 16; // GPIO16 = UART2 RX (dari GPS TX)
static const int GPS_TX_PIN = 17; // GPIO17 = UART2 TX (ke GPS RX)
static const uint32_t GPS_BAUD = 9600;

static const int MPU_SDA = 21;
static const int MPU_SCL = 22;

static const int RELAY1_PIN = 32; // Active-LOW (blynk V3)
static const int RELAY2_PIN = 33; // Active-LOW, blink 500 ms (blynk V4)

// LED per spesifikasi v5.1: hijau normal, merah alarm (sesuaikan papan kamu)
static const int LED_GREEN_PIN = 25;
static const int LED_RED_PIN = 26;

// Baterai ADC (GPIO34 input-only, pembagi tegangan eksternal wajib)
static const int BAT_ADC_PIN = 34;

// --------------------------- State machine (v5.1 bab 5.1) ---------------------------
enum DeviceState
{
  INITIALIZING,
  ARMED,
  ALARM,
  FAULT
};
DeviceState g_state = INITIALIZING;
bool g_alarm_active = false;

// --------------------------- HOME & Geofence (v5.1 bab 5.2, 5.4) ---------------------------
struct HomePos
{
  float lat = 0;
  float lng = 0;
  bool valid = false;
};
HomePos g_home;
const float GEOFENCE_RADIUS_M = 30.0f;

// --------------------------- MPU6050 ---------------------------
Adafruit_MPU6050 mpu;
bool g_mpu_ok = false;
unsigned long lastMpuTime = 0;
const unsigned long MPU_INTERVAL = 100;
float g_ax = 0, g_ay = 0, g_az = 0;
float g_shockThreshold = 15.0f;

// --------------------------- GPS ---------------------------
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
unsigned long lastGpsLogTime = 0;
const unsigned long GPS_LOG_INTERVAL = 5000;

// --------------------------- Blynk virtual pins ---------------------------
// V1 = telemetry JSON keluar ke aplikasi
// V2 = mode tracking manual (masuk dari aplikasi, untuk uji)
// V3 = Relay 1 (masuk)
// V4 = Relay 2 blink 500 ms (masuk)

bool g_trackingForced = false;
bool g_relay2Blink = false;
bool g_relay2State = false;
unsigned long lastRelay2Toggle = 0;
const unsigned long RELAY2_INTERVAL = 500;

// --------------------------- Antrean event (v5.1 bab 7.4 & 9) ---------------------------
struct Event
{
  char id[32];
  char type[32];
  char payload[128];
  unsigned long occurredAt = 0;
  bool sent = false;
};
#define MAX_EVENTS 10
Event g_queue[MAX_EVENTS];
int g_queueCount = 0;
unsigned long g_eventSeq = 0;

// --------------------------- Baterai ---------------------------
float g_battVoltage = 0.0f;
int g_battSoc = -1; // -1 = belum diketahui
unsigned long lastBattTime = 0;
const unsigned long BATT_INTERVAL = 30000;

// --------------------------- Koneksi Blynk (non-blocking) ---------------------------
bool g_blynkConnected = false;
unsigned long lastBlynkConnAttempt = 0;
const unsigned long BLYNK_RECONN_INTERVAL = 10000;

// ==================== Deklarasi fungsi ====================
void setState(DeviceState next);
void ledSet(bool greenOn, bool redOn);
void ledPatternState();
float readBatteryVoltage();
int estimateSoc(float voltage);
bool gpsFixValid();
float haversineM(float lat1, float lon1, float lat2, float lon2);
void addEvent(const char *type, const char *payload);
void processQueue();
String makeJsonTelemetry();

// ==================== BLYNK handlers ====================

// V2 — paksa tracking manual dari aplikasi (hanya untuk uji Blynk)
BLYNK_WRITE(V2)
{
  int v = param.asInt();
  g_trackingForced = (v == 1);
  Serial.print("Blynk V2 tracking manual: ");
  Serial.println(g_trackingForced ? "AKTIF" : "MATI");
  if (g_trackingForced)
  {
    g_state = ALARM;
    g_alarm_active = true;
    Serial.println("🚨 Mode Tracking dihidupkan MANUAL dari Blynk.");
    addEvent("security_alarm", "{\"reason\":\"manual_blynk_v2\"}");
  }
  else
  {
    if (g_state == ALARM && g_alarm_active)
    {
      g_state = ARMED;
      g_alarm_active = false;
    }
    Serial.println("✅ Mode Tracking DIMATIKAN dari Blynk.");
  }
}

// V3 — Relay 1 Active-LOW (1 = nyala)
BLYNK_WRITE(V3)
{
  int state = param.asInt();
  digitalWrite(RELAY1_PIN, !state); // 1 = LOW = nyala
  Serial.print("Relay 1 (V3): ");
  Serial.println(state == 1 ? "ON" : "OFF");
}

// V4 — Relay 2 blink 500 ms Active-LOW
BLYNK_WRITE(V4)
{
  int state = param.asInt();
  g_relay2Blink = (state == 1);
  if (!g_relay2Blink)
  {
    g_relay2State = false;
    digitalWrite(RELAY2_PIN, HIGH); // mati
    Serial.println("Relay 2 (V4) BLINK MATI");
  }
  else
  {
    Serial.println("Relay 2 (V4) BLINK AKTIF");
  }
}

BLYNK_CONNECTED()
{
  g_blynkConnected = true;
  Serial.println("Blynk terhubung");
  Blynk.virtualWrite(V2, 0);
  Blynk.virtualWrite(V3, 0);
  Blynk.virtualWrite(V4, 0);
}

BLYNK_DISCONNECTED()
{
  g_blynkConnected = false;
  Serial.println("Blynk terputus");
}

// ==================== SETUP ====================
void setup()
{
  Serial.begin(115200);
  while (!Serial)
    delay(10);

  // LED
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);

  // Relay (default mati = HIGH karena Active-LOW)
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  // Baterai ADC
  pinMode(BAT_ADC_PIN, INPUT);

  // MPU6050 (I2C) — tidak while(1) kalau gagal, masuk FAULT saja
  Wire.begin(MPU_SDA, MPU_SCL);
  if (!mpu.begin(0x68))
  {
    Serial.println("ERROR: MPU6050 tidak ditemukan — masuk FAULT");
    g_mpu_ok = false;
    setState(FAULT);
  }
  else
  {
    g_mpu_ok = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("MPU6050 siap");
  }

  // GPS UART2
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Blynk (reconnect non-blocking di loop)
  Blynk.begin(BLYNK_AUTH_TOKEN, ssid, pass);

  setState(INITIALIZING);
  Serial.println("Sistem diinisialisasi");
}

// ==================== LOOP ====================
void loop()
{
  Blynk.run();

  // ----- LED sesuai state -----
  ledPatternState();

  // ----- Relay 2 blink non-blocking -----
  if (g_relay2Blink)
  {
    if (millis() - lastRelay2Toggle >= RELAY2_INTERVAL)
    {
      lastRelay2Toggle = millis();
      g_relay2State = !g_relay2State;
      digitalWrite(RELAY2_PIN, g_relay2State ? LOW : HIGH); // Active-LOW
    }
  }

  // ----- GPS terus di-update buffer -----
  while (gpsSerial.available() > 0)
  {
    gps.encode(gpsSerial.read());
  }

  // Log GPS status berkala
  if (millis() - lastGpsLogTime > GPS_LOG_INTERVAL)
  {
    lastGpsLogTime = millis();
    if (gps.charsProcessed() < 10)
    {
      Serial.println("WARNING: Tidak ada data GPS sama sekali! Cek kabel TX/RX dan Power.");
    }
    else
    {
      Serial.print("GPS fix: ");
      Serial.println(gpsFixValid() ? "VALID" : "BELUM VALID");
    }
  }

  // ----- MPU & deteksi gerak -----
  if (g_mpu_ok && millis() - lastMpuTime >= MPU_INTERVAL)
  {
    lastMpuTime = millis();

    sensors_event_t a, g, tempEvent;
    mpu.getEvent(&a, &g, &tempEvent);

    g_ax = a.acceleration.x;
    g_ay = a.acceleration.y;
    g_az = a.acceleration.z;

    float magnitude = sqrt(g_ax * g_ax + g_ay * g_ay + g_az * g_az);

    if (magnitude > g_shockThreshold && !g_trackingForced)
    {
      g_trackingForced = true;
      g_state = ALARM;
      g_alarm_active = true;
      Blynk.virtualWrite(V2, 1);
      Serial.println("🚨 GUNCANGAN TERDETEKSI! Mode Tracking Aktif.");
      char payload[128];
      snprintf(payload, sizeof(payload), "{\"reason\":\"mpu_shock\",\"mag\":%.2f}", magnitude);
      addEvent("security_alarm", payload);
    }
  }

  // ----- Baterai -----
  if (millis() - lastBattTime >= BATT_INTERVAL)
  {
    lastBattTime = millis();
    g_battVoltage = readBatteryVoltage();
    g_battSoc = estimateSoc(g_battVoltage);
    Serial.print("Baterai: ");
    Serial.print(g_battVoltage, 2);
    Serial.print(" V | ");
    Serial.print(g_battSoc);
    Serial.println("%");
  }

  // ----- Evaluasi geofence jika GPS valid dan sudah ada HOME -----
  if (g_home.valid && gpsFixValid())
  {
    float dist = haversineM(
        g_home.lat, g_home.lng,
        gps.location.lat(), gps.location.lng());
    if (dist > GEOFENCE_RADIUS_M && g_state != ALARM)
    {
      g_state = ALARM;
      g_alarm_active = true;
      g_trackingForced = true;
      Blynk.virtualWrite(V2, 1);
      Serial.print("🚨 GEOFENCE TERLAMPIAU! Jarak: ");
      Serial.print(dist);
      Serial.println(" m");
      char payload[128];
      snprintf(payload, sizeof(payload), "{\"reason\":\"geofence\",\"dist_m\":%.1f}", dist);
      addEvent("security_alarm", payload);
    }
  }

  // ----- Inisialisasi HOME saat GPS pertama kali valid -----
  if (g_state == INITIALIZING && gpsFixValid())
  {
    g_home.lat = gps.location.lat();
    g_home.lng = gps.location.lng();
    g_home.valid = true;
    g_state = ARMED;
    g_alarm_active = false;
    Serial.print("HOME disetel: ");
    Serial.print(g_home.lat, 6);
    Serial.print(", ");
    Serial.println(g_home.lng, 6);
    addEvent("device_started", "{\"home_set\":true}");
  }

  // ----- Kirim telemetri ke Blynk V1 jika tracking aktif atau state berubah -----
  static unsigned long lastTelemetry = 0;
  if (g_trackingForced || g_state == ALARM || g_state == ARMED)
  {
    if (millis() - lastTelemetry >= 3000)
    {
      lastTelemetry = millis();
      String json = makeJsonTelemetry();
      Blynk.virtualWrite(V1, json);
    }
  }

  // ----- Proses antrean event (kirim ulang nanti ke HTTP, sekarang hanya log) -----
  processQueue();
}

// ==================== Fungsi helper ====================

void setState(DeviceState next)
{
  if (g_state == next)
    return;
  g_state = next;
  Serial.print("State berubah menjadi: ");
  switch (next)
  {
  case INITIALIZING:
    Serial.println("INITIALIZING");
    break;
  case ARMED:
    Serial.println("ARMED");
    break;
  case ALARM:
    Serial.println("ALARM");
    break;
  case FAULT:
    Serial.println("FAULT");
    break;
  }
}

void ledSet(bool greenOn, bool redOn)
{
  digitalWrite(LED_GREEN_PIN, greenOn ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, redOn ? HIGH : LOW);
}

void ledPatternState()
{
  static unsigned long lastLedToggle = 0;
  static bool ledToggle = false;
  unsigned long now = millis();

  switch (g_state)
  {
  case INITIALIZING:
    // Kedip hijau lambat
    if (now - lastLedToggle >= 1000)
    {
      lastLedToggle = now;
      ledToggle = !ledToggle;
      ledSet(ledToggle, false);
    }
    break;
  case ARMED:
    ledSet(true, false); // hijau nyala, red mati
    break;
  case ALARM:
    // Kedip merah cepat
    if (now - lastLedToggle >= 300)
    {
      lastLedToggle = now;
      ledToggle = !ledToggle;
      ledSet(false, ledToggle);
    }
    break;
  case FAULT:
    // Kedip merah + hijau bersamaan
    if (now - lastLedToggle >= 500)
    {
      lastLedToggle = now;
      ledToggle = !ledToggle;
      ledSet(ledToggle, ledToggle);
    }
    break;
  }
}

float readBatteryVoltage()
{
  // GPIO34 ADC 12-bit (0-4095), referensi ~3.3V
  // Sesuaikan dengan pembagi tegangan nyata di hardware kamu
  const float ADC_REF = 3.3f;
  const float DIVIDER_RATIO = 2.0f; // contoh: pembagi 1:1, kalibrasi sesuai skema
  int adc = analogRead(BAT_ADC_PIN);
  float voltage = (adc / 4095.0f) * ADC_REF * DIVIDER_RATIO;
  return voltage;
}

int estimateSoc(float voltage)
{
  // Estimasi sangat kasar untuk Li-ion 1S (3.0V - 4.2V)
  // Ganti dengan fuel gauge (MAX17048) untuk akurasi lebih baik
  if (voltage <= 0)
    return -1;
  if (voltage >= 4.2f)
    return 100;
  if (voltage <= 3.0f)
    return 0;
  return static_cast<int>((voltage - 3.0f) / (4.2f - 3.0f) * 100.0f);
}

bool gpsFixValid()
{
  return gps.location.isValid() && gps.location.age() < 5000;
}

float haversineM(float lat1, float lon1, float lat2, float lon2)
{
  const float R = 6371000.0f; // meter
  float phi1 = lat1 * PI / 180.0f;
  float phi2 = lat2 * PI / 180.0f;
  float dphi = (lat2 - lat1) * PI / 180.0f;
  float dlambda = (lon2 - lon1) * PI / 180.0f;

  float a = sin(dphi / 2.0f) * sin(dphi / 2.0f) +
            cos(phi1) * cos(phi2) *
                sin(dlambda / 2.0f) * sin(dlambda / 2.0f);
  float c = 2.0f * atan2(sqrt(a), sqrt(1.0f - a));
  return R * c;
}

void addEvent(const char *type, const char *payload)
{
  if (g_queueCount >= MAX_EVENTS)
  {
    Serial.println("WARNING: Antrean event penuh!");
    return;
  }
  Event e;
  snprintf(e.id, sizeof(e.id), "evt-%lu", ++g_eventSeq);
  snprintf(e.type, sizeof(e.type), "%s", type);
  snprintf(e.payload, sizeof(e.payload), "%s", payload);
  e.occurredAt = millis();
  e.sent = false;
  g_queue[g_queueCount++] = e;
  Serial.print("Event ditambahkan: ");
  Serial.println(e.id);
}

void processQueue()
{
  for (int i = 0; i < g_queueCount; i++)
  {
    if (!g_queue[i].sent)
    {
      // Untuk uji Blynk: hanya cetak ke Serial. Nanti ganti ke HTTPS POST.
      Serial.print("[EVENT QUEUE] ");
      Serial.print(g_queue[i].id);
      Serial.print(" ");
      Serial.print(g_queue[i].type);
      Serial.print(" ");
      Serial.println(g_queue[i].payload);
      g_queue[i].sent = true;
    }
  }
}

String makeJsonTelemetry()
{
  char buf[256];
  float lat = gpsFixValid() ? gps.location.lat() : 0;
  float lng = gpsFixValid() ? gps.location.lng() : 0;
  float dist = 0;
  if (g_home.valid && gpsFixValid())
  {
    dist = haversineM(g_home.lat, g_home.lng, lat, lng);
  }

  snprintf(buf, sizeof(buf),
           "{\"state\":\"%s\",\"alarm\":%s,\"gps\":{\"fix\":%s,\"lat\":%.6f,\"lng\":%.6f},\"dist_home_m\":%.1f,\"mpu\":{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f},\"battery\":{\"v\":%.2f,\"soc\":%d}}",
           (g_state == ARMED) ? "ARMED" : (g_state == ALARM) ? "ALARM"
                                      : (g_state == FAULT)   ? "FAULT"
                                                             : "INIT",
           g_alarm_active ? "true" : "false",
           gpsFixValid() ? "true" : "false",
           lat, lng,
           dist,
           g_ax, g_ay, g_az,
           g_battVoltage, g_battSoc);
  return String(buf);
}