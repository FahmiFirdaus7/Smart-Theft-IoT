// ============================================================================
// SMARTGUARD — Logika inti firmware (tanpa dependensi Arduino/ESP32)
//
// Semua keputusan yang bisa diuji tanpa hardware ada di sini:
//   - parsing command JSON dari web
//   - penyusunan payload telemetri
//   - pola LED (mode + alarm)
//   - deteksi getaran (hold 5 detik) + sudut orientasi pitch/roll
//   - konversi ADC baterai & jarak Haversine
//
// Header ini juga dipakai oleh test host (g++), jadi JANGAN memakai API
// Arduino (String, millis(), digitalWrite(), Serial, dsb).
// ============================================================================
#ifndef SMARTGUARD_CORE_H
#define SMARTGUARD_CORE_H

#include <ArduinoJson.h>

#include <math.h>
#include <stdint.h>
#include <string.h>

namespace sg
{

  // ---------------------------------------------------------------------------
  // Mode operasional
  // ---------------------------------------------------------------------------
  enum DeviceMode
  {
    MODE_ARMED,
    MODE_OVERWATCH,
    MODE_POWERSAFE
  };

  inline const char *modeToString(DeviceMode mode)
  {
    switch (mode)
    {
    case MODE_ARMED:
      return "armed";
    case MODE_POWERSAFE:
      return "powersafe";
    case MODE_OVERWATCH:
    default:
      return "overwatch";
    }
  }

  inline DeviceMode modeFromString(const char *value, DeviceMode fallback = MODE_OVERWATCH)
  {
    if (value == nullptr)
      return fallback;
    if (strcmp(value, "armed") == 0)
      return MODE_ARMED;
    if (strcmp(value, "powersafe") == 0)
      return MODE_POWERSAFE;
    if (strcmp(value, "overwatch") == 0)
      return MODE_OVERWATCH;
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Batas aman parameter dari web (mencegah nilai 0/aneh merusak aktuator)
  // ---------------------------------------------------------------------------
  constexpr float MIN_GEOFENCE_RADIUS_M = 1.0f;
  constexpr float MAX_GEOFENCE_RADIUS_M = 100000.0f;
  constexpr float MIN_SHOCK_THRESHOLD = 1.0f;
  constexpr float MAX_SHOCK_THRESHOLD = 100.0f; // MPU6050 range 8G ≈ 78.4 m/s²

  inline float clampFloat(float value, float lo, float hi)
  {
    if (value < lo)
      return lo;
    if (value > hi)
      return hi;
    return value;
  }

  // ---------------------------------------------------------------------------
  // Command dari web
  // ---------------------------------------------------------------------------
  struct WebCommand
  {
    int relay1 = 0;
    int relay2 = 0;
    bool alarm_active = false;
    DeviceMode mode = MODE_OVERWATCH;
    float geofence_radius_m = 30.0f;
    float shock_threshold = 15.0f;
    bool home_valid = false;
    bool home_updated = false;
    float home_lat = 0.0f;
    float home_lng = 0.0f;
  };

  namespace detail
  {

    inline bool readInt(const JsonVariantConst &value, int &out)
    {
      if (value.is<int>())
      {
        out = value.as<int>();
        return true;
      }
      if (value.is<bool>())
      {
        out = value.as<bool>() ? 1 : 0;
        return true;
      }
      if (value.is<float>())
      {
        out = static_cast<int>(lroundf(value.as<float>()));
        return true;
      }
      return false;
    }

    inline bool readFloat(const JsonVariantConst &value, float &out)
    {
      if (!value.is<float>() && !value.is<int>())
        return false;
      out = value.as<float>();
      return true;
    }

    inline bool readBool(const JsonVariantConst &value, bool &out)
    {
      if (value.is<bool>())
      {
        out = value.as<bool>();
        return true;
      }
      int asInt = 0;
      if (readInt(value, asInt))
      {
        out = asInt != 0;
        return true;
      }
      return false;
    }

    inline bool readString(const JsonVariantConst &value, const char *&out)
    {
      if (!value.is<const char *>())
        return false;
      out = value.as<const char *>();
      return true;
    }

    inline bool isValidCoordinate(float lat, float lng)
    {
      if (!isfinite(lat) || !isfinite(lng))
        return false;
      if (lat < -90.0f || lat > 90.0f)
        return false;
      if (lng < -180.0f || lng > 180.0f)
        return false;
      // (0, 0) bukan lokasi nyata di area proyek ini — jangan jadikan HOME.
      return !(lat == 0.0f && lng == 0.0f);
    }

  } // namespace detail

  // Parse command dari web. Hanya field yang benar-benar dikirim yang diubah
  // (server sudah menggabungkan command parsial), sehingga command
  // {alarm_active:true} tidak mereset relay/mode yang sedang aktif.
  //
  // Mengembalikan false + pesan error bila JSON tidak valid. Field yang salah
  // tipe diabaikan (tidak membuat seluruh command gagal).
  inline bool parseCommand(const char *json, WebCommand &cmd, const char **errorOut = nullptr)
  {
    if (errorOut != nullptr)
      *errorOut = nullptr;

    // Flag ini hanya berlaku untuk payload yang sedang diparse.
    cmd.home_updated = false;

    if (json == nullptr || *json == '\0')
    {
      if (errorOut != nullptr)
        *errorOut = "payload kosong";
      return false;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err)
    {
      if (errorOut != nullptr)
        *errorOut = err.c_str();
      return false;
    }

    if (!doc.is<JsonObjectConst>())
    {
      if (errorOut != nullptr)
        *errorOut = "payload bukan object JSON";
      return false;
    }

    int value = 0;

    if (detail::readInt(doc["relay1"], value))
      cmd.relay1 = value != 0 ? 1 : 0;
    if (detail::readInt(doc["relay2"], value))
      cmd.relay2 = value != 0 ? 1 : 0;

    bool flag = false;
    if (detail::readBool(doc["alarm_active"], flag))
      cmd.alarm_active = flag;

    const char *modeName = nullptr;
    if (detail::readString(doc["mode"], modeName))
      cmd.mode = modeFromString(modeName, cmd.mode);

    float number = 0.0f;
    if (detail::readFloat(doc["geofence_radius_m"], number))
      cmd.geofence_radius_m = clampFloat(number, MIN_GEOFENCE_RADIUS_M, MAX_GEOFENCE_RADIUS_M);
    if (detail::readFloat(doc["shock_threshold"], number))
      cmd.shock_threshold = clampFloat(number, MIN_SHOCK_THRESHOLD, MAX_SHOCK_THRESHOLD);

    // HOME: hanya diperbarui bila salah satu field home dikirim.
    const bool hasHomeFlag = detail::readBool(doc["home_valid"], flag);
    float lat = cmd.home_lat;
    float lng = cmd.home_lng;
    const bool hasLat = detail::readFloat(doc["home_lat"], lat);
    const bool hasLng = detail::readFloat(doc["home_lng"], lng);

    if (hasHomeFlag || hasLat || hasLng)
    {
      cmd.home_updated = true;
      const bool valid = hasHomeFlag ? flag : cmd.home_valid;
      if (valid && detail::isValidCoordinate(lat, lng))
      {
        cmd.home_valid = true;
        cmd.home_lat = lat;
        cmd.home_lng = lng;
      }
      else
      {
        cmd.home_valid = false;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Telemetri
  // ---------------------------------------------------------------------------
  inline float haversineM(float lat1, float lon1, float lat2, float lon2);

  // Sudut orientasi (derajat) dari akselerometer — dipakai untuk deteksi
  // kendaraan miring/diangkat (pose), yang TIDAK terlihat oleh deteksi magnitude
  // getaran (gravitasi selalu ~9.8 m/s² di semua orientasi).
  //   pitch: sumbu X (hidung kendaraan naik/turun)
  //   roll : sumbu Y (kendaraan miring ke kiri/kanan)
  // Hanya andal saat kendaraan relatif diam (akselerasi dinamis kecil).
  inline void accelToPitchRoll(float ax, float ay, float az, float &pitchDeg, float &rollDeg)
  {
    const float radToDeg = 57.2957795f;
    pitchDeg = atan2f(ax, sqrtf(ay * ay + az * az)) * radToDeg;
    rollDeg = atan2f(ay, az) * radToDeg;
  }

  struct HomePos
  {
    float lat = 0.0f;
    float lng = 0.0f;
    bool valid = false;
  };

  struct TelemetryInput
  {
    DeviceMode mode = MODE_OVERWATCH;
    bool gps_fix = false;
    float lat = 0.0f;
    float lng = 0.0f;
    float speed_kmh = 0.0f;
    uint32_t satellites = 0;
    float mpu_ax = 0.0f;
    float mpu_ay = 0.0f;
    float mpu_az = 0.0f;
    bool mpu_vibration = false;
    float battery_v = 0.0f;
    const WebCommand *command = nullptr;
    HomePos home;
    float geofence_radius_m = 30.0f;
  };

  // Isi JsonDocument dengan payload telemetri. Field & nama tetap sama dengan
  // kontrak dashboard (docs/Web_Testing.md §7).
  //
  // GPS belum fix -> lat/lng = null (bukan 0), supaya server tidak menganggap
  // koordinat (0,0) valid lalu memicu alarm geofence palsu.
  inline void buildTelemetry(JsonDocument &doc, const TelemetryInput &in)
  {
    doc["mode"] = modeToString(in.mode);
    doc["gps_fix"] = in.gps_fix;

    if (in.gps_fix)
    {
      doc["lat"] = in.lat;
      doc["lng"] = in.lng;
    }
    else
    {
      doc["lat"] = nullptr;
      doc["lng"] = nullptr;
    }

    doc["speed_kmh"] = in.gps_fix ? in.speed_kmh : 0.0f;
    doc["satellites"] = in.satellites;

    doc["mpu_ax"] = in.mpu_ax;
    doc["mpu_ay"] = in.mpu_ay;
    doc["mpu_az"] = in.mpu_az;

    // Orientasi (derajat, 1 desimal) — proyeksi pose kendaraan untuk web.
    float pitchDeg = 0.0f, rollDeg = 0.0f;
    accelToPitchRoll(in.mpu_ax, in.mpu_ay, in.mpu_az, pitchDeg, rollDeg);
    doc["mpu_pitch"] = lroundf(pitchDeg * 10.0f) / 10.0f;
    doc["mpu_roll"] = lroundf(rollDeg * 10.0f) / 10.0f;

    doc["mpu_vibration"] = in.mpu_vibration;
    doc["battery_v"] = in.battery_v;

    if (in.command != nullptr)
    {
      doc["relay1"] = in.command->relay1;
      doc["relay2"] = in.command->relay2;
      doc["alarm_active"] = in.command->alarm_active;
    }
    else
    {
      doc["relay1"] = 0;
      doc["relay2"] = 0;
      doc["alarm_active"] = false;
    }

    doc["geofence_radius_m"] = in.geofence_radius_m;

    if (in.gps_fix && in.home.valid)
    {
      doc["dist_home_m"] = haversineM(in.home.lat, in.home.lng, in.lat, in.lng);
    }
    else
    {
      doc["dist_home_m"] = -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Pola LED otomatis
  //   alarm_active  -> merah kedip 300 ms, hijau mati
  //   armed/overwatch -> hijau nyala tetap
  //   powersafe     -> hijau kedip 1 detik
  // ---------------------------------------------------------------------------
  struct LedState
  {
    bool green = false;
    bool red = false;
  };

  class LedController
  {
  public:
    LedState update(unsigned long nowMs, DeviceMode mode, bool alarmActive)
    {
      LedState state;

      if (alarmActive)
      {
        advance(nowMs, BLINK_ALARM_MS);
        state.red = phase_;
        state.green = false;
        return state;
      }

      if (mode == MODE_POWERSAFE)
      {
        advance(nowMs, BLINK_POWERSAFE_MS);
        state.green = phase_;
        state.red = false;
        return state;
      }

      // Mode normal: hijau tetap, fase kedip direset agar pola berikutnya
      // dimulai dari kondisi mati.
      phase_ = false;
      state.green = true;
      state.red = false;
      return state;
    }

  private:
    static constexpr unsigned long BLINK_ALARM_MS = 300UL;
    static constexpr unsigned long BLINK_POWERSAFE_MS = 1000UL;

    void advance(unsigned long nowMs, unsigned long intervalMs)
    {
      if ((unsigned long)(nowMs - lastToggleMs_) >= intervalMs)
      {
        lastToggleMs_ = nowMs;
        phase_ = !phase_;
      }
    }

    unsigned long lastToggleMs_ = 0;
    bool phase_ = false;
  };

  // ---------------------------------------------------------------------------
  // Deteksi getaran: aktif saat magnitude > threshold, bertahan holdMs setelah
  // guncangan terakhir supaya telemetri tidak "berkedip" true/false.
  // ---------------------------------------------------------------------------
  class ShockDetector
  {
  public:
    explicit ShockDetector(unsigned long holdMs = 5000UL) : holdMs_(holdMs) {}

    // Mengembalikan true hanya pada transisi diam -> getaran (untuk log sekali).
    bool update(unsigned long nowMs, float magnitude, float threshold)
    {
      bool rose = false;
      if (magnitude > threshold)
      {
        lastShockMs_ = nowMs;
        if (!active_)
        {
          active_ = true;
          rose = true;
        }
      }
      else if (active_ && (unsigned long)(nowMs - lastShockMs_) > holdMs_)
      {
        active_ = false;
      }
      return rose;
    }

    bool active() const { return active_; }
    unsigned long lastShockMs() const { return lastShockMs_; }

  private:
    unsigned long holdMs_;
    unsigned long lastShockMs_ = 0;
    bool active_ = false;
  };

  // ---------------------------------------------------------------------------
  // Utilitas
  // ---------------------------------------------------------------------------
  inline float haversineM(float lat1, float lon1, float lat2, float lon2)
  {
    const float R = 6371000.0f;
    const float degToRad = 0.017453292519943295f;
    const float phi1 = lat1 * degToRad;
    const float phi2 = lat2 * degToRad;
    const float dphi = (lat2 - lat1) * degToRad;
    const float dlambda = (lon2 - lon1) * degToRad;

    const float sinDphi = sinf(dphi / 2.0f);
    const float sinDlambda = sinf(dlambda / 2.0f);
    const float a = sinDphi * sinDphi +
                    cosf(phi1) * cosf(phi2) * sinDlambda * sinDlambda;
    const float c = 2.0f * atan2f(sqrtf(a), sqrtf(1.0f - a));
    return R * c;
  }

  // Konversi rata-rata ADC -> tegangan baterai (volt).
  inline float adcToBatteryVoltage(float adcAverage, float adcMax = 4095.0f,
                                   float adcRefV = 3.3f, float dividerRatio = 2.0f,
                                   float calibration = 1.0f)
  {
    if (!isfinite(adcAverage) || adcAverage < 0.0f)
      adcAverage = 0.0f;
    if (adcAverage > adcMax)
      adcAverage = adcMax;
    if (dividerRatio <= 0.0f)
      dividerRatio = 1.0f;
    if (calibration <= 0.0f)
      calibration = 1.0f;
    return (adcAverage / adcMax) * adcRefV * dividerRatio * calibration;
  }

} // namespace sg

#endif // SMARTGUARD_CORE_H
