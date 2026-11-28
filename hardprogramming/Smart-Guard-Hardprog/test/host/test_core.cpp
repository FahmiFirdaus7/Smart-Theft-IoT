// ============================================================================
// Test host untuk smartguard_core.h — TANPA hardware ESP32.
//
// Build & jalankan: lihat test/run_tests.ps1 (butuh g++ + ArduinoJson).
//
// Mode CLI (dipakai test integrasi Node):
//   test_core --emit-telemetry valid|invalid   -> cetak payload telemetri JSON
//   test_core --parse-command                  -> baca command JSON dari stdin,
//                                                 cetak hasil parsing sebagai JSON
// ============================================================================
#include "smartguard_core.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>

static int g_checks = 0;
static int g_failures = 0;

static void report(bool ok, const char *expr, const char *file, int line)
{
  g_checks++;
  if (!ok)
  {
    g_failures++;
    std::printf("FAIL %s:%d  %s\n", file, line, expr);
  }
}

#define CHECK(cond) report((cond), #cond, __FILE__, __LINE__)
#define CHECK_NEAR(actual, expected, eps)                                             \
  report(std::fabs((double)(actual) - (double)(expected)) <= (eps),                   \
         #actual " ~= " #expected, __FILE__, __LINE__)

static void testModes()
{
  CHECK(std::strcmp(sg::modeToString(sg::MODE_ARMED), "armed") == 0);
  CHECK(std::strcmp(sg::modeToString(sg::MODE_OVERWATCH), "overwatch") == 0);
  CHECK(std::strcmp(sg::modeToString(sg::MODE_POWERSAFE), "powersafe") == 0);

  CHECK(sg::modeFromString("armed") == sg::MODE_ARMED);
  CHECK(sg::modeFromString("powersafe") == sg::MODE_POWERSAFE);
  CHECK(sg::modeFromString("overwatch") == sg::MODE_OVERWATCH);
  CHECK(sg::modeFromString("ARMED") == sg::MODE_OVERWATCH); // case-sensitive
  CHECK(sg::modeFromString("ngawur") == sg::MODE_OVERWATCH);
  CHECK(sg::modeFromString(nullptr) == sg::MODE_OVERWATCH);
}

static void testParseCommandFull()
{
  sg::WebCommand cmd;
  const char *error = nullptr;
  const char *json =
      "{\"relay1\":1,\"relay2\":true,\"alarm_active\":true,\"mode\":\"armed\","
      "\"geofence_radius_m\":45,\"shock_threshold\":12.5,"
      "\"home_valid\":true,\"home_lat\":-7.797,\"home_lng\":110.37,"
      "\"reason\":\"geofence_violated\",\"geofence\":\"rumah\"}";

  CHECK(sg::parseCommand(json, cmd, &error));
  CHECK(error == nullptr);
  CHECK(cmd.relay1 == 1);
  CHECK(cmd.relay2 == 1);
  CHECK(cmd.alarm_active == true);
  CHECK(cmd.mode == sg::MODE_ARMED);
  CHECK_NEAR(cmd.geofence_radius_m, 45.0f, 0.001f);
  CHECK_NEAR(cmd.shock_threshold, 12.5f, 0.001f);
  CHECK(cmd.home_updated == true);
  CHECK(cmd.home_valid == true);
  CHECK_NEAR(cmd.home_lat, -7.797f, 0.0001f);
  CHECK_NEAR(cmd.home_lng, 110.37f, 0.0001f);
}

static void testParseCommandPartial()
{
  sg::WebCommand cmd;
  cmd.relay1 = 1;
  cmd.relay2 = 1;
  cmd.mode = sg::MODE_ARMED;
  cmd.alarm_active = true;

  CHECK(sg::parseCommand("{\"alarm_active\":false}", cmd));
  CHECK(cmd.alarm_active == false);
  CHECK(cmd.relay1 == 1); // tidak boleh ikut ter-reset
  CHECK(cmd.relay2 == 1);
  CHECK(cmd.mode == sg::MODE_ARMED);
  CHECK(cmd.home_updated == false);
}

static void testParseCommandInvalid()
{
  sg::WebCommand cmd;
  const char *error = nullptr;

  CHECK(!sg::parseCommand("", cmd, &error));
  CHECK(error != nullptr);

  error = nullptr;
  CHECK(!sg::parseCommand("{bukan json}", cmd, &error));
  CHECK(error != nullptr);

  error = nullptr;
  CHECK(!sg::parseCommand("[1,2,3]", cmd, &error));
  CHECK(error != nullptr);
}

static void testParseCommandClamping()
{
  sg::WebCommand cmd;
  CHECK(sg::parseCommand("{\"shock_threshold\":0,\"geofence_radius_m\":-5}", cmd));
  CHECK_NEAR(cmd.shock_threshold, sg::MIN_SHOCK_THRESHOLD, 0.001f);
  CHECK_NEAR(cmd.geofence_radius_m, sg::MIN_GEOFENCE_RADIUS_M, 0.001f);

  CHECK(sg::parseCommand("{\"shock_threshold\":9999,\"geofence_radius_m\":1e9}", cmd));
  CHECK_NEAR(cmd.shock_threshold, sg::MAX_SHOCK_THRESHOLD, 0.001f);
  CHECK_NEAR(cmd.geofence_radius_m, sg::MAX_GEOFENCE_RADIUS_M, 0.001f);
}

static void testParseCommandHomeValidation()
{
  sg::WebCommand cmd;

  CHECK(sg::parseCommand("{\"home_valid\":true,\"home_lat\":0,\"home_lng\":0}", cmd));
  CHECK(cmd.home_updated == true);
  CHECK(cmd.home_valid == false);

  CHECK(sg::parseCommand("{\"home_valid\":true,\"home_lat\":91,\"home_lng\":110}", cmd));
  CHECK(cmd.home_valid == false);

  CHECK(sg::parseCommand("{\"home_valid\":true,\"home_lat\":-7.8,\"home_lng\":110.3}", cmd));
  CHECK(cmd.home_valid == true);

  // Command tanpa field home tidak menghapus HOME yang sudah ada.
  CHECK(sg::parseCommand("{\"relay1\":1}", cmd));
  CHECK(cmd.home_updated == false);
  CHECK(cmd.home_valid == true);
}

static void testTelemetryValid()
{
  JsonDocument doc;
  sg::TelemetryInput in;
  in.mode = sg::MODE_ARMED;
  in.gps_fix = true;
  in.lat = -7.7971f;
  in.lng = 110.3702f;
  in.speed_kmh = 1.5f;
  in.satellites = 7;
  in.battery_v = 3.9f;
  in.home.lat = -7.7970f;
  in.home.lng = 110.3700f;
  in.home.valid = true;

  sg::buildTelemetry(doc, in);

  CHECK(std::strcmp(doc["mode"] | "", "armed") == 0);
  CHECK(doc["gps_fix"].as<bool>() == true);
  CHECK_NEAR(doc["lat"].as<float>(), -7.7971f, 0.0001f);
  CHECK_NEAR(doc["lng"].as<float>(), 110.3702f, 0.0001f);
  CHECK_NEAR(doc["speed_kmh"].as<float>(), 1.5f, 0.001f);
  CHECK(doc["satellites"].as<int>() == 7);
  CHECK_NEAR(doc["dist_home_m"].as<float>(), 24.7f, 5.0f);
}

static void testTelemetryNoFix()
{
  JsonDocument doc;
  sg::TelemetryInput in;
  in.gps_fix = false;
  in.satellites = 0;
  in.home.valid = true;

  sg::buildTelemetry(doc, in);

  CHECK(doc["lat"].isNull()); // bukan 0 -> server tidak salah cek geofence
  CHECK(doc["lng"].isNull());
  CHECK(doc["dist_home_m"].as<int>() == -1);
  CHECK_NEAR(doc["speed_kmh"].as<float>(), 0.0f, 0.0001f);
}

static void testPitchRoll()
{
  float pitch = 999.0f, roll = 999.0f;

  // Datar: gravitasi penuh di Z -> pitch & roll ≈ 0
  sg::accelToPitchRoll(0.0f, 0.0f, 9.8f, pitch, roll);
  CHECK_NEAR(pitch, 0.0f, 0.1f);
  CHECK_NEAR(roll, 0.0f, 0.1f);

  // Berdiri di standar samping: miring kiri/kanan -> roll besar, pitch ≈ 0
  sg::accelToPitchRoll(0.0f, -4.9f, 8.49f, pitch, roll);
  CHECK_NEAR(pitch, 0.0f, 0.1f);
  CHECK_NEAR(roll, -30.0f, 0.5f);

  // Hidung naik 90°: gravitasi penuh di X
  sg::accelToPitchRoll(9.8f, 0.0f, 0.0f, pitch, roll);
  CHECK_NEAR(pitch, 90.0f, 0.1f);

  // Roll ke kanan positif
  sg::accelToPitchRoll(0.0f, 4.9f, 8.49f, pitch, roll);
  CHECK_NEAR(roll, 30.0f, 0.5f);
}

static void testTelemetryPoseFields()
{
  JsonDocument doc;
  sg::TelemetryInput in;
  in.mpu_ax = 0.0f;
  in.mpu_ay = -4.9f;
  in.mpu_az = 8.49f;

  sg::buildTelemetry(doc, in);

  CHECK(!doc["mpu_pitch"].isNull()); // field selalu ada
  CHECK(!doc["mpu_roll"].isNull());
  CHECK_NEAR(doc["mpu_pitch"].as<float>(), 0.0f, 0.1f);
  CHECK_NEAR(doc["mpu_roll"].as<float>(), -30.0f, 0.2f); // dibulatkan 1 desimal
}

static void testLedAlarmBlink()
{
  sg::LedController leds;

  sg::LedState s = leds.update(0, sg::MODE_ARMED, true);
  CHECK(s.red == false);
  CHECK(s.green == false);

  s = leds.update(299, sg::MODE_ARMED, true);
  CHECK(s.red == false);

  s = leds.update(300, sg::MODE_ARMED, true);
  CHECK(s.red == true); // nyala selama 300 ms, bukan 1 ms
  s = leds.update(599, sg::MODE_ARMED, true);
  CHECK(s.red == true);

  s = leds.update(600, sg::MODE_ARMED, true);
  CHECK(s.red == false);
}

static void testLedModes()
{
  sg::LedController leds;
  sg::LedState s = leds.update(12345, sg::MODE_ARMED, false);
  CHECK(s.green == true);
  CHECK(s.red == false);

  s = leds.update(12345, sg::MODE_OVERWATCH, false);
  CHECK(s.green == true);

  sg::LedController power;
  s = power.update(0, sg::MODE_POWERSAFE, false);
  CHECK(s.green == false);
  s = power.update(1000, sg::MODE_POWERSAFE, false);
  CHECK(s.green == true);
  s = power.update(1999, sg::MODE_POWERSAFE, false);
  CHECK(s.green == true);
  s = power.update(2000, sg::MODE_POWERSAFE, false);
  CHECK(s.green == false);
}

static void testShockDetector()
{
  sg::ShockDetector shock(5000);

  CHECK(shock.update(0, 9.8f, 15.0f) == false);
  CHECK(shock.active() == false);

  CHECK(shock.update(100, 20.0f, 15.0f) == true); // transisi pertama
  CHECK(shock.active() == true);

  CHECK(shock.update(200, 25.0f, 15.0f) == false); // masih getaran, bukan edge
  CHECK(shock.active() == true);

  CHECK(shock.update(5200, 9.8f, 15.0f) == false); // 5.0 s sejak getaran terakhir
  CHECK(shock.active() == true);                    // hold belum lewat

  CHECK(shock.update(5301, 9.8f, 15.0f) == false);
  CHECK(shock.active() == false);

  CHECK(shock.update(5400, 16.0f, 15.0f) == true); // edge baru
}

static void testBatteryConversion()
{
  CHECK_NEAR(sg::adcToBatteryVoltage(4095.0f), 6.6f, 0.001f);
  CHECK_NEAR(sg::adcToBatteryVoltage(2048.0f), 3.3f, 0.002f);
  CHECK_NEAR(sg::adcToBatteryVoltage(-10.0f), 0.0f, 0.0001f);
  CHECK_NEAR(sg::adcToBatteryVoltage(5000.0f), 6.6f, 0.001f);
  CHECK_NEAR(sg::adcToBatteryVoltage(2048.0f, 4095.0f, 3.3f, 2.0f, 1.05f), 3.465f, 0.005f);
}

static void testHaversine()
{
  CHECK_NEAR(sg::haversineM(-7.797f, 110.37f, -7.797f, 110.37f), 0.0f, 0.001f);

  // 1 derajat lintang ≈ 111.19 km
  const float d = sg::haversineM(0.0f, 0.0f, 1.0f, 0.0f);
  CHECK_NEAR(d, 111195.0f, 200.0f);
}

static int runUnitTests()
{
  testModes();
  testParseCommandFull();
  testParseCommandPartial();
  testParseCommandInvalid();
  testParseCommandClamping();
  testParseCommandHomeValidation();
  testTelemetryValid();
  testTelemetryNoFix();
  testPitchRoll();
  testTelemetryPoseFields();
  testLedAlarmBlink();
  testLedModes();
  testShockDetector();
  testBatteryConversion();
  testHaversine();

  std::printf("\n%d cek, %d gagal\n", g_checks, g_failures);
  if (g_failures == 0)
    std::printf("SEMUA TEST LULUS\n");
  return g_failures == 0 ? 0 : 1;
}

static int emitTelemetry(const char *mode)
{
  const std::string which = mode != nullptr ? mode : "valid";

  JsonDocument doc;
  sg::TelemetryInput in;
  in.mode = sg::MODE_ARMED;
  in.satellites = 8;
  in.battery_v = 3.91f;
  in.home.lat = -7.7970f;
  in.home.lng = 110.3700f;
  in.home.valid = true;
  in.geofence_radius_m = 30.0f;

  sg::WebCommand cmd;
  cmd.relay1 = 0;
  cmd.relay2 = 0;
  cmd.alarm_active = false;
  in.command = &cmd;

  if (which == "nofix")
  {
    in.gps_fix = false;
    in.satellites = 0;
  }
  else
  {
    in.gps_fix = true;
    in.speed_kmh = 0.2f;
    if (which == "outside")
    {
      in.lat = -7.9000f; // ~11 km dari HOME -> di luar geofence 50 m
      in.lng = 110.3700f;
    }
    else
    {
      in.lat = -7.7971f; // ~24 m dari HOME -> di dalam geofence 50 m
      in.lng = 110.3702f;
    }
  }

  sg::buildTelemetry(doc, in);

  std::string out;
  serializeJson(doc, out);
  std::printf("%s\n", out.c_str());
  return 0;
}

static int parseCommandFromStdin()
{
  std::string input((std::istreambuf_iterator<char>(std::cin)),
                    std::istreambuf_iterator<char>());

  sg::WebCommand cmd;
  const char *error = nullptr;
  const bool ok = sg::parseCommand(input.c_str(), cmd, &error);

  JsonDocument out;
  out["ok"] = ok;
  out["error"] = ok ? nullptr : (error != nullptr ? error : "unknown");
  out["relay1"] = cmd.relay1;
  out["relay2"] = cmd.relay2;
  out["alarm_active"] = cmd.alarm_active;
  out["mode"] = sg::modeToString(cmd.mode);
  out["geofence_radius_m"] = cmd.geofence_radius_m;
  out["shock_threshold"] = cmd.shock_threshold;
  out["home_updated"] = cmd.home_updated;
  out["home_valid"] = cmd.home_valid;
  out["home_lat"] = cmd.home_lat;
  out["home_lng"] = cmd.home_lng;

  std::string json;
  serializeJson(out, json);
  std::printf("%s\n", json.c_str());
  return 0; // status parse ada di field "ok" pada output JSON
}

int main(int argc, char **argv)
{
  if (argc >= 3 && std::strcmp(argv[1], "--emit-telemetry") == 0)
    return emitTelemetry(argv[2]);
  if (argc >= 2 && std::strcmp(argv[1], "--parse-command") == 0)
    return parseCommandFromStdin();
  return runUnitTests();
}
