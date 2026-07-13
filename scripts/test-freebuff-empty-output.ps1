# Test script for Freebuff empty-output error handling
# This script helps verify that the error detection and fallback logic works correctly

param(
    [string]$OmniRouteUrl = "http://localhost:3000",
    [string]$ApiKey = $env:OMNIROUTE_API_KEY,
    [string]$FreebuffModel = "freebuff/claude-sonnet-4",
    [string]$FallbackModel = "anthropic/claude-sonnet-4-20250514"
)

Write-Host "=== Freebuff Empty-Output Error Test ===" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
if (-not $ApiKey) {
    Write-Host "Error: OMNIROUTE_API_KEY not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:OMNIROUTE_API_KEY='your-key'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Prerequisites:" -ForegroundColor Green
Write-Host "  - OmniRoute URL: $OmniRouteUrl"
Write-Host "  - API Key: $(if ($ApiKey.Length -gt 10) { $ApiKey.Substring(0,10) + '...' } else { 'set' })"
Write-Host "  - Freebuff Model: $FreebuffModel"
Write-Host "  - Fallback Model: $FallbackModel"
Write-Host ""

# Enable debug mode
Write-Host "Enabling FREEBUFF_DEBUG mode..." -ForegroundColor Yellow
$env:FREEBUFF_DEBUG = "1"
Write-Host ""

# Test 1: Single Freebuff request (should fail gracefully)
Write-Host "Test 1: Single Freebuff Request" -ForegroundColor Cyan
Write-Host "Testing a request that triggers empty-output error..."
Write-Host ""

$body1 = @{
    model = $FreebuffModel
    messages = @(
        @{
            role = "user"
            content = "Say hello"
        }
    )
    stream = $false
} | ConvertTo-Json -Depth 10

try {
    $response1 = Invoke-RestMethod -Uri "$OmniRouteUrl/v1/chat/completions" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $ApiKey"
            "Content-Type" = "application/json"
        } `
        -Body $body1 `
        -ErrorAction Stop

    Write-Host "✓ Request succeeded (unexpected)" -ForegroundColor Yellow
    Write-Host "Response: $($response1 | ConvertTo-Json -Depth 3)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorBody = $_.ErrorDetails.Message

    if ($statusCode -eq 502 -and $errorBody -match "empty_output") {
        Write-Host "✓ Correctly returned 502 with empty_output error" -ForegroundColor Green
        Write-Host "Error details: $errorBody"
    } else {
        Write-Host "✗ Unexpected error: $statusCode" -ForegroundColor Red
        Write-Host "Error body: $errorBody"
    }
}

Write-Host ""
Write-Host "---" -ForegroundColor Gray
Write-Host ""

# Test 2: Combo with fallback (should succeed via fallback)
Write-Host "Test 2: Combo Request with Fallback" -ForegroundColor Cyan
Write-Host "Testing combo routing: Freebuff → Fallback provider..."
Write-Host ""

# First, create a combo via API
$comboBody = @{
    name = "test-freebuff-fallback"
    strategy = "priority"
    targets = @(
        @{
            provider = "freebuff"
            model = "claude-sonnet-4"
        },
        @{
            provider = "anthropic"
            model = "claude-sonnet-4-20250514"
        }
    )
} | ConvertTo-Json -Depth 10

Write-Host "Creating test combo..." -ForegroundColor Yellow
try {
    $combo = Invoke-RestMethod -Uri "$OmniRouteUrl/api/combos" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $ApiKey"
            "Content-Type" = "application/json"
        } `
        -Body $comboBody `
        -ErrorAction Stop

    $comboId = $combo.id
    Write-Host "✓ Combo created: $comboId" -ForegroundColor Green
} catch {
    Write-Host "Note: Combo creation failed (might already exist)" -ForegroundColor Yellow
    Write-Host "Using direct combo name instead..."
    $comboId = "test-freebuff-fallback"
}

Write-Host ""

# Make request with combo
$body2 = @{
    model = "combo:$comboId"
    messages = @(
        @{
            role = "user"
            content = "Say hello"
        }
    )
    stream = $false
} | ConvertTo-Json -Depth 10

Write-Host "Sending chat completion request..." -ForegroundColor Yellow
try {
    $response2 = Invoke-RestMethod -Uri "$OmniRouteUrl/v1/chat/completions" `
        -Method POST `
        -Headers @{
            "Authorization" = "Bearer $ApiKey"
            "Content-Type" = "application/json"
        } `
        -Body $body2 `
        -ErrorAction Stop

    Write-Host "✓ Request succeeded via fallback" -ForegroundColor Green
    Write-Host "Model used: $($response2.model)"
    Write-Host "Response preview: $($response2.choices[0].message.content.Substring(0, [Math]::Min(100, $response2.choices[0].message.content.Length)))..."

    if ($response2.model -match "anthropic") {
        Write-Host "✓✓ Correctly fell back to Anthropic" -ForegroundColor Green
    } else {
        Write-Host "⚠ Did not use expected fallback model" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Combo request failed" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "---" -ForegroundColor Gray
Write-Host ""

# Summary
Write-Host "Test Summary:" -ForegroundColor Cyan
Write-Host "  1. Single Freebuff request → Should return 502 with empty_output"
Write-Host "  2. Combo with fallback → Should succeed via Anthropic"
Write-Host ""
Write-Host "Check the OmniRoute logs for:" -ForegroundColor Yellow
Write-Host "  - [FREEBUFF_PEEK] detected empty-output error early"
Write-Host "  - No retry loop attempts"
Write-Host "  - Immediate fallback to next target"
Write-Host ""
Write-Host "To view detailed logs, run OmniRoute with:" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor Gray
