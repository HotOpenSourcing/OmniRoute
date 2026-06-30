#Requires -Version 5.1
# Fix @parcel/watcher binding manquant + démarre OmniRoute avec logs
$ErrorActionPreference = "Stop"

$root = "C:\Users\amine\OmniRoute"
$logFile = Join-Path $env:USERPROFILE "omniroute-debug.log"
Set-Location $root

Write-Host "=== [1/4] Nettoyage des bindings @parcel/watcher cassés ===" -ForegroundColor Cyan
Get-ChildItem -Path "node_modules\@parcel" -Filter "watcher*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Removing $($_.FullName)"
    Remove-Item -Recurse -Force $_.FullName
}
Remove-Item -Recurse -Force "node_modules\@parcel\watcher\build" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== [2/4] Réinstallation des bindings natifs ===" -ForegroundColor Cyan
npm install --no-save @parcel/watcher @parcel/watcher-win32-x64 2>&1 | Tee-Object -FilePath "$logFile.install"

Write-Host ""
Write-Host "=== [3/4] Vérification binding Windows ===" -ForegroundColor Cyan
$bindingPath = "node_modules\@parcel\watcher-win32-x64\native\watcher.node"
if (Test-Path $bindingPath) {
    $size = (Get-Item $bindingPath).Length
    Write-Host "  OK: $bindingPath ($size bytes)" -ForegroundColor Green
} else {
    Write-Host "  KO: binding Windows toujours absent" -ForegroundColor Red
    Write-Host "  Essaye: npm rebuild @parcel/watcher"
    exit 1
}

Write-Host ""
Write-Host "=== [4/4] Démarrage OmniRoute (logs → $logFile) ===" -ForegroundColor Cyan
Write-Host "  Ctrl+C pour arrêter`n" -ForegroundColor Yellow
$env:OMNIROUTE_DEBUG = "1"
npm run start 2>&1 | Tee-Object -FilePath $logFile
