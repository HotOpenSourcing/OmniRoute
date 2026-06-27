# Analyse approfondie du protocole Z.AI - Mécanismes internes
# Date: 2026-06-24

$zcodeBundle = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"
$outputDir = "C:\Users\amine\OmniRoute\zai-analysis"

Write-Host "=== ANALYSE APPROFONDIE DU PROTOCOLE Z.AI ===" -ForegroundColor Cyan
Write-Host ""

# Créer le répertoire de sortie
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

# Fonction helper pour extraire le contexte
function Extract-Context {
    param(
        [string]$Pattern,
        [int]$Before = 5,
        [int]$After = 5,
        [string]$OutputFile
    )
    
    Write-Host "Recherche: $Pattern" -ForegroundColor Yellow
    $results = Select-String -Path $zcodeBundle -Pattern $Pattern -Context $Before,$After
    
    if ($results) {
        Write-Host "  → $($results.Count) occurrences trouvées" -ForegroundColor Green
        $results | Out-File "$outputDir\$OutputFile" -Encoding UTF8
        return $results.Count
    } else {
        Write-Host "  → Aucune occurrence" -ForegroundColor Gray
        return 0
    }
}

Write-Host "`n[ÉTAPE 1] Recherche des mécanismes de refresh..." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

$refreshCount = 0
$refreshCount += Extract-Context -Pattern "refresh" -OutputFile "01-refresh-all.txt"
$refreshCount += Extract-Context -Pattern "refreshToken|refreshAccessToken" -OutputFile "01-refresh-token.txt"
$refreshCount += Extract-Context -Pattern "refreshInterval|autoRefresh" -OutputFile "01-refresh-interval.txt"
$refreshCount += Extract-Context -Pattern "setInterval.*token|setTimeout.*token" -OutputFile "01-refresh-schedule.txt"
$refreshCount += Extract-Context -Pattern "tokenExpiry|expiresAt|expires_in" -OutputFile "01-token-expiry.txt"

Write-Host "`nTotal refresh patterns: $refreshCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 2] Détection WebSocket / SSE..." -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

$wsCount = 0
$wsCount += Extract-Context -Pattern "WebSocket|ws://|wss://" -OutputFile "02-websocket.txt"
$wsCount += Extract-Context -Pattern "EventSource|text/event-stream" -OutputFile "02-sse.txt"
$wsCount += Extract-Context -Pattern "socket\.io|io\.connect" -OutputFile "02-socketio.txt"
$wsCount += Extract-Context -Pattern "stream.*=.*new|streaming.*:" -OutputFile "02-streaming.txt"

Write-Host "`nTotal WebSocket/SSE patterns: $wsCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 3] Mécanismes de signature..." -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

$sigCount = 0
$sigCount += Extract-Context -Pattern "HMAC|hmac|createHmac" -OutputFile "03-hmac.txt"
$sigCount += Extract-Context -Pattern "signature|sign\(" -OutputFile "03-signature.txt"
$sigCount += Extract-Context -Pattern "nonce|timestamp" -Before 3 -After 3 -OutputFile "03-nonce-timestamp.txt"
$sigCount += Extract-Context -Pattern "X-Signature|X-Sign|X-Timestamp" -OutputFile "03-custom-headers.txt"
$sigCount += Extract-Context -Pattern "sha256|md5|createHash" -OutputFile "03-hash.txt"

Write-Host "`nTotal signature patterns: $sigCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 4] URLs de fallback et multi-domaines..." -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# Extraction de toutes les URLs
Write-Host "Extraction des URLs..." -ForegroundColor Yellow
$content = Get-Content $zcodeBundle -Raw
$urlMatches = [regex]::Matches($content, 'https?://[a-zA-Z0-9.-]+\.[a-z]{2,}[^\s"''`]*')
$urls = $urlMatches | ForEach-Object { $_.Value } | Sort-Object -Unique

Write-Host "  → $($urls.Count) URLs uniques trouvées" -ForegroundColor Green
$urls | Out-File "$outputDir\04-all-urls.txt" -Encoding UTF8

# Filtrer les domaines Z.AI
$zaiUrls = $urls | Where-Object { $_ -like '*z.ai*' -or $_ -like '*chatglm*' -or $_ -like '*bigmodel*' }
Write-Host "  → $($zaiUrls.Count) URLs Z.AI/GLM/BigModel" -ForegroundColor Green
$zaiUrls | Out-File "$outputDir\04-zai-urls.txt" -Encoding UTF8

# Chercher les variables de domaine
Extract-Context -Pattern "YOr|e8r|t8r|r8r" -Before 2 -After 2 -OutputFile "04-domain-constants.txt" | Out-Null

Write-Host "`n[ÉTAPE 5] Provisioning des clés API (Biz)..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$apiKeyCount = 0
$apiKeyCount += Extract-Context -Pattern "/api/biz/v1/organization|/projects|/api_keys" -OutputFile "05-biz-endpoints.txt"
$apiKeyCount += Extract-Context -Pattern "api_key|apikey|apiKey" -Before 3 -After 3 -OutputFile "05-apikey-all.txt"
$apiKeyCount += Extract-Context -Pattern "revoke|delete.*key|remove.*key" -OutputFile "05-key-revoke.txt"
$apiKeyCount += Extract-Context -Pattern "permission|role|scope" -Before 2 -After 2 -OutputFile "05-permissions.txt"

Write-Host "`nTotal API key patterns: $apiKeyCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 6] Variables d'environnement..." -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Extraction des variables d'environnement
Write-Host "Extraction des variables d'environnement..." -ForegroundColor Yellow
$envMatches = [regex]::Matches($content, '(?:process\.env\.|env\.)(ZCODE_|ZAI_|BIGMODEL_|GLM_)[A-Z0-9_]+')
$envVars = $envMatches | ForEach-Object { $_.Value } | Sort-Object -Unique

Write-Host "  → $($envVars.Count) variables trouvées" -ForegroundColor Green
$envVars | Out-File "$outputDir\06-env-vars.txt" -Encoding UTF8

# Chercher les valeurs par défaut
Extract-Context -Pattern "process\.env\." -Before 1 -After 1 -OutputFile "06-env-context.txt" | Out-Null

Write-Host "`n[ÉTAPE 7] Détection du plan et quotas..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$planCount = 0
$planCount += Extract-Context -Pattern "plan|tier|subscription" -Before 3 -After 3 -OutputFile "07-plan.txt"
$planCount += Extract-Context -Pattern "quota|limit|usage" -Before 3 -After 3 -OutputFile "07-quota.txt"
$planCount += Extract-Context -Pattern "isCodingPlan|planType|start.*coding" -OutputFile "07-plan-detection.txt"
$planCount += Extract-Context -Pattern "/billing|/quota|/usage" -OutputFile "07-billing-endpoints.txt"

Write-Host "`nTotal plan/quota patterns: $planCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 8] Configuration par défaut des modèles..." -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$modelCount = 0
$modelCount += Extract-Context -Pattern "temperature.*:|top_p.*:|max_tokens.*:" -OutputFile "08-model-params.txt"
$modelCount += Extract-Context -Pattern "presence_penalty|frequency_penalty" -OutputFile "08-penalties.txt"
$modelCount += Extract-Context -Pattern "defaultModel|modelDefaults|modelConfig" -OutputFile "08-model-config.txt"

Write-Host "`nTotal model config patterns: $modelCount" -ForegroundColor Magenta

Write-Host "`n[ÉTAPE 9] Gestion des erreurs et captchas..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$errorCount = 0
$errorCount += Extract-Context -Pattern "401|403|429|500|502|503" -Before 2 -After 2 -OutputFile "09-http-codes.txt"
$errorCount += Extract-Context -Pattern "retry|backoff|maxRetries" -OutputFile "09-retry.txt"
$errorCount += Extract-Context -Pattern "captcha|Captcha|CAPTCHA" -Before 3 -After 3 -OutputFile "09-captcha.txt"
$errorCount += Extract-Context -Pattern "X-Aliyun|Aliyun" -OutputFile "09-aliyun.txt"
$errorCount += Extract-Context -Pattern "InitCaptcha|VerifyCaptcha" -OutputFile "09-captcha-methods.txt"

Write-Host "`nTotal error/captcha patterns: $errorCount" -ForegroundColor Magenta

Write-Host "`n[ANALYSE COMPLÉMENTAIRE] Patterns avancés..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Tokens et authentification
Extract-Context -Pattern "bizToken|accessToken|jwt|bearer" -Before 2 -After 2 -OutputFile "10-tokens.txt" | Out-Null

# Headers personnalisés
Extract-Context -Pattern "X-[A-Z][a-zA-Z-]*" -Before 1 -After 1 -OutputFile "10-custom-headers.txt" | Out-Null

# Endpoints complets
Write-Host "Extraction des endpoints API..." -ForegroundColor Yellow
$apiMatches = [regex]::Matches($content, '/api/[a-z0-9/_-]+')
$endpoints = $apiMatches | ForEach-Object { $_.Value } | Sort-Object -Unique
Write-Host "  → $($endpoints.Count) endpoints trouvés" -ForegroundColor Green
$endpoints | Out-File "$outputDir\10-all-endpoints.txt" -Encoding UTF8

# Fonctions OAuth
Extract-Context -Pattern "function.*oauth|oauth.*function|loginZCodeCli|loginBigmodel" -Before 5 -After 10 -OutputFile "10-oauth-functions.txt" | Out-Null

Write-Host "`n=== ANALYSE TERMINÉE ===" -ForegroundColor Cyan
Write-Host "`nRésultats enregistrés dans: $outputDir" -ForegroundColor Green
Write-Host "`nFichiers générés:" -ForegroundColor Yellow
Get-ChildItem $outputDir | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 2)
    Write-Host "  - $($_.Name) ($size KB)" -ForegroundColor Gray
}

Write-Host "`n[PROCHAINE ÉTAPE]" -ForegroundColor Cyan
Write-Host "Analyser les fichiers générés pour créer le rapport ZAI_PROTOCOL_DETAILS.md" -ForegroundColor Yellow
