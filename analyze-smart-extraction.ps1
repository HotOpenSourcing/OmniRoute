# Analyse intelligente des résultats - Extraction des découvertes clés
# Date: 2026-06-24

$analysisDir = "C:\Users\amine\OmniRoute\zai-analysis"
$zcodeBundle = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"

Write-Host "=== ANALYSE INTELLIGENTE DES DÉCOUVERTES ===" -ForegroundColor Cyan
Write-Host ""

# Fonction pour extraire des patterns spécifiques avec contexte minimal
function Extract-SmartPattern {
    param(
        [string]$Content,
        [string]$Pattern,
        [int]$ContextChars = 200
    )
    
    $matches = [regex]::Matches($Content, $Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $results = @()
    
    foreach ($match in $matches) {
        $start = [Math]::Max(0, $match.Index - $ContextChars)
        $end = [Math]::Min($Content.Length, $match.Index + $match.Length + $ContextChars)
        $context = $Content.Substring($start, $end - $start)
        
        # Nettoyer le contexte
        $context = $context -replace '\s+', ' '
        $context = $context.Trim()
        
        if ($context.Length -gt 0) {
            $results += $context
        }
    }
    
    return $results | Select-Object -Unique
}

Write-Host "[1] Chargement du bundle..." -ForegroundColor Yellow
$content = Get-Content $zcodeBundle -Raw -Encoding UTF8
Write-Host "  → Bundle chargé: $([math]::Round($content.Length / 1MB, 2)) MB" -ForegroundColor Green

Write-Host "`n[2] Extraction des mécanismes de refresh..." -ForegroundColor Yellow

# Chercher les patterns de refresh token
$refreshPatterns = @(
    'refreshToken[^}]{100,300}',
    'refresh.*token.*function',
    'expiresAt.*refresh',
    'tokenExpiry.*\d+'
)

$refreshResults = @()
foreach ($pattern in $refreshPatterns) {
    $matches = Extract-SmartPattern -Content $content -Pattern $pattern -ContextChars 150
    $refreshResults += $matches
}

Write-Host "  → $($refreshResults.Count) patterns de refresh trouvés" -ForegroundColor Green

# Afficher les 5 premiers
$refreshResults | Select-Object -First 5 | ForEach-Object {
    Write-Host "    • $($_.Substring(0, [Math]::Min(150, $_.Length)))..." -ForegroundColor Gray
}

Write-Host "`n[3] Extraction des WebSockets / SSE..." -ForegroundColor Yellow

$wsResults = Extract-SmartPattern -Content $content -Pattern 'wss?://[^"''`\s]+|WebSocket|EventSource' -ContextChars 100
Write-Host "  → $($wsResults.Count) patterns WebSocket/SSE trouvés" -ForegroundColor Green

$wsResults | Select-Object -First 3 | ForEach-Object {
    Write-Host "    • $($_.Substring(0, [Math]::Min(120, $_.Length)))..." -ForegroundColor Gray
}

Write-Host "`n[4] Extraction des variables d'environnement..." -ForegroundColor Yellow

# Pattern plus large pour les variables d'environnement
$envPattern = '(?:process\.env\[|process\.env\.|env\.)([A-Z][A-Z0-9_]{3,40})'
$envMatches = [regex]::Matches($content, $envPattern)
$envVars = @{}

foreach ($match in $envMatches) {
    $varName = $match.Groups[1].Value
    if ($varName -like 'ZCODE_*' -or $varName -like 'ZAI_*' -or $varName -like 'BIGMODEL_*' -or $varName -like 'GLM_*') {
        $envVars[$varName] = $true
    }
}

Write-Host "  → $($envVars.Keys.Count) variables d'environnement trouvées" -ForegroundColor Green
$envVars.Keys | Sort-Object | ForEach-Object {
    Write-Host "    • $_" -ForegroundColor Gray
}

Write-Host "`n[5] Extraction des endpoints de billing..." -ForegroundColor Yellow

$billingEndpoints = Extract-SmartPattern -Content $content -Pattern '/api/[^"''`\s]*(billing|quota|usage|balance)[^"''`\s]*' -ContextChars 80
Write-Host "  → $($billingEndpoints.Count) endpoints billing trouvés" -ForegroundColor Green

$billingEndpoints | Select-Object -First 8 | ForEach-Object {
    # Extraire juste l'URL
    if ($_ -match '(/api/[^\s"''`]+)') {
        Write-Host "    • $($matches[1])" -ForegroundColor Gray
    }
}

Write-Host "`n[6] Extraction des mécanismes de retry..." -ForegroundColor Yellow

$retryResults = Extract-SmartPattern -Content $content -Pattern 'retry|backoff|maxRetries.*\d+|retryDelay' -ContextChars 120
Write-Host "  → $($retryResults.Count) patterns retry trouvés" -ForegroundColor Green

# Chercher les valeurs numériques de retry
$retryNumbers = [regex]::Matches($content, '(?:maxRetries|retry.*count|retryAttempts).*?(\d+)')
$retryValues = $retryNumbers | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique

Write-Host "  → Valeurs de retry détectées: $($retryValues -join ', ')" -ForegroundColor Cyan

Write-Host "`n[7] Extraction des endpoints OAuth complets..." -ForegroundColor Yellow

# Chercher tous les endpoints OAuth avec leur contexte
$oauthEndpoints = Extract-SmartPattern -Content $content -Pattern '/oauth/[^"''`\s]+' -ContextChars 50
Write-Host "  → $($oauthEndpoints.Count) endpoints OAuth trouvés" -ForegroundColor Green

$oauthEndpoints | Select-Object -Unique | ForEach-Object {
    if ($_ -match '(/oauth/[^\s"''`]+)') {
        Write-Host "    • $($matches[1])" -ForegroundColor Gray
    }
}

Write-Host "`n[8] Extraction des domaines de fallback..." -ForegroundColor Yellow

# Chercher les domaines alternatifs
$domains = [regex]::Matches($content, 'https?://([a-z0-9.-]+\.(?:z\.ai|bigmodel\.cn|chatglm\.[a-z]+))')
$uniqueDomains = $domains | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique | Sort-Object

Write-Host "  → $($uniqueDomains.Count) domaines trouvés" -ForegroundColor Green
$uniqueDomains | ForEach-Object {
    Write-Host "    • $_" -ForegroundColor Gray
}

Write-Host "`n[9] Extraction des headers personnalisés..." -ForegroundColor Yellow

$headers = [regex]::Matches($content, '["''`](X-[A-Z][a-zA-Z0-9-]+)["''`]')
$uniqueHeaders = $headers | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique | Sort-Object

Write-Host "  → $($uniqueHeaders.Count) headers personnalisés trouvés" -ForegroundColor Green
$uniqueHeaders | Select-Object -First 15 | ForEach-Object {
    Write-Host "    • $_" -ForegroundColor Gray
}

Write-Host "`n[10] Extraction des codes d'erreur..." -ForegroundColor Yellow

# Chercher les codes d'erreur avec leur message
$errorCodes = [regex]::Matches($content, 'code["\s:]+(\d{4,5})[^}]{20,100}')
$errors = @{}

foreach ($match in $errorCodes) {
    $code = $match.Groups[1].Value
    $context = $match.Value -replace '\s+', ' '
    
    if (-not $errors.ContainsKey($code)) {
        $errors[$code] = $context
    }
}

Write-Host "  → $($errors.Keys.Count) codes d'erreur uniques trouvés" -ForegroundColor Green
$errors.Keys | Sort-Object | Select-Object -First 10 | ForEach-Object {
    Write-Host "    • Code $_" -ForegroundColor Gray
}

Write-Host "`n[11] Analyse des fonctions OAuth critiques..." -ForegroundColor Yellow

# Chercher les fonctions init, poll, exchange
$oauthFunctions = @(
    'function.*init.*oauth',
    'function.*poll.*flow',
    'function.*exchange.*token',
    'loginZCodeCli',
    'loginBigmodel'
)

$foundFunctions = @()
foreach ($pattern in $oauthFunctions) {
    $matches = [regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $foundFunctions += $matches | ForEach-Object { $_.Value }
}

Write-Host "  → $($foundFunctions.Count) fonctions OAuth trouvées" -ForegroundColor Green
$foundFunctions | Select-Object -Unique | ForEach-Object {
    Write-Host "    • $_" -ForegroundColor Gray
}

Write-Host "`n[12] Extraction des intervalles de temps..." -ForegroundColor Yellow

# Chercher les intervalles (en ms)
$intervals = [regex]::Matches($content, '(?:interval|delay|timeout).*?(\d{3,6})')
$timeValues = $intervals | ForEach-Object { 
    [int]$_.Groups[1].Value 
} | Where-Object { $_ -ge 1000 -and $_ -le 300000 } | Select-Object -Unique | Sort-Object

Write-Host "  → Intervalles détectés (ms): $($timeValues -join ', ')" -ForegroundColor Cyan

Write-Host "`n=== ANALYSE TERMINÉE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Génération du rapport détaillé..." -ForegroundColor Yellow

# Créer un résumé JSON
$summary = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    refresh_patterns = $refreshResults.Count
    websocket_patterns = $wsResults.Count
    env_vars = $envVars.Keys.Count
    billing_endpoints = $billingEndpoints.Count
    retry_values = $retryValues
    oauth_endpoints = $oauthEndpoints.Count
    domains = $uniqueDomains.Count
    custom_headers = $uniqueHeaders.Count
    error_codes = $errors.Keys.Count
    oauth_functions = $foundFunctions.Count
    intervals_ms = $timeValues
}

$summary | ConvertTo-Json -Depth 3 | Out-File "$analysisDir\analysis-summary.json" -Encoding UTF8

Write-Host "  → Résumé sauvegardé: analysis-summary.json" -ForegroundColor Green
