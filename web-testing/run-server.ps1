# Run server persistently
cd 'D:\3_Coding\6_IoT\projectAkhir_IoT\Smart-Theft-IoT\web-testing'

$server = Start-Process node -ArgumentList 'server.js' -RedirectStandardOutput 'server.log' -RedirectStandardError 'server.err' -PassThru
Start-Sleep 3
Write-Host "Server PID: $($server.Id)"
Write-Host "Server started. Press Ctrl+C to stop."

# Keep script alive
try {
    while ($true) {
        if (-not (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)) {
            Write-Host "Server process died"
            break
        }
        Start-Sleep 2
    }
} finally {
    if (Get-Process -Id $server.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $server.Id -Force
    }
}