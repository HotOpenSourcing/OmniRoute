# Script PowerShell - Découverte COMPLÈTE de TOUS les Modèles Windsurf
# Inclut les modèles cachés comme gpt-5.5
# Date: 2026-05-04

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DECOUVERTE COMPLETE - TOUS LES MODELES" -ForegroundColor Cyan
Write-Host "Inclut: gpt-5.5, claude-4, et autres" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$windsurfPath = "C:\Users\amine\AppData\Local\Programs\Windsurf\Windsurf.exe"
$scriptsDir = "C:\Users\amine\OmniRoute\scripts"

# Etape 1: Verifier Windsurf
Write-Host "[1/4] Verification de Windsurf..." -ForegroundColor Yellow

if (-not (Test-Path $windsurfPath)) {
    Write-Host "  [ERREUR] Windsurf non trouve" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Windsurf trouve" -ForegroundColor Green

# Etape 2: Lancer Windsurf
Write-Host ""
Write-Host "[2/4] Lancement de Windsurf..." -ForegroundColor Yellow

$windsurfProcess = Get-Process | Where-Object {$_.ProcessName -like "*Windsurf*"}

if ($windsurfProcess) {
    Write-Host "  [OK] Windsurf deja lance (PID: $($windsurfProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "  [INFO] Demarrage de Windsurf..." -ForegroundColor Yellow
    Start-Process $windsurfPath
    Write-Host "  [INFO] Attente du demarrage (20 secondes)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 20
}

# Etape 3: Verifier le serveur
Write-Host ""
Write-Host "[3/4] Verification du serveur local..." -ForegroundColor Yellow

$maxRetries = 5
$retryCount = 0
$serverOk = $false

while ($retryCount -lt $maxRetries -and -not $serverOk) {
    $retryCount++
    Write-Host "  [INFO] Tentative $retryCount/$maxRetries..." -ForegroundColor Yellow

    # Detect port dynamically
    $portDetect = python detect_windsurf_port.py 2>&1 | Select-String "Windsurf port: (\d+)"
    if ($portDetect) {
        $port = [int]$portDetect.Matches.Groups[1].Value
    } else {
        $port = 51834
    }

    Write-Host "  [INFO] Testing port $port..." -ForegroundColor Yellow
    $testConnection = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet

    if ($testConnection) {
        $serverOk = $true
        Write-Host "  [OK] Serveur accessible sur localhost:$port" -ForegroundColor Green
    } else {
        if ($retryCount -lt $maxRetries) {
            Write-Host "  [INFO] Nouvelle tentative dans 5 secondes..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
}

if (-not $serverOk) {
    Write-Host "  [ERREUR] Serveur non accessible apres $maxRetries tentatives" -ForegroundColor Red
    Write-Host ""
    Write-Host "Solutions:" -ForegroundColor Yellow
    Write-Host "  1. Attendre quelques secondes de plus" -ForegroundColor Yellow
    Write-Host "  2. Relancer Windsurf manuellement" -ForegroundColor Yellow
    Write-Host "  3. Verifier qu'aucun firewall ne bloque le port 53302" -ForegroundColor Yellow
    exit 1
}

# Etape 4: Decouvrir TOUS les modeles
Write-Host ""
Write-Host "[4/4] Decouverte de TOUS les modeles..." -ForegroundColor Yellow
Write-Host "  [INFO] Test de 40+ modeles incluant gpt-5.5, claude-4, etc." -ForegroundColor Yellow
Write-Host ""

Set-Location $scriptsDir

python discover_all_models_complete.py

$exitCode = $LASTEXITCODE

# Afficher les resultats
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DECOUVERTE TERMINEE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$resultsFile = "windsurf_complete_model_discovery.json"

if (Test-Path $resultsFile) {
    Write-Host "[OK] Fichier de resultats cree: $resultsFile" -ForegroundColor Green

    # Lire et afficher le resume
    $results = Get-Content $resultsFile | ConvertFrom-Json

    Write-Host ""
    Write-Host "RESUME:" -ForegroundColor Cyan
    Write-Host "  Total modeles decouverts: $($results.total_discovered)" -ForegroundColor White
    Write-Host "  Modeles fonctionnels: $($results.working_models.Count)" -ForegroundColor Green
    Write-Host "  Modeles statut inconnu: $($results.unknown_models.Count)" -ForegroundColor Yellow
    Write-Host "  Modeles non trouves: $($results.not_found_models.Count)" -ForegroundColor Red
    Write-Host ""

    if ($results.working_models.Count -gt 0) {
        Write-Host "MODELES FONCTIONNELS (Status 200):" -ForegroundColor Green
        foreach ($model in $results.working_models) {
            Write-Host "  - $model" -ForegroundColor Green
        }
        Write-Host ""
    }

    if ($results.unknown_models.Count -gt 0) {
        Write-Host "MODELES STATUT INCONNU (peuvent fonctionner):" -ForegroundColor Yellow
        foreach ($model in $results.unknown_models) {
            Write-Host "  - $model" -ForegroundColor Yellow
        }
        Write-Host ""
    }

    # Verifier si gpt-5.5 a ete trouve
    if ($results.working_models -contains "gpt-5.5") {
        Write-Host "[SPECIAL] gpt-5.5 TROUVE et FONCTIONNEL!" -ForegroundColor Magenta
    } elseif ($results.unknown_models -contains "gpt-5.5") {
        Write-Host "[SPECIAL] gpt-5.5 TROUVE (statut inconnu)" -ForegroundColor Magenta
    } elseif ($results.not_found_models -contains "gpt-5.5") {
        Write-Host "[INFO] gpt-5.5 NON TROUVE dans Windsurf" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Fichier complet: $scriptsDir\$resultsFile" -ForegroundColor Cyan

} else {
    Write-Host "[ERREUR] Fichier de resultats non trouve" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

exit $exitCode
