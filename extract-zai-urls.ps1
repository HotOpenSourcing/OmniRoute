# Script pour extraire les URLs Z.AI du code ZCode

$codeFile = "C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"

Write-Host "=== Extraction des URLs Z.AI ===" -ForegroundColor Cyan

# Lire le fichier par morceaux pour éviter les problèmes de mémoire
$content = Get-Content $codeFile -Raw

# Patterns à rechercher
$patterns = @{
    "URLs zcode.z.ai" = 'https://zcode\.z\.ai[^"\s]*'
    "URLs chat.z.ai" = 'https://chat\.z\.ai[^"\s]*'
    "Endpoints /auth/" = '/auth/[^"\s]*'
    "Endpoints /oauth/" = '/oauth/[^"\s]*'
    "Endpoints API plan" = '/api/v1/[^"\s]*plan[^"\s]*'
}

foreach ($name in $patterns.Keys) {
    Write-Host "`n$name :" -ForegroundColor Yellow
    $pattern = $patterns[$name]
    
    $matches = [regex]::Matches($content, $pattern) | 
        Select-Object -ExpandProperty Value -Unique | 
        Sort-Object | 
        Select-Object -First 10
    
    if ($matches) {
        foreach ($match in $matches) {
            Write-Host "  $match" -ForegroundColor White
        }
    } else {
        Write-Host "  Aucun résultat" -ForegroundColor DarkGray
    }
}

Write-Host "`n=== Recherche spécifique Coding Plan ===" -ForegroundColor Cyan

# Chercher les références au "start plan" ou "coding plan"
$planPatterns = @(
    'zaiStartPlan',
    'bigmodelStartPlan',
    'zcodePlan',
    'coding.*plan'
)

foreach ($pattern in $planPatterns) {
    Write-Host "`nPattern: $pattern" -ForegroundColor Yellow
    $matches = [regex]::Matches($content, ".{50}$pattern.{50}", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) | 
        Select-Object -First 3
    
    if ($matches) {
        foreach ($match in $matches) {
            $text = $match.Value -replace '\s+', ' '
            Write-Host "  ...$text..." -ForegroundColor Gray
        }
    }
}

Write-Host "`n=== Extraction terminée ===" -ForegroundColor Cyan
