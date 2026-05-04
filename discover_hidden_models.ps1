# Windsurf Hidden Models Discovery - One-Click Script
# ====================================================
# Date: 2026-05-04
# Purpose: Automatically load token and discover hidden models

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Windsurf Hidden Models Discovery" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Load token from .env.windsurf.local
Write-Host "[1/3] Loading authentication token..." -ForegroundColor Yellow

$envFile = ".env.windsurf.local"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: $envFile not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please create .env.windsurf.local with:" -ForegroundColor Yellow
    Write-Host "  WINDSURF_DIRECT_KEY=your-token-here" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$envContent = Get-Content $envFile -Raw

if ($envContent -match 'WINDSURF_DIRECT_KEY=([^\r\n]+)') {
    $env:WINDSURF_DIRECT_KEY = $matches[1].Trim()
    $tokenPreview = $env:WINDSURF_DIRECT_KEY.Substring(0, [Math]::Min(30, $env:WINDSURF_DIRECT_KEY.Length)) + "..."
    Write-Host "  Token loaded: $tokenPreview" -ForegroundColor Green
} else {
    Write-Host "ERROR: WINDSURF_DIRECT_KEY not found in $envFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Expected format:" -ForegroundColor Yellow
    Write-Host "  WINDSURF_DIRECT_KEY=devin-session-token`$eyJhbGc..." -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host ""

# Step 2: Check if Windsurf is running
Write-Host "[2/3] Checking Windsurf status..." -ForegroundColor Yellow

$windsurfProcess = Get-Process Windsurf -ErrorAction SilentlyContinue

if ($windsurfProcess) {
    Write-Host "  Windsurf is running (PID: $($windsurfProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Windsurf is not running" -ForegroundColor Yellow
    Write-Host "  Starting Windsurf..." -ForegroundColor Yellow

    $windsurfPath = "C:\Users\amine\AppData\Local\Programs\Windsurf\Windsurf.exe"

    if (Test-Path $windsurfPath) {
        Start-Process $windsurfPath
        Write-Host "  Waiting 10 seconds for Windsurf to start..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
        Write-Host "  Windsurf started" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Could not find Windsurf at $windsurfPath" -ForegroundColor Yellow
        Write-Host "  Continuing anyway..." -ForegroundColor Yellow
    }
}

Write-Host ""

# Step 3: Run discovery
Write-Host "[3/3] Running hidden models discovery..." -ForegroundColor Yellow
Write-Host ""

$pythonScript = "scripts\quick_test_hidden_models.py"

if (-not (Test-Path $pythonScript)) {
    Write-Host "ERROR: $pythonScript not found" -ForegroundColor Red
    exit 1
}

# Execute Python script
python $pythonScript

# Check exit code
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host "Discovery Complete!" -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host ""

    # Display results if JSON file exists
    $resultsFile = "windsurf_quick_test_results.json"

    if (Test-Path $resultsFile) {
        Write-Host "Results saved to: $resultsFile" -ForegroundColor Green
        Write-Host ""

        try {
            $results = Get-Content $resultsFile | ConvertFrom-Json

            Write-Host "Summary:" -ForegroundColor Cyan
            Write-Host "  Total tested: $($results.total_tested)" -ForegroundColor White
            Write-Host "  Available: $($results.available.Count)" -ForegroundColor Green
            Write-Host "  Not available: $($results.not_available.Count)" -ForegroundColor Gray
            Write-Host ""

            if ($results.available.Count -gt 0) {
                Write-Host "Newly discovered models:" -ForegroundColor Green
                foreach ($model in $results.available) {
                    Write-Host "  - $($model.model_uid)" -ForegroundColor Green
                }
                Write-Host ""
                Write-Host "Next steps:" -ForegroundColor Yellow
                Write-Host "  1. Test these models with actual prompts" -ForegroundColor White
                Write-Host "  2. Update windsurf_model_routing_table.json" -ForegroundColor White
                Write-Host "  3. Add to open-sse/config/windsurfModels.ts" -ForegroundColor White
            } else {
                Write-Host "No new models discovered." -ForegroundColor Yellow
                Write-Host ""
                Write-Host "This means:" -ForegroundColor White
                Write-Host "  - The 4 confirmed free models are the only ones available" -ForegroundColor Gray
                Write-Host "  - Other models require BYOK or Pro subscription" -ForegroundColor Gray
            }
        } catch {
            Write-Host "Could not parse results file" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Red
    Write-Host "Discovery Failed" -ForegroundColor Red
    Write-Host "================================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check the error messages above for details." -ForegroundColor Yellow
}

Write-Host ""
