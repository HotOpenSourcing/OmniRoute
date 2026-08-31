# E2E test for Freebuff empty-output error handling on dev server (port 20128)
param(
    [int]$Port = 20128,
    [string]$ApiKey = ""
)

$base = "http://localhost:$Port"
Write-Host "=== Freebuff E2E Test (port $Port) ===" -ForegroundColor Cyan

$headers = @{ "Content-Type" = "application/json" }
if ($ApiKey) { $headers["Authorization"] = "Bearer $ApiKey" }

# Test 1: Freebuff single request (expect 502 empty_output or actual model output)
Write-Host ""
Write-Host "Test 1: Freebuff single request" -ForegroundColor Yellow
$body1 = @{
    model = "freebuff/claude-sonnet-4"
    messages = @(@{ role = "user"; content = "Say hello" })
    stream = $false
} | ConvertTo-Json -Depth 10

try {
    $r1 = Invoke-RestMethod -Uri "$base/v1/chat/completions" -Method POST `
        -Headers $headers -Body $body1 -TimeoutSec 90 -ErrorAction Stop
    Write-Host "OK - got response from: $($r1.model)" -ForegroundColor Green
    Write-Host "Content: $(($r1.choices[0].message.content | Out-String).Substring(0, [Math]::Min(120, ($r1.choices[0].message.content | Out-String).Length)))"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    if ($code -eq 502 -and $detail -match "empty_output") {
        Write-Host "CORRECT: 502 empty_output returned (non-retryable path works)" -ForegroundColor Green
    } elseif ($code -eq 401) {
        Write-Host "AUTH REQUIRED - need API key" -ForegroundColor Red
    } else {
        Write-Host "Returned: $code" -ForegroundColor Yellow
        Write-Host "Detail: $detail"
    }
}

# Test 2: Combo with fallback
Write-Host ""
Write-Host "Test 2: Combo with fallback (freebuff -> anthropic)" -ForegroundColor Yellow

# Try to create combo via API
$comboBody = @{
    name = "e2e-freebuff-fallback"
    strategy = "priority"
    targets = @(
        @{ provider = "freebuff"; model = "claude-sonnet-4" },
        @{ provider = "anthropic"; model = "claude-sonnet-4-20250514" }
    )
} | ConvertTo-Json -Depth 10

$comboId = $null
try {
    $c = Invoke-RestMethod -Uri "$base/api/combos" -Method POST `
        -Headers $headers -Body $comboBody -TimeoutSec 30 -ErrorAction Stop
    $comboId = $c.id
    Write-Host "Combo created: $comboId" -ForegroundColor Green
} catch {
    Write-Host "Combo create failed: $($_.Exception.Response.StatusCode.value__) - using name fallback" -ForegroundColor Yellow
    $comboId = "e2e-freebuff-fallback"
}

$body2 = @{
    model = "combo:$comboId"
    messages = @(@{ role = "user"; content = "Say hello" })
    stream = $false
} | ConvertTo-Json -Depth 10

try {
    $r2 = Invoke-RestMethod -Uri "$base/v1/chat/completions" -Method POST `
        -Headers $headers -Body $body2 -TimeoutSec 90 -ErrorAction Stop
    Write-Host "OK - combo succeeded via: $($r2.model)" -ForegroundColor Green
    if ($r2.model -match "anthropic") {
        Write-Host "FALLBACK WORKED: used Anthropic after Freebuff failure" -ForegroundColor Green
    }
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "Combo request returned: $code - $($_.ErrorDetails.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Check server logs for [FREEBUFF_PEEK] / empty_output detection." -ForegroundColor Cyan
