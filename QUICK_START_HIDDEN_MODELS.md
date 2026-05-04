# Guide Rapide: Découverte de Modèles Cachés

**Date**: 2026-05-04  
**Objectif**: Trouver des modèles Windsurf disponibles sans BYOK

---

## 🚀 Exécution Rapide (3 étapes)

### Étape 1: Configurer le Token

Le token Windsurf est probablement déjà dans `.env.windsurf.local`:

```powershell
# Charger le token depuis .env.windsurf.local
$envFile = Get-Content .env.windsurf.local
$token = ($envFile | Select-String "WINDSURF_DIRECT_KEY=(.+)").Matches.Groups[1].Value
$env:WINDSURF_DIRECT_KEY = $token

# Vérifier
echo $env:WINDSURF_DIRECT_KEY
```

**OU** si vous connaissez votre token:

```powershell
$env:WINDSURF_DIRECT_KEY = "votre-token-ici"
```

### Étape 2: Exécuter le Test Rapide

```powershell
python scripts/quick_test_hidden_models.py
```

### Étape 3: Analyser les Résultats

Les résultats seront dans `windsurf_quick_test_results.json`

---

## 📊 Modèles Testés (22 candidats)

### Kimi (Moonshot AI) - 4 candidats

- `kimi-k2-7` - Version plus récente
- `kimi-k3` - Nouvelle génération
- `kimi-k2-6-fast` - Version rapide
- `kimi-k2-5` - Version antérieure

### GLM (Zhipu AI) - 6 candidats

- `glm-4`, `glm-4-5`, `glm-4-7` - Génération 4
- `glm-5-0`, `glm-5-2`, `glm-5-pro` - Génération 5

### DeepSeek - 4 candidats

- `deepseek-v3` - Version 3
- `deepseek-v2-5` - Version 2.5
- `deepseek-chat` - Chat général
- `deepseek-coder` - Spécialisé code

### Qwen (Alibaba) - 4 candidats

- `qwen-max`, `qwen-plus`, `qwen-turbo` - Variantes
- `qwen-2-5` - Version 2.5

### Windsurf Spécialisés - 4 candidats

- `swe-1-6`, `swe-1-6-fast`, `swe-2-0` - Software Engineering
- `adaptive` - Adaptatif

---

## 🎯 Résultats Attendus

### Scénario Optimiste (6-8 nouveaux modèles)

```
✅ kimi-k2-7
✅ kimi-k2-6-fast (alias de kimi-k2-6)
✅ glm-4
✅ glm-5-2
✅ deepseek-v3
✅ deepseek-chat
✅ qwen-max
✅ swe-1-6
```

### Scénario Réaliste (2-4 nouveaux modèles)

```
✅ kimi-k2-6-fast (alias)
✅ glm-4
✅ deepseek-chat
❌ Autres: BYOK requis ou non disponibles
```

### Scénario Pessimiste (0-1 nouveau modèle)

```
✅ kimi-k2-6-fast (alias seulement)
❌ Tous les autres: BYOK ou non disponibles
```

---

## 📝 Commandes Complètes

### Option 1: Avec Token dans .env.windsurf.local

```powershell
# Charger automatiquement le token
$envContent = Get-Content .env.windsurf.local -Raw
if ($envContent -match 'WINDSURF_DIRECT_KEY=([^\r\n]+)') {
    $env:WINDSURF_DIRECT_KEY = $matches[1]
    echo "Token chargé depuis .env.windsurf.local"
} else {
    echo "Token non trouvé dans .env.windsurf.local"
}

# Exécuter le test
python scripts/quick_test_hidden_models.py
```

### Option 2: Token Manuel

```powershell
# Définir le token manuellement
$env:WINDSURF_DIRECT_KEY = "devin-session-token$eyJhbGc..."

# Exécuter le test
python scripts/quick_test_hidden_models.py
```

### Option 3: Test Complet (Tous les Candidats)

```powershell
# Charger le token
$envContent = Get-Content .env.windsurf.local -Raw
if ($envContent -match 'WINDSURF_DIRECT_KEY=([^\r\n]+)') {
    $env:WINDSURF_DIRECT_KEY = $matches[1]
}

# Test complet avec toutes les catégories
python scripts/discover_hidden_windsurf_models.py
```

---

## 🔍 Vérifier les Résultats

### Lire le Fichier JSON

```powershell
# Afficher les résultats
Get-Content windsurf_quick_test_results.json | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Compter les modèles disponibles
$results = Get-Content windsurf_quick_test_results.json | ConvertFrom-Json
$results.available.Count
```

### Extraire les Modèles Disponibles

```powershell
$results = Get-Content windsurf_quick_test_results.json | ConvertFrom-Json
$results.available | ForEach-Object {
    Write-Host "✅ $($_.model_uid) - $($_.description)"
}
```

---

## 🎓 Après la Découverte

### Si Nouveaux Modèles Trouvés

1. **Tester la qualité**:

   ```powershell
   python scripts/windsurf_direct_probe.py --model nouveau-modele --prompt "What model are you?"
   ```

2. **Vérifier si c'est un alias**:
   - Si la réponse mentionne un autre modèle → C'est un alias
   - Si la réponse correspond au nom → C'est un vrai nouveau modèle

3. **Mettre à jour la documentation**:
   - Ajouter dans `windsurf_model_routing_table.json`
   - Mettre à jour `WINDSURF_MODEL_ROUTING_REVERSE_ENGINEERING_REPORT.md`

4. **Intégrer dans OmniRoute**:
   - Ajouter dans `open-sse/config/windsurfModels.ts`
   - Créer des tests unitaires

### Si Aucun Nouveau Modèle

Cela signifie probablement:

- ✅ Les 4 modèles gratuits confirmés sont les seuls disponibles
- 🔒 Les autres nécessitent BYOK ou abonnement Pro
- 📅 Windsurf n'a pas encore déployé d'autres modèles

---

## 🐛 Dépannage

### Erreur: "WINDSURF_DIRECT_KEY not set"

```powershell
# Vérifier si .env.windsurf.local existe
Test-Path .env.windsurf.local

# Afficher le contenu (masquer le token)
Get-Content .env.windsurf.local | Select-String "WINDSURF_DIRECT_KEY"

# Charger manuellement
$env:WINDSURF_DIRECT_KEY = "votre-token"
```

### Erreur: "cascade_failed"

Le serveur Windsurf local n'est pas accessible:

```powershell
# Vérifier si Windsurf est lancé
Get-Process Windsurf -ErrorAction SilentlyContinue

# Lancer Windsurf si nécessaire
Start-Process "C:\Users\amine\AppData\Local\Programs\Windsurf\Windsurf.exe"

# Attendre 10 secondes puis réessayer
Start-Sleep -Seconds 10
python scripts/quick_test_hidden_models.py
```

### Erreur: "ImportError"

```powershell
# Vérifier que windsurf_direct_probe.py existe
Test-Path scripts/windsurf_direct_probe.py

# Vérifier les dépendances Python
pip install cryptography
```

---

## 📊 Exemple de Sortie Attendue

```
================================================================================
Windsurf Hidden Models - Quick Test
================================================================================

Testing 22 top candidates...

Checking authentication...
Authentication configured

Testing models...
--------------------------------------------------------------------------------
Testing: kimi-k2-7                (Kimi K2.7 (newer version))... NOT FOUND
Testing: kimi-k3                  (Kimi K3 (next generation))... NOT FOUND
Testing: kimi-k2-6-fast           (Kimi K2.6 Fast)... SUCCESS!
Testing: kimi-k2-5                (Kimi K2.5 (older version))... NOT FOUND
Testing: glm-4                    (GLM-4)... SUCCESS!
Testing: glm-4-5                  (GLM-4.5)... NOT FOUND
Testing: glm-4-7                  (GLM-4.7)... NOT FOUND
Testing: glm-5-0                  (GLM-5.0)... NOT FOUND
Testing: glm-5-2                  (GLM-5.2)... NOT FOUND
Testing: glm-5-pro                (GLM-5 Pro)... NOT FOUND
Testing: deepseek-v3              (DeepSeek V3)... NOT FOUND
Testing: deepseek-v2-5            (DeepSeek V2.5)... NOT FOUND
Testing: deepseek-chat            (DeepSeek Chat)... SUCCESS!
Testing: deepseek-coder           (DeepSeek Coder)... NOT FOUND
Testing: qwen-max                 (Qwen Max)... NOT FOUND
Testing: qwen-plus                (Qwen Plus)... NOT FOUND
Testing: qwen-turbo               (Qwen Turbo)... NOT FOUND
Testing: qwen-2-5                 (Qwen 2.5)... NOT FOUND
Testing: swe-1-6                  (Software Engineering 1.6)... NOT FOUND
Testing: swe-1-6-fast             (SWE 1.6 Fast)... NOT FOUND
Testing: swe-2-0                  (SWE 2.0)... NOT FOUND
Testing: adaptive                 (Adaptive Model)... NOT FOUND

================================================================================
Results Summary
================================================================================

Available models: 3/22

NEWLY DISCOVERED MODELS:
--------------------------------------------------------------------------------
  SUCCESS: kimi-k2-6-fast           - Kimi K2.6 Fast
  SUCCESS: glm-4                    - GLM-4
  SUCCESS: deepseek-chat            - DeepSeek Chat

Next steps:
  1. Test these models with actual prompts to verify quality
  2. Check if they're aliases or real new models
  3. Update windsurf_model_routing_table.json
  4. Add to open-sse/config/windsurfModels.ts

Results saved to: c:\Users\amine\OmniRoute\windsurf_quick_test_results.json
```

---

## 🎯 Prochaine Action

**Exécutez maintenant**:

```powershell
# Charger le token et exécuter
$envContent = Get-Content .env.windsurf.local -Raw
if ($envContent -match 'WINDSURF_DIRECT_KEY=([^\r\n]+)') {
    $env:WINDSURF_DIRECT_KEY = $matches[1]
    python scripts/quick_test_hidden_models.py
} else {
    echo "Erreur: Token non trouvé dans .env.windsurf.local"
}
```

---

**Temps estimé**: 2-3 minutes pour tester 22 modèles  
**Résultats**: Sauvegardés dans `windsurf_quick_test_results.json`
