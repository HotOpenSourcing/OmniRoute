# Script pour trouver les données ZCode et les endpoints

Write-Host "=== Recherche des données ZCode ===" -ForegroundColor Cyan

# 1. Vérifier les répertoires de données possibles
$possiblePaths = @(
    "$env:APPDATA\ZCode",
    "$env:LOCALAPPDATA\ZCode",
    "$env:USERPROFILE\.zcode",
    "$env:USERPROFILE\AppData\Roaming\zcode",
    "$env:USERPROFILE\AppData\Local\zcode"
)

Write-Host "`n1. Répertoires de données ZCode:" -ForegroundColor Yellow
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        Write-Host "  Trouvé: $path" -ForegroundColor Green
        Get-ChildItem $path -Recurse -Include *.json,*.config,*.log -ErrorAction SilentlyContinue | Select-Object FullName, Length | Format-Table -AutoSize
    } else {
        Write-Host "  Absent: $path" -ForegroundColor DarkGray
    }
}

# 2. Chercher les processus ZCode en cours
Write-Host "`n2. Processus ZCode actifs:" -ForegroundColor Yellow
$zcodeProcess = Get-Process -Name "ZCode" -ErrorAction SilentlyContinue
if ($zcodeProcess) {
    Write-Host "  ZCode est en cours d'exécution" -ForegroundColor Green
    Write-Host "    PID: $($zcodeProcess.Id)"
    Write-Host "    Chemin: $($zcodeProcess.Path)"
} else {
    Write-Host "  ZCode n'est pas en cours d'exécution" -ForegroundColor DarkGray
}

# 3. Analyser le code pour trouver les endpoints masqués
Write-Host "`n3. Recherche d'endpoints dans le code minifié:" -ForegroundColor Yellow
$codeFile = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"

if (Test-Path $codeFile) {
    Write-Host "  Analyse de $codeFile..." -ForegroundColor Cyan
    
    # Chercher les patterns d'URL spécifiques
    $patterns = @(
        'https://[^"]*zcode[^"]*',
        'https://[^"]*chat\.z\.ai[^"]*',
        '/api/v1/[^"]*plan[^"]*',
        'Bearer.*\$\{[^}]*\}'
    )
    
    foreach ($pattern in $patterns) {
        Write-Host "`n  Pattern: $pattern" -ForegroundColor Gray
        $matches = Select-String -Path $codeFile -Pattern $pattern -AllMatches | 
            Select-Object -First 5 -ExpandProperty Matches | 
            Select-Object -ExpandProperty Value -Unique
        
        if ($matches) {
            foreach ($match in $matches) {
                Write-Host "    → $match" -ForegroundColor White
            }
        }
    }
}

# 4. Vérifier les variables d'environnement
Write-Host "`n4. Variables d'environnement liées à ZCode:" -ForegroundColor Yellow
$envVars = Get-ChildItem Env: | Where-Object { $_.Name -match 'ZCODE|ZAI|GLM' }
if ($envVars) {
    $envVars | Format-Table Name, Value -AutoSize
} else {
    Write-Host "  Aucune variable d'environnement trouvée" -ForegroundColor DarkGray
}

Write-Host "`n=== Analyse terminée ===" -ForegroundColor Cyan
