# Analyse approfondie du protocole OAuth Z.AI

$codeFile = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"

Write-Host "=== ANALYSE PROTOCOLE OAUTH Z.AI ===" -ForegroundColor Cyan
Write-Host "Fichier: $codeFile`n" -ForegroundColor Gray

$content = Get-Content $codeFile -Raw

# 1. Chercher les fonctions d'échange de token
Write-Host "1. FONCTIONS D'ECHANGE TOKEN:" -ForegroundColor Yellow
$tokenExchangePatterns = @(
    'function\s+\w*[Tt]oken[Ee]xchange\w*\s*\([^)]*\)\s*\{[^}]{0,500}\}',
    'exchangeCode[^(]*\([^)]*\)\s*\{[^}]{0,300}\}',
    'getAccessToken[^(]*\([^)]*\)\s*\{[^}]{0,300}\}',
    'refreshToken[^(]*\([^)]*\)\s*\{[^}]{0,300}\}'
)

foreach ($pattern in $tokenExchangePatterns) {
    $matches = [regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
        Select-Object -First 3
    
    if ($matches) {
        Write-Host "  Pattern trouvé: $($pattern.Substring(0, 30))..." -ForegroundColor Green
        foreach ($match in $matches) {
            $text = $match.Value -replace '\s+', ' ' -replace '[^\x20-\x7E]', ''
            Write-Host "    $($text.Substring(0, [Math]::Min(150, $text.Length)))..." -ForegroundColor White
        }
    }
}

# 2. Chercher les URLs complètes de token
Write-Host "`n2. URLs DE TOKEN:" -ForegroundColor Yellow
$urlPattern = '(https://[^"\s]+oauth[^"\s]+token[^"\s]*)'
$tokenUrls = [regex]::Matches($content, $urlPattern) |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique |
    Select-Object -First 10

if ($tokenUrls) {
    foreach ($url in $tokenUrls) {
        Write-Host "  $url" -ForegroundColor White
    }
} else {
    Write-Host "  Aucune URL trouvée" -ForegroundColor DarkGray
}

# 3. Chercher les patterns de requête POST
Write-Host "`n3. REQUETES POST OAUTH:" -ForegroundColor Yellow
$postPattern = 'fetch\([^,]+,\s*\{[^}]*method:\s*["\']POST["\'][^}]*oauth[^}]{0,200}\}'
$postMatches = [regex]::Matches($content, $postPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
    Select-Object -First 5

if ($postMatches) {
    foreach ($match in $postMatches) {
        $text = $match.Value -replace '\s+', ' ' -replace '[^\x20-\x7E]', ''
        Write-Host "  $($text.Substring(0, [Math]::Min(200, $text.Length)))..." -ForegroundColor White
    }
}

# 4. Chercher les patterns de body pour l'échange
Write-Host "`n4. BODY PARAMETERS:" -ForegroundColor Yellow
$bodyPatterns = @(
    'grant_type["\']?\s*:\s*["\']([^"\']+)',
    'code["\']?\s*:\s*["\']?([^"\'}\s,]+)',
    'client_id["\']?\s*:\s*["\']?([^"\'}\s,]+)',
    'code_verifier["\']?\s*:\s*["\']?([^"\'}\s,]+)',
    'redirect_uri["\']?\s*:\s*["\']([^"\']+)'
)

foreach ($pattern in $bodyPatterns) {
    $matches = [regex]::Matches($content, $pattern) |
        Select-Object -First 3
    
    if ($matches) {
        $paramName = $pattern.Split('[')[0]
        Write-Host "  Parameter: $paramName" -ForegroundColor Cyan
        foreach ($match in $matches) {
            if ($match.Groups.Count -gt 1) {
                $value = $match.Groups[1].Value
                Write-Host "    Value: $value" -ForegroundColor White
            }
        }
    }
}

# 5. Chercher les headers spécifiques
Write-Host "`n5. HEADERS OAUTH:" -ForegroundColor Yellow
$headerPatterns = @(
    '["\']Authorization["\']:\s*["\']([^"\']+)',
    '["\']X-[^"\']+["\']:\s*["\']([^"\']+)',
    '["\']Content-Type["\']:\s*["\']([^"\']+)'
)

$foundHeaders = @{}
foreach ($pattern in $headerPatterns) {
    $matches = [regex]::Matches($content, $pattern) |
        Select-Object -First 5
    
    if ($matches) {
        foreach ($match in $matches) {
            if ($match.Groups.Count -gt 1) {
                $headerName = $match.Groups[0].Value -replace '["\']', '' -replace ':\s*.*', ''
                $headerValue = $match.Groups[1].Value
                if (-not $foundHeaders.ContainsKey($headerName)) {
                    $foundHeaders[$headerName] = @()
                }
                $foundHeaders[$headerName] += $headerValue
            }
        }
    }
}

foreach ($header in $foundHeaders.Keys) {
    Write-Host "  $header" -ForegroundColor Cyan
    $foundHeaders[$header] | Select-Object -Unique | ForEach-Object {
        Write-Host "    $_" -ForegroundColor White
    }
}

# 6. Chercher les références au CAPTCHA
Write-Host "`n6. INTEGRATION CAPTCHA:" -ForegroundColor Yellow
$captchaPatterns = @(
    'captcha[^"\s]{0,50}',
    'verif[yi][^"\s]{0,30}',
    'challenge[^"\s]{0,30}'
)

$captchaRefs = @()
foreach ($pattern in $captchaPatterns) {
    $matches = [regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
        ForEach-Object { $_.Value } |
        Select-Object -Unique |
        Select-Object -First 5
    
    $captchaRefs += $matches
}

if ($captchaRefs) {
    $captchaRefs | Select-Object -Unique | ForEach-Object {
        Write-Host "  $_" -ForegroundColor White
    }
}

# 7. Chercher les flow OAuth complets
Write-Host "`n7. FLOW OAUTH COMPLET:" -ForegroundColor Yellow
$flowPattern = '(authorize[^}]{50,300}token|token[^}]{50,300}refresh)'
$flowMatches = [regex]::Matches($content, $flowPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
    Select-Object -First 3

if ($flowMatches) {
    foreach ($match in $flowMatches) {
        $text = $match.Value -replace '\s+', ' ' -replace '[^\x20-\x7E]', ''
        Write-Host "  $($text.Substring(0, [Math]::Min(250, $text.Length)))..." -ForegroundColor White
    }
}

Write-Host "`n=== ANALYSE TERMINEE ===" -ForegroundColor Cyan
Write-Host "Consultez les résultats ci-dessus pour comprendre le protocole exact." -ForegroundColor Gray
