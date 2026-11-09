<#
.SYNOPSIS
    Start SMARTGUARD Web Testing — API server + Vite dev server
.DESCRIPTION
    Menjalankan Express API (port 3001) dan Vite React dev server (port 5173) secara bersamaan.
    Cocok untuk pengujian end-to-end ESP32 ↔ Web API ↔ Dashboard.
.NOTES
    File: start-dev.ps1
    Lokasi: web-testing/
    Jalankan dari folder web-testing: .\start-dev.ps1
#>

param(
    [switch]$NoClear = $false
)

# ──────────────────────────────────────────────────────────────
# Konfigurasi
# ──────────────────────────────────────────────────────────────
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$apiPort = 3001
$webPort = 5173
$apiScript = "server.js"
$nodeExe = "node"
$npmExe = "npm"

# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
function Write-Header($text) {
    Write-Host "`n$(('=' * 60))" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor White
    Write-Host "$(('=' * 60))`n" -ForegroundColor Cyan
}

function Write-Info($text) { Write-Host "  ℹ $text" -ForegroundColor Gray }
function Write-Ok($text) { Write-Host "  ✔ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ⚠ $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "  ✖ $text" -ForegroundColor Red }

function Check-Port($port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Kill-PortProcess($port) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        foreach ($conn in $connections) {
            if ($conn.State -eq 'Listen') {
                $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Warn "Port $port digunakan PID $($proc.Id) ($($proc.ProcessName)) — menghentikan..."
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Milliseconds 300
                }
            }
        }
    } catch { }
}

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

if (-not $NoClear) { Clear-Host }

Write-Header "SMARTGUARD Web Testing Launcher"
Write-Info "Project: $projectRoot"
Write-Info "API Port: $apiPort  |  Web Port: $webPort"

# Cek Node & npm
$nodeVer = & $nodeExe --version 2>$null
$npmVer = & $npmExe --version 2>$null
if (-not $nodeVer) { Write-Err "Node.js tidak ditemukan di PATH"; exit 1 }
if (-not $npmVer) { Write-Err "npm tidak ditemukan di PATH"; exit 1 }
Write-Ok "Node $nodeVer  |  npm $npmVer"

# Cek file penting
$requiredFiles = @("server.js", "package.json", "vite.config.ts")
foreach ($f in $requiredFiles) {
    $path = Join-Path $projectRoot $f
    if (Test-Path $path) { Write-Ok "Ditemukan: $f" }
    else { Write-Err "Tidak ditemukan: $f (pastikan di folder web-testing/)"; exit 1 }
}

# Cek & bersihkan port yang bentrok
Write-Info "Memeriksa port..."
if (-not (Check-Port $apiPort)) { Write-Warn "Port $apiPort tidak bebas"; Kill-PortProcess $apiPort }
else { Write-Ok "Port $apiPort bebas" }
if (-not (Check-Port $webPort)) { Write-Warn "Port $webPort tidak bebas"; Kill-PortProcess $webPort }
else { Write-Ok "Port $webPort bebas" }

# Install dependencies jika node_modules belum ada / package-lock lebih baru
$nodeModules = Join-Path $projectRoot "node_modules"
$pkgLock = Join-Path $projectRoot "package-lock.json"
$pkgJson = Join-Path $projectRoot "package.json"

$needInstall = $false
if (-not (Test-Path $nodeModules)) { $needInstall = $true; Write-Warn "node_modules tidak ada" }
elseif ((Get-Item $pkgLock).LastWriteTime -gt (Get-Item $nodeModules).LastWriteTime) { $needInstall = $true; Write-Warn "package-lock.json lebih baru dari node_modules" }

if ($needInstall) {
    Write-Info "Menjalankan npm install..."
    & $npmExe install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install gagal"; exit 1 }
    Write-Ok "Dependencies siap"
} else {
    Write-Ok "Dependencies sudah up-to-date"
}

# ──────────────────────────────────────────────────────────────
# Jalankan API + Vite secara paralel via background jobs
# ──────────────────────────────────────────────────────────────

Write-Header "Memulai Server"

$apiJob = Start-Job -Name "SMARTGUARD-API" -WorkingDirectory $projectRoot -ScriptBlock {
    param($apiScript, $nodeExe)
    & $nodeExe $apiScript
} -ArgumentList $apiScript, $nodeExe

$webJob = Start-Job -Name "SMARTGUARD-WEB" -WorkingDirectory $projectRoot -ScriptBlock {
    param($npmExe)
    & $npmExe run dev
} -ArgumentList $npmExe

# Tunggu sebentar agar server start
Start-Sleep -Seconds 3

# Cek status job
$apiState = Get-Job -Name "SMARTGUARD-API"
$webState = Get-Job -Name "SMARTGUARD-WEB"

Write-Host ""
if ($apiState.State -eq 'Running') { Write-Ok "API Server berjalan di http://localhost:$apiPort" }
else { Write-Err "API Server gagal start (State: $($apiState.State))"; Get-Job -Name "SMARTGUARD-API" | Receive-Job; exit 1 }

if ($webState.State -eq 'Running') { Write-Ok "Vite Dev Server berjalan di http://localhost:$webPort" }
else { Write-Err "Vite Dev Server gagal start (State: $($webState.State))"; Get-Job -Name "SMARTGUARD-WEB" | Receive-Job; exit 1 }

Write-Header "Siap Digunakan"
Write-Host "  📡 API Endpoint:" -ForegroundColor Cyan
Write-Host "     POST http://localhost:$apiPort/api/telemetry  (ESP32 → Web)"
Write-Host "     GET  http://localhost:$apiPort/api/telemetry  (Dashboard ← Web)"
Write-Host "     GET  http://localhost:$apiPort/api/command    (ESP32 polling)"
Write-Host "     POST http://localhost:$apiPort/api/command    (Dashboard → Web)"
Write-Host ""
Write-Host "  🌐 Dashboard:" -ForegroundColor Magenta
Write-Host "     http://localhost:$webPort"
Write-Host ""
Write-Host "  Tekan Ctrl+C untuk menghentikan keduanya" -ForegroundColor Gray
Write-Host ""

# Keep script alive & forward output
try {
    while ($true) {
        # Cek apakah job masih hidup
        $apiJob = Get-Job -Name "SMARTGUARD-API" -ErrorAction SilentlyContinue
        $webJob = Get-Job -Name "SMARTGUARD-WEB" -ErrorAction SilentlyContinue

        if (-not $apiJob -or $apiJob.State -ne 'Running') {
            Write-Err "API Server berhenti tidak terduga"
            break
        }
        if (-not $webJob -or $webJob.State -ne 'Running') {
            Write-Err "Vite Dev Server berhenti tidak terduga"
            break
        }
        Start-Sleep -Seconds 2
    }
}
finally {
    Write-Host "`n🛑 Menghentikan server..." -ForegroundColor Yellow
    Get-Job -Name "SMARTGUARD-*" -ErrorAction SilentlyContinue | Stop-Job -Force
    Get-Job -Name "SMARTGUARD-*" -ErrorAction SilentlyContinue | Remove-Job -Force
    # Pastikan proses node mati
    Kill-PortProcess $apiPort
    Kill-PortProcess $webPort
    Write-Ok "Semua server dihentikan"
}