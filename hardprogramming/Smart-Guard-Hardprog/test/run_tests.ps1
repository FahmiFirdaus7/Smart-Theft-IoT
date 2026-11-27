# ============================================================================
# Test firmware TANPA hardware.
#
#   1. Build test host (g++) memakai smartguard_core.h yang sama dengan firmware
#   2. Jalankan unit test (parsing command, telemetri, LED, getaran, baterai)
#   3. Jalankan test integrasi ke web-testing/server.js (opsional, butuh Node)
#
# Pemakaian:
#   .\test\run_tests.ps1
#   .\test\run_tests.ps1 -SkipIntegration
# ============================================================================
param(
    [switch]$SkipIntegration
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outDir = Join-Path $projectRoot ".pio\host"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "test_core.exe"

# --- ArduinoJson (sudah ada di .pio/libdeps setelah `pio run` sekali) ---
$jsonCandidates = @(
    (Join-Path $projectRoot ".pio\libdeps\esp32doit-devkit-v1\ArduinoJson\src"),
    (Join-Path $projectRoot ".pio\libdeps\esp32doit-devkit-v1\ArduinoJson")
)
$jsonInclude = $null
foreach ($candidate in $jsonCandidates) {
    if (Test-Path (Join-Path $candidate "ArduinoJson.h")) {
        $jsonInclude = $candidate
        break
    }
}
if (-not $jsonInclude) {
    throw "ArduinoJson tidak ditemukan. Jalankan 'pio run' sekali agar .pio/libdeps terisi."
}

# --- g++ ---
$gpp = $null
$cmd = Get-Command g++ -ErrorAction SilentlyContinue
if ($cmd) {
    $gpp = $cmd.Source
} elseif (Test-Path "C:\msys64\ucrt64\bin\g++.exe") {
    $gpp = "C:\msys64\ucrt64\bin\g++.exe"
}
if (-not $gpp) {
    throw "g++ tidak ditemukan. Install MSYS2/MinGW atau tambahkan g++ ke PATH."
}

Write-Host "==> Build test host"
& $gpp -std=c++17 -O2 -Wall -Wextra "-I$jsonInclude" "-I$(Join-Path $projectRoot 'src')" `
    (Join-Path $PSScriptRoot "host\test_core.cpp") -o $exe
if ($LASTEXITCODE -ne 0) {
    throw "Kompilasi test host gagal."
}

Write-Host "==> Unit test"
& $exe
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($SkipIntegration) {
    Write-Host "==> Test integrasi dilewati (-SkipIntegration)"
    exit 0
}

# --- Integrasi ke server.js (tanpa ESP32) ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Warning "Node.js tidak ditemukan — test integrasi dilewati."
    exit 0
}

Write-Host "==> Test integrasi server.js"
$env:SG_TEST_BIN = $exe
& $node.Source (Join-Path $PSScriptRoot "integration\run_integration.mjs")
exit $LASTEXITCODE
