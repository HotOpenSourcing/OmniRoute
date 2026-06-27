# Script simple pour extraire les URLs Z.AI

$codeFile = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"

Write-Host "Extraction des URLs Z.AI..." -ForegroundColor Cyan

$content = Get-Content $codeFile -Raw

# Extraire toutes les URLs https://zcode.z.ai
$zcodeUrls = [regex]::Matches($content, 'https://zcode\.z\.ai[^"\s,})\]]+') |
    ForEach-Object { $_.Value } |
    Sort-Object -Unique

Write-Host "`nURLs zcode.z.ai trouvées:" -ForegroundColor Yellow
$zcodeUrls | ForEach-Object { Write-Host "  $_" }

# Extraire toutes les URLs https://chat.z.ai
$chatUrls = [regex]::Matches($content, 'https://chat\.z\.ai[^"\s,})\]]+') |
    ForEach-Object { $_.Value } |
    Sort-Object -Unique

Write-Host "`nURLs chat.z.ai trouvées:" -ForegroundColor Yellow
$chatUrls | ForEach-Object { Write-Host "  $_" }

# Extraire les chemins /api/v1/
$apiPaths = [regex]::Matches($content, '/api/v1/[^"\s,})\]]+') |
    ForEach-Object { $_.Value } |
    Where-Object { $_ -match 'zcode|plan|oauth|auth' } |
    Sort-Object -Unique

Write-Host "`nChemins API trouvés:" -ForegroundColor Yellow
$apiPaths | ForEach-Object { Write-Host "  $_" }

Write-Host "`nRecherche de patterns OAuth..." -ForegroundColor Cyan

# Chercher des patterns OAuth spécifiques
$oauthPatterns = [regex]::Matches($content, '(zaiStartPlan|bigmodelStartPlan|shouldRefreshBeforeModelRequest).{0,200}') |
    ForEach-Object {
        $text = $_.Value -replace '\s+', ' ' -replace '[^\x20-\x7E]', ''
        if ($text.Length -gt 150) { $text.Substring(0, 150) + "..." }
        else { $text }
    } |
    Select-Object -First 5 -Unique

Write-Host "`nContexte des providers 'start plan':" -ForegroundColor Yellow
$oauthPatterns | ForEach-Object { Write-Host "  $_" }

Write-Host "`nTerminé!" -ForegroundColor Green
