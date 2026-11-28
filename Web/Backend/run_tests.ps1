# Jalankan SELURUH test backend — masing-masing di instance terisolasi
# (port + database sementara), supaya state in-memory (jendela GPS, baseline
# akselerometer) tidak bocor antar test.
#
#   .\run_tests.ps1
param([int]$Port = 8123)
$dir = $PSScriptRoot
$tests = @(
  'test_mount_calib.js',
  'test_gps_smooth.js',
  'test_accel_zero.js',
  'test_relay1.js',
  'test_motion_alarm.js',
  'test_alarm_reset.js',
  'test_mode_changed.mjs'
)
$failed = @()
foreach ($t in $tests) {
  $db = Join-Path $env:TEMP ('sg_run_' + [guid]::NewGuid().ToString('N') + '.db')
  $env:PORT = "$Port"
  $env:SMARTGUARD_DB = $db
  $env:BASE = "http://127.0.0.1:$Port"
  $srv = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  Write-Host ""
  Write-Host "=== $t ===" -ForegroundColor Cyan
  & node (Join-Path $dir $t)
  if ($LASTEXITCODE -ne 0) { $failed += $t }
  Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $db -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
}
Write-Host ""
if ($failed.Count -eq 0) {
  Write-Host "SEMUA SUITE LULUS ($($tests.Count) file)" -ForegroundColor Green
} else {
  Write-Host "GAGAL: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
