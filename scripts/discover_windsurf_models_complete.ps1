# Script PowerShell - Découverte Complète des Modèles Windsurf
# Date: 2026-05-04

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Decouverte Complete des Modeles Windsurf" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$windsurfPath = "C:\Users\amine\AppData\Local\Programs\Windsurf\Windsurf.exe"
$scriptsDir = "C:\Users\amine\OmniRoute\scripts"

# Etape 1: Verifier si Windsurf est installe
Write-Host "[1/4] Verification de l'installation Windsurf..." -ForegroundColor Yellow

if (Test-Path $windsurfPath) {
    Write-Host "  [OK] Windsurf trouve: $windsurfPath" -ForegroundColor Green
} else {
    Write-Host "  [ERREUR] Windsurf non trouve" -ForegroundColor Red
    exit 1
}

# Etape 2: Lancer Windsurf si necessaire
Write-Host ""
Write-Host "[2/4] Lancement de Windsurf..." -ForegroundColor Yellow

$windsurfProcess = Get-Process | Where-Object {$_.ProcessName -like "*Windsurf*"}

if ($windsurfProcess) {
    Write-Host "  [OK] Windsurf deja en cours (PID: $($windsurfProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "  [INFO] Lancement de Windsurf..." -ForegroundColor Yellow
    Start-Process $windsurfPath
    Write-Host "  [INFO] Attente du demarrage (20 secondes)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 20
}

# Etape 3: Verifier le serveur local
Write-Host ""
Write-Host "[3/4] Verification du serveur local..." -ForegroundColor Yellow

$maxRetries = 5
$retryCount = 0
$serverOk = $false

while ($retryCount -lt $maxRetries -and -not $serverOk) {
    $retryCount++
    Write-Host "  [INFO] Tentative $retryCount/$maxRetries..." -ForegroundColor Yellow

    $testConnection = Test-NetConnection -ComputerName localhost -Port 53302 -WarningAction SilentlyContinue -InformationLevel Quiet

    if ($testConnection) {
        $serverOk = $true
        Write-Host "  [OK] Serveur local accessible" -ForegroundColor Green
    } else {
        if ($retryCount -lt $maxRetries) {
            Write-Host "  [INFO] Nouvelle tentative dans 5 secondes..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
}

if (-not $serverOk) {
    Write-Host "  [ERREUR] Serveur local non accessible" -ForegroundColor Red
    exit 1
}

# Etape 4: Decouvrir les modeles
Write-Host ""
Write-Host "[4/4] Decouverte des modeles..." -ForegroundColor Yellow

Set-Location $scriptsDir

Write-Host "  [INFO] Execution de discover_all_windsurf_models.py..." -ForegroundColor Yellow
Write-Host ""

python discover_all_windsurf_models.py

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Decouverte terminee" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Fichier de resultats: windsurf_model_discovery_results.json" -ForegroundColor Yellow
