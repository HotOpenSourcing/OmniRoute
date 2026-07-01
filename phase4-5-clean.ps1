# Phase 4 & 5 : Decompilation et Configuration ZCode

Write-Host "Phase 4 : Decompilation partielle du bundle ZCode..." -ForegroundColor Cyan
Write-Host ""

$bundlePath = "$env:LOCALAPPDATA\Programs\ZCode\resources\glm\zcode.cjs"
$outputDir = "C:\Users\amine\OmniRoute\zai-decompiled"

# Creer le dossier de sortie
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

Write-Host "Installation de js-beautify..." -ForegroundColor Yellow
npm install -g js-beautify 2>&1 | Out-Null

Write-Host "Deminification du bundle (cela peut prendre quelques minutes)..." -ForegroundColor Yellow
$beautifiedPath = "$outputDir\zcode-beautified.js"

# Deminifier avec js-beautify
js-beautify -f $bundlePath -o $beautifiedPath --indent-size 2 --max-preserve-newlines 2

if (Test-Path $beautifiedPath) {
    $fileSize = (Get-Item $beautifiedPath).Length / 1MB
    Write-Host "Deminification terminee : $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
} else {
    Write-Host "Erreur de deminification" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Extraction des modules critiques..." -ForegroundColor Cyan

# Extraire les fonctions OAuth
Write-Host "  Extraction du module OAuth..." -ForegroundColor Yellow
Select-String -Path $beautifiedPath -Pattern "oauth|OAuth|OAUTH" -Context 5,5 | 
    Select-Object -First 500 | Out-File "$outputDir\oauth-module.txt"

# Extraire les fonctions auth
Write-Host "  Extraction des fonctions auth..." -ForegroundColor Yellow
Select-String -Path $beautifiedPath -Pattern "function.*auth|async.*auth|\.auth\(" -Context 3,3 | 
    Select-Object -First 300 | Out-File "$outputDir\auth-functions.txt"

# Extraire les appels fetch/axios
Write-Host "  Extraction des appels HTTP..." -ForegroundColor Yellow
Select-String -Path $beautifiedPath -Pattern "fetch\(|axios\.|httpClient\." -Context 2,2 | 
    Select-Object -First 500 | Out-File "$outputDir\http-calls.txt"

# Extraire les mecanismes de signature
Write-Host "  Extraction des signatures..." -ForegroundColor Yellow
Select-String -Path $beautifiedPath -Pattern "createHmac|createHash|crypto\.sign|signature" -Context 3,3 | 
    Out-File "$outputDir\signatures.txt"

# Extraire le stockage
Write-Host "  Extraction du stockage..." -ForegroundColor Yellow
Select-String -Path $beautifiedPath -Pattern "localStorage|sessionStorage|electronStore|keytar" -Context 2,2 | 
    Out-File "$outputDir\storage.txt"

Write-Host ""
Write-Host "Phase 5 : Analyse des configurations persistantes..." -ForegroundColor Cyan
Write-Host ""

# Chemins de configuration
$configPaths = @(
    "$env:USERPROFILE\.zcode\config.json",
    "$env:USERPROFILE\.zcode\v2\credentials.json",
    "$env:APPDATA\ZCode\config.json",
    "$env:APPDATA\ZCode\User\globalStorage\state.vscdb",
    "$env:LOCALAPPDATA\ZCode\config.json"
)

Write-Host "Recherche des fichiers de configuration..." -ForegroundColor Yellow
$foundConfigs = @()

foreach ($path in $configPaths) {
    if (Test-Path $path) {
        Write-Host "  Trouve: $path" -ForegroundColor Green
        $foundConfigs += $path
    }
}

if ($foundConfigs.Count -eq 0) {
    Write-Host "  Aucun fichier de configuration trouve" -ForegroundColor Yellow
    Write-Host "  Essayez de lancer ZCode et de vous connecter d'abord" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Analyse des configurations..." -ForegroundColor Cyan
    
    foreach ($config in $foundConfigs) {
        Write-Host ""
        Write-Host "  Fichier: $config" -ForegroundColor Yellow
        
        try {
            $content = Get-Content $config -Raw
            
            # Verifier si c'est du JSON
            if ($content -match "^\s*\{") {
                $json = $content | ConvertFrom-Json
                Write-Host "    Type JSON" -ForegroundColor Gray
                Write-Host "    Taille $($content.Length) octets" -ForegroundColor Gray
                
                # Chercher des tokens
                if ($content -match "token|Token|TOKEN") {
                    Write-Host "    Contient des references a token" -ForegroundColor Yellow
                }
                
                # Chercher des credentials
                if ($content -match "credential|auth|oauth") {
                    Write-Host "    Contient des credentials/auth" -ForegroundColor Yellow
                }
                
                # Sauvegarder un extrait (sans les secrets)
                $sanitized = $content -replace '"([^"]*token[^"]*)":\s*"[^"]+"', '"$1": "[REDACTED]"'
                $sanitized = $sanitized -replace '"([^"]*secret[^"]*)":\s*"[^"]+"', '"$1": "[REDACTED]"'
                $sanitized = $sanitized -replace '"([^"]*password[^"]*)":\s*"[^"]+"', '"$1": "[REDACTED]"'
                
                $sanitized | Out-File "$outputDir\config-$(Split-Path $config -Leaf)"
                Write-Host "    Extrait sauvegarde (secrets masques)" -ForegroundColor Green
            } else {
                Write-Host "    Type Binaire ou Autre" -ForegroundColor Gray
                Write-Host "    Taille $($content.Length) octets" -ForegroundColor Gray
            }
        } catch {
            Write-Host "    Erreur de lecture: $_" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "Recherche dans le registre Windows..." -ForegroundColor Cyan

$regPaths = @(
    "HKCU:\Software\ZCode",
    "HKCU:\Software\Z.AI",
    "HKLM:\Software\ZCode",
    "HKLM:\Software\Z.AI"
)

foreach ($regPath in $regPaths) {
    if (Test-Path $regPath) {
        Write-Host "  Trouve: $regPath" -ForegroundColor Green
        Get-ItemProperty $regPath | Out-File "$outputDir\registry-$(($regPath -replace ':', '') -replace '\\', '-').txt"
    }
}

Write-Host ""
Write-Host "Recherche des tokens dans Electron safeStorage..." -ForegroundColor Cyan

# Chercher les fichiers de stockage Electron
$electronStoragePaths = @(
    "$env:APPDATA\ZCode\User\globalStorage\storage.json",
    "$env:APPDATA\ZCode\Local Storage\leveldb",
    "$env:LOCALAPPDATA\ZCode\User Data\Default\Local Storage\leveldb"
)

foreach ($storagePath in $electronStoragePaths) {
    if (Test-Path $storagePath) {
        Write-Host "  Trouve: $storagePath" -ForegroundColor Green
        
        if ($storagePath -like "*.json") {
            try {
                $content = Get-Content $storagePath -Raw
                if ($content -match "oauth|zai|token") {
                    Write-Host "    Contient des references OAuth/ZAI" -ForegroundColor Yellow
                    
                    # Sauvegarder sanitized
                    $sanitized = $content -replace '"([^"]*token[^"]*)":\s*"[^"]+"', '"$1": "[REDACTED]"'
                    $sanitized | Out-File "$outputDir\electron-storage-$(Split-Path $storagePath -Leaf)"
                }
            } catch {
                Write-Host "    Erreur de lecture: $_" -ForegroundColor Yellow
            }
        } else {
            Write-Host "    Base de donnees LevelDB (binaire)" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "PHASES 4 et 5 TERMINEES" -ForegroundColor Green
Write-Host ""
Write-Host "Fichiers generes dans: $outputDir" -ForegroundColor Cyan
Write-Host "  zcode-beautified.js (code deminifie)"
Write-Host "  oauth-module.txt (module OAuth extrait)"
Write-Host "  auth-functions.txt (fonctions auth)"
Write-Host "  http-calls.txt (appels HTTP)"
Write-Host "  signatures.txt (mecanismes de signature)"
Write-Host "  storage.txt (mecanismes de stockage)"
Write-Host "  config fichiers de configuration trouves"
Write-Host ""
