# Test server with geofence endpoints
cd 'D:\3_Coding\6_IoT\projectAkhir_IoT\Smart-Theft-IoT\web-testing'

# Kill any existing node
taskkill /F /IM node.exe 2>$null
Start-Sleep 1

# Start server
$server = Start-Process node -ArgumentList 'server.js' -RedirectStandardOutput 'server.log' -RedirectStandardError 'server.err' -PassThru
Write-Host "Server PID: $($server.Id)"
Start-Sleep 3

# Test endpoints
try {
    # Test status
    $status = Invoke-RestMethod -Uri 'http://localhost:3001/api/status' -Method Get
    Write-Host "Status: $($status | ConvertTo-Json)"

    # Add geofence
    $gf1 = Invoke-RestMethod -Uri 'http://localhost:3001/api/geofences' -Method Post -ContentType 'application/json' -Body '{"name":"rumah","lat":-7.7915,"lng":110.3268,"radius_m":30}'
    Write-Host "Added geofence 1: $($gf1 | ConvertTo-Json)"

    $gf2 = Invoke-RestMethod -Uri 'http://localhost:3001/api/geofences' -Method Post -ContentType 'application/json' -Body '{"name":"kantor","lat":-7.7900,"lng":110.3300,"radius_m":50}'
    Write-Host "Added geofence 2: $($gf2 | ConvertTo-Json)"

    $list = Invoke-RestMethod -Uri 'http://localhost:3001/api/geofences' -Method Get
    Write-Host "Geofences: $($list | ConvertTo-Json)"

    # Test telemetry inside geofence
    $tele1 = Invoke-RestMethod -Uri 'http://localhost:3001/api/telemetry' -Method Post -ContentType 'application/json' -Body '{"lat":-7.7915,"lng":110.3268,"mode":"armed","battery_v":3.9}'
    Write-Host "Telemetry inside: $($tele1 | ConvertTo-Json)"

    $status = Invoke-RestMethod -Uri 'http://localhost:3001/api/status' -Method Get
    Write-Host "Status after inside: $($status | ConvertTo-Json)"

    # Test telemetry outside geofence (should trigger alarm)
    $tele2 = Invoke-RestMethod -Uri 'http://localhost:3001/api/telemetry' -Method Post -ContentType 'application/json' -Body '{"lat":-7.8000,"lng":110.3500,"mode":"armed","battery_v":3.9}'
    Write-Host "Telemetry outside: $($tele2 | ConvertTo-Json)"

    $status = Invoke-RestMethod -Uri 'http://localhost:3001/api/status' -Method Get
    Write-Host "Status after outside: $($status | ConvertTo-Json)"

    # ESP polling command
    $cmd = Invoke-RestMethod -Uri 'http://localhost:3001/api/command' -Method Get
    Write-Host "ESP command: $($cmd | ConvertTo-Json)"

} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Cleanup
if (Get-Process -Id $server.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $server.Id -Force
    Write-Host "Server stopped"
}