// ============================================================================
// SMARTGUARD v5.1.1 — Firmware "Dumb Device" + 3 Mode Operasional
// LED otomatis berdasarkan mode/alarm, hanya 2 Relay yang dikontrol via Blynk
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

char ssid[] = WIFI_SSID;
char pass[] = WIFI_PASSWORD;

static const int GPS_RX_PIN = 16;
static const int GPS_TX_PIN = 17;
static const uint32_t GPS_BAUD = 9600;

static const int MPU_SDA = 21;
static const int MPU_SCL = 22;

static const int RELAY1_PIN = 32;   // Active-LOW (V3)
static const int RELAY2_PIN = 33;   // Active-LOW, blink 500 ms (V4)

static const int LED_GREEN_PIN = 25;
static const int LED_RED_PIN = 26;

static const int BAT_ADC_PIN = 34;

enum DeviceMode { MODE_ARMED, MODE_OVERWATCH, MODE_POWERSAFE };
DeviceMode g_mode = MODE_OVERWATCH;

struct HomePos { float lat = 0; float lng = 0; bool valid = false; };
HomePos g_home;
float g_geofenceRadiusM = 30.0f;

Adafruit_MPU6050 mpu;
bool g_mpu_ok = false;
unsigned long lastMpuTime = 0;
const unsigned long MPU_INTERVAL = 100;
float g_ax = 0, g_ay = 0, g_az = 0;
float g_shockThreshold = 15.0f;
bool g_mpuVibration = false;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
unsigned long lastGpsLogTime = 0;
const unsigned long GPS_LOG_INTERVAL = 5000;

bool g_relay2State = false;
unsigned long lastRelay2Toggle = 0;
const unsigned long RELAY2_INTERVAL = 500;

struct WebCommand {
  int relay1 = 0;
  int relay2 = 0;
  bool alarm_active = false;
  String mode = "overwatch";
  float geofence_radius_m = 30.0f;
  float shock_threshold = 15.0f;
  bool home_valid = false;
  float home_lat = 0;
  float home_lng = 0;
};
WebCommand g_cmd;

float g_battVoltage = 0.0f;
unsigned long lastBattTime = 0;
const unsigned long BATT_INTERVAL = 30000;

float haversineM(float lat1, float lon1, float lat2, float lon2) {
  const float R = 6371000.0f;
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

bool gpsFixValid() {
  return gps.location.isValid() && gps.location.age() < 5000;
}

float readBatteryVoltage() {
  const float ADC_REF = 3.3f;
  const float DIVIDER_RATIO = 2.0f;
  int adc = analogRead(BAT_ADC_PIN);
  return (adc / 4095.0f) * ADC_REF * DIVIDER_RATIO;
}

void parseWebCommand(String jsonStr) {
  StaticJsonDocument<300> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) {
    Serial.print("Parse perintah web gagal: ");
    Serial.println(err.c_str());
    return;
  }

  g_cmd.relay1 = doc["relay1"] | 0;
  g_cmd.relay2 = doc["relay2"] | 0;
  g_cmd.alarm_active = doc["alarm_active"] | false;

  String m = doc["mode"] | "overwatch";
  if (m == "armed") g_mode = MODE_ARMED;
  else if (m == "overwatch") g_mode = MODE_OVERWATCH;
  else if (m == "powersafe") g_mode = MODE_POWERSAFE;
  g_cmd.mode = m;

  g_cmd.geofence_radius_m = doc["geofence_radius_m"] | 30.0f;
  g_cmd.shock_threshold = doc["shock_threshold"] | 15.0f;
  g_cmd.home_valid = doc["home_valid"] | false;
  g_cmd.home_lat = doc["home_lat"] | 0;
  g_cmd.home_lng = doc["home_lng"] | 0;

  if (g_cmd.home_valid) {
    g_home.lat = g_cmd.home_lat;
    g_home.lng = g_cmd.home_lng;
    g_home.valid = true;
  }

  g_geofenceRadiusM = g_cmd.geofence_radius_m;
  g_shockThreshold = g_cmd.shock_threshold;

  Serial.println("Perintah dari web diterima:");
  serializeJson(doc, Serial);
  Serial.println("Mode aktif: " + g_cmd.mode);
}

BLYNK_WRITE(V2) {
  String cmd = param.asString();
  parseWebCommand(cmd);
}

BLYNK_WRITE(V3) {
  g_cmd.relay1 = param.asInt();
}

BLYNK_WRITE(V4) {
  g_cmd.relay2 = param.asInt();
}

BLYNK_WRITE(V7) {
  String m = param.asString();
  if (m == "armed") g_mode = MODE_ARMED;
  else if (m == "overwatch") g_mode = MODE_OVERWATCH;
  else if (m == "powersafe") g_mode = MODE_POWERSAFE;
  g_cmd.mode = m;
  Serial.println("Mode diubah via V7: " + g_cmd.mode);
}

BLYNK_CONNECTED() {
  Serial.println("Blynk terhubung");
  Blynk.virtualWrite(V2, "{}");
}

BLYNK_DISCONNECTED() {
  Serial.println("Blynk terputus");
}

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(BAT_ADC_PIN, INPUT);

  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  Serial.print("Menghubungkan WiFi");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi terhubung: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi gagal terhubung");
  }

  Wire.begin(MPU_SDA, MPU_SCL);
  if (!mpu.begin(0x68)) {
    Serial.println("MPU6050 tidak ditemukan");
    g_mpu_ok = false;
  } else {
    g_mpu_ok = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("MPU6050 siap");
  }

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Blynk.config(BLYNK_AUTH_TOKEN);
  if (WiFi.status() == WL_CONNECTED) {
    Blynk.connect(5000);
  }

  Serial.println("SmartGuard siap (dumb device + mode: " + g_cmd.mode + ")");
}

void loop() {
  Blynk.run();

  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (g_mpu_ok && millis() - lastMpuTime >= MPU_INTERVAL) {
    lastMpuTime = millis();

    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    g_ax = a.acceleration.x;
    g_ay = a.acceleration.y;
    g_az = a.acceleration.z;

    float magnitude = sqrt(g_ax * g_ax + g_ay * g_ay + g_az * g_az);

    if (g_mode == MODE_POWERSAFE) {
      if (magnitude > g_shockThreshold) {
        if (!g_mpuVibration) {
          g_mpuVibration = true;
          Serial.println("📳 POWERSAFE: Getaran terdeteksi, GPS diaktifkan");
        }
      }
    }

    if (g_mode == MODE_ARMED && magnitude > g_shockThreshold) {
      Serial.println("⚠️ ARMED: Guncangan terdeteksi (mag " + String(magnitude, 2) + ")");
    }
  }

  if (g_mode == MODE_ARMED && g_home.valid && gpsFixValid()) {
    float dist = haversineM(
      g_home.lat, g_home.lng,
      gps.location.lat(), gps.location.lng()
    );
    if (dist > g_geofenceRadiusM) {
      g_cmd.alarm_active = true;
      Serial.print("🚨 ARMED: Geofence terlampaui! Jarak: ");
      Serial.print(dist);
      Serial.println(" m");
    }
  }

  if (millis() - lastGpsLogTime > GPS_LOG_INTERVAL) {
    lastGpsLogTime = millis();
    Serial.print("GPS fix: ");
    Serial.println(gpsFixValid() ? "VALID" : "BELUM VALID");
  }

  if (millis() - lastBattTime >= BATT_INTERVAL) {
    lastBattTime = millis();
    g_battVoltage = readBatteryVoltage();
    Serial.print("Baterai: ");
    Serial.print(g_battVoltage, 2);
    Serial.println(" V");
  }

  // --- LED otomatis berdasarkan mode & alarm (TIDAK ada switch Blynk) ---
  static unsigned long lastLedToggle = 0;
  static bool ledToggle = false;
  unsigned long now = millis();

  bool greenOn = false;
  bool redOn = false;

  if (g_cmd.alarm_active) {
    if (now - lastLedToggle >= 300) {
      lastLedToggle = now;
      ledToggle = !ledToggle;
      redOn = ledToggle;
      greenOn = false;
    }
  } else {
    switch (g_mode) {
      case MODE_ARMED:
        greenOn = true;
        redOn = false;
        break;
      case MODE_OVERWATCH:
        greenOn = true;
        redOn = false;
        break;
      case MODE_POWERSAFE:
        if (now - lastLedToggle >= 1000) {
          lastLedToggle = now;
          ledToggle = !ledToggle;
          greenOn = ledToggle;
          redOn = false;
        }
        break;
    }
  }

  digitalWrite(LED_GREEN_PIN, greenOn ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, redOn ? HIGH : LOW);

  // --- Relay 1 Active-LOW (dari Blynk V3) ---
  digitalWrite(RELAY1_PIN, g_cmd.relay1 == 1 ? LOW : HIGH);

  // --- Relay 2 blink 500 ms (dari Blynk V4) ---
  if (g_cmd.relay2 == 1) {
    if (millis() - lastRelay2Toggle >= RELAY2_INTERVAL) {
      lastRelay2Toggle = millis();
      g_relay2State = !g_relay2State;
      digitalWrite(RELAY2_PIN, g_relay2State ? LOW : HIGH);
    }
  } else {
    g_relay2State = false;
    digitalWrite(RELAY2_PIN, HIGH);
  }

  // --- Telemetri ke V1 ---
  static unsigned long lastTelemetry = 0;
  if (millis() - lastTelemetry >= 3000) {
    lastTelemetry = millis();

    StaticJsonDocument<350> tele;
    tele["mode"] = g_cmd.mode;
    tele["gps_fix"] = gpsFixValid();
    tele["lat"] = gpsFixValid() ? gps.location.lat() : 0;
    tele["lng"] = gpsFixValid() ? gps.location.lng() : 0;
    tele["speed_kmh"] = gps.speed.kmph();
    tele["satellites"] = gps.satellites.value();
    tele["mpu_ax"] = g_ax;
    tele["mpu_ay"] = g_ay;
    tele["mpu_az"] = g_az;
    tele["mpu_vibration"] = g_mpuVibration;
    tele["battery_v"] = g_battVoltage;
    tele["relay1"] = g_cmd.relay1;
    tele["relay2"] = g_cmd.relay2;
    tele["alarm_active"] = g_cmd.alarm_active;
    tele["geofence_radius_m"] = g_geofenceRadiusM;
    if (g_home.valid && gpsFixValid()) {
      tele["dist_home_m"] = haversineM(g_home.lat, g_home.lng, gps.location.lat(), gps.location.lng());
    } else {
      tele["dist_home_m"] = -1;
    }

    String out;
    serializeJson(tele, out);
    Blynk.virtualWrite(V1, out);
    Serial.println("Telemetri: " + out);
  }

  // --- Feedback ke Blynk (hanya relay, jarak, baterai, GPS) ---
  Blynk.virtualWrite(V3, g_cmd.relay1);
  Blynk.virtualWrite(V4, g_cmd.relay2);
  Blynk.virtualWrite(V8, (g_home.valid && gpsFixValid())
    ? haversineM(g_home.lat, g_home.lng, gps.location.lat(), gps.location.lng())
    : -1);
  Blynk.virtualWrite(V9, g_battVoltage);
  Blynk.virtualWrite(V10, gpsFixValid() ? 1 : 0);
}