# Probe script: check server, auth requirement, and trigger Freebuff empty-output test
param(
    [int]$Port = 20128
)

$base = "http://localhost:$Port"
Write-Host "=== OmniRoute Freebuff Probe (port $Port) ===" -ForegroundColor Cyan

# 1. Health check
try {
    $health = Invoke-RestMethod -Uri "$base/health" -Method GET -TimeoutSec 10 -ErrorAction Stop
    Write-Host "Health: OK" -ForegroundColor Green
} catch {
    Write-Host "Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Trying root..." -ForegroundColor Yellow
    try {
        $resp = Invoke-WebRequest -Uri "$base/" -Method GET -TimeoutSec 10 -ErrorAction Stop
        Write-Host "Root status: $($resp.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "Root also failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 2. Try a chat request without API key to see if auth is required
Write-Host ""
Write-Host "Testing chat/completions without API key..." -ForegroundColor Yellow
$body = @{
    model = "freebuff/claude-sonnet-4"
    messages = @(@{ role = "user"; content = "say hi" })
    stream = $false
} | ConvertTo-Json -Depth 10

try {
    $r = Invoke-RestMethod -Uri "$base/v1/chat/completions" -Method POST `
        -ContentType "application/json" -Body $body -TimeoutSec 30 -ErrorAction Stop
    Write-Host "No-key request succeeded (auth disabled?)" -ForegroundColor Green
    Write-Host ($r | ConvertTo-Json -Depth 3 | Out-String).Substring(0, [Math]::Min(300, ($r | ConvertTo-Json -Depth 3).Length))
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    Write-Host "No-key request returned: $code" -ForegroundColor Yellow
    Write-Host "Detail: $detail"
    if ($code -eq 401) {
        Write-Host "=> Auth required. Need API key." -ForegroundColor Red
    }
}
