// ============================================================================
// SMARTGUARD v5.1 — Firmware "Dumb Device" (Sensor + Aktuator saja)
// Logika utama di WEB, ESP32 hanya feed data + execute perintah web
// Target: ESP32 DevKit V1, uji pakai Blynk
// Referensi: docs/SMARTGUARD_Core_v5.1_Clean.md
// ============================================================================

#include "config.h"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <BlynkSimpleEsp32.h>
#include <ArduinoJson.h>

// --------------------------- WiFi ---------------------------
char ssid[] = WIFI_SSID;
char pass[] = WIFI_PASSWORD;

// --------------------------- Pin mapping (v5.1 bab 4.2) ---------------------------
static const int GPS_RX_PIN = 16; // GPIO16 = UART2 RX (dari GPS TX)
static const int GPS_TX_PIN = 17; // GPIO17 = UART2 TX (ke GPS RX)
static const uint32_t GPS_BAUD = 9600;

static const int MPU_SDA = 21;
static const int MPU_SCL = 22;

static const int RELAY1_PIN = 32; // Active-LOW (V3)
static const int RELAY2_PIN = 33; // Active-LOW, blink 500 ms (V4)

// LED per spesifikasi v5.1: hijau normal, merah alarm (sesuaikan papan kamu)
static const int LED_GREEN_PIN = 25;
static const int LED_RED_PIN = 26;

// Baterai ADC (GPIO34 input-only, pembagi tegangan eksternal wajib)
static const int BAT_ADC_PIN = 34;

// --------------------------- Blynk Virtual Pins ---------------------------
// V1 = telemetry JSON keluar (sensor mentah ke web)
// V2 = perintah JSON masuk dari web (diset oleh web)
// V3 = Relay 1 (masuk dari web)
// V4 = Relay 2 blink (masuk dari web)

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
Adafruit_MPU6050 mpu;
bool g_mpu_ok = false;

// Perintah terakhir dari web (ESP32 hanya execute, tidak buat keputusan sendiri)
struct WebCommand
{
  bool led_red = false;
  bool led_green = false;
  int relay1 = 0;            // 0 = mati, 1 = nyala
  int relay2 = 0;            // 0 = mati, 1 = nyala blink
  bool alarm_active = false; // catatan saja, aksi nyata lewat led_red/relay
};
WebCommand g_cmd;

unsigned long lastTelemetry = 0;
const unsigned long TELEMETRY_INTERVAL = 3000;
unsigned long lastRelay2Toggle = 0;
bool g_relay2State = false;

// ==================== Parsing perintah JSON dari web ====================
void parseWebCommand(String jsonStr)
{
  // Contoh JSON dari web:
  // {"led_red":true,"led_green":false,"relay1":1,"relay2":0,"alarm_active":true}
  StaticJsonDocument<200> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err)
  {
    Serial.print("Parse perintah web gagal: ");
    Serial.println(err.c_str());
    return;
  }

  g_cmd.led_red = doc["led_red"] | false;
  g_cmd.led_green = doc["led_green"] | false;
  g_cmd.relay1 = doc["relay1"] | 0;
  g_cmd.relay2 = doc["relay2"] | 0;
  g_cmd.alarm_active = doc["alarm_active"] | false;

  Serial.println("Perintah dari web diterima:");
  serializeJson(doc, Serial);
  Serial.println();
}

// ==================== BLYNK handlers ====================

// V2 — Perintah JSON dari web masuk ke sini (web menentukan state & actuate)
BLYNK_WRITE(V2)
{
  String cmd = param.asString();
  parseWebCommand(cmd);
}

// V3 — Relay 1 langsung dari web (fallback kontrol manual)
BLYNK_WRITE(V3)
{
  g_cmd.relay1 = param.asInt();
}

// V4 — Relay 2 blink langsung dari web (fallback kontrol manual)
BLYNK_WRITE(V4)
{
  g_cmd.relay2 = param.asInt();
}

BLYNK_CONNECTED()
{
  Serial.println("Blynk terhubung");
  Blynk.virtualWrite(V2, "{}");
}

BLYNK_DISCONNECTED()
{
  Serial.println("Blynk terputus");
}

// ==================== SETUP ====================
void setup()
{
  Serial.begin(115200);
  while (!Serial)
    delay(10);

  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(BAT_ADC_PIN, INPUT);

  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(RELAY1_PIN, HIGH); // Active-LOW mati
  digitalWrite(RELAY2_PIN, HIGH);

  // --- Koneksi WiFi dulu sebelum Blynk ---
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  Serial.print("Menghubungkan WiFi");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000)
  {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("\nWiFi terhubung: " + WiFi.localIP().toString());
  }
  else
  {
    Serial.println("\nWiFi gagal terhubung");
  }

  Wire.begin(MPU_SDA, MPU_SCL);
  if (!mpu.begin(0x68))
  {
    Serial.println("MPU6050 tidak ditemukan");
    g_mpu_ok = false;
  }
  else
  {
    g_mpu_ok = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("MPU6050 siap");
  }

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // --- Blynk setelah WiFi siap ---
  Blynk.config(BLYNK_AUTH_TOKEN);
  if (WiFi.status() == WL_CONNECTED)
  {
    Blynk.connect(5000); // coba konek Blynk maks 5 detik
  }

  Serial.println("SmartGuard siap (mode dumb device — web ngatur semuanya)");
}

// ==================== LOOP ====================
void loop()
{
  Blynk.run();

  // --- Baca sensor mentah (feed data ke web) ---
  while (gpsSerial.available() > 0)
  {
    gps.encode(gpsSerial.read());
  }

  float ax = 0, ay = 0, az = 0;
  if (g_mpu_ok)
  {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    ax = a.acceleration.x;
    ay = a.acceleration.y;
    az = a.acceleration.z;
  }

  float batt = analogRead(BAT_ADC_PIN) * (3.3f / 4095.0f) * 2.0f;

  // --- Kirim telemetri sensor mentah ke web (V1) ---
  if (millis() - lastTelemetry >= TELEMETRY_INTERVAL)
  {
    lastTelemetry = millis();

    StaticJsonDocument<256> tele;
    tele["gps_fix"] = gps.location.isValid();
    tele["lat"] = gps.location.isValid() ? gps.location.lat() : 0;
    tele["lng"] = gps.location.isValid() ? gps.location.lng() : 0;
    tele["speed_kmh"] = gps.speed.kmph();
    tele["satellites"] = gps.satellites.value();
    tele["mpu_ax"] = ax;
    tele["mpu_ay"] = ay;
    tele["mpu_az"] = az;
    tele["battery_v"] = batt;

    // --- State aktuator (dikirim ke web agar tahu kondisi fisik perangkat) ---
    tele["led_red"] = g_cmd.led_red;
    tele["led_green"] = g_cmd.led_green;
    tele["relay1"] = g_cmd.relay1;
    tele["relay2"] = g_cmd.relay2;
    tele["alarm_active"] = g_cmd.alarm_active;

    String out;
    serializeJson(tele, out);
    Blynk.virtualWrite(V1, out);
    Serial.println("Telemetri: " + out);
  }

  // --- Execute perintah dari web (ESP32 hanya aktuator) ---
  digitalWrite(LED_RED_PIN, g_cmd.led_red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, g_cmd.led_green ? HIGH : LOW);

  // Relay 1 Active-LOW
  digitalWrite(RELAY1_PIN, g_cmd.relay1 == 1 ? LOW : HIGH);

  // Relay 2 blink 500 ms jika web nyalakan
  if (g_cmd.relay2 == 1)
  {
    if (millis() - lastRelay2Toggle >= 500)
    {
      lastRelay2Toggle = millis();
      g_relay2State = !g_relay2State;
      digitalWrite(RELAY2_PIN, g_relay2State ? LOW : HIGH);
    }
  }
  else
  {
    g_relay2State = false;
    digitalWrite(RELAY2_PIN, HIGH);
  }
}