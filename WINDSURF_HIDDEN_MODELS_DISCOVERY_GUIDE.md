# Guide de Découverte des Modèles Cachés Windsurf

**Date**: 2026-05-04  
**Objectif**: Trouver des modèles disponibles SANS configuration BYOK

---

## 🎯 Stratégie de Découverte

### Modèles Confirmés (Baseline)

- ✅ `kimi-k2-6` - Kimi K2.6 (Moonshot AI)
- ✅ `kimi-k2-6-e` - Kimi K2.6 Extended
- ✅ `glm-5` - GLM-5 (Zhipu AI)
- ✅ `glm-5-1` - GLM-5.1 (Zhipu AI)

### Modèles Candidats à Tester

#### 1. Variantes Kimi (Moonshot AI)

```
kimi-k2-5       # Version antérieure
kimi-k2-7       # Version plus récente
kimi-k3         # Nouvelle génération
kimi-k3-pro     # Version Pro
kimi-k2-6-fast  # Version rapide
kimi-k2-6-lite  # Version légère
kimi-k2-6-plus  # Version améliorée
```

#### 2. Variantes GLM (Zhipu AI)

```
glm-4           # Génération précédente
glm-4-5         # GLM-4.5
glm-4-7         # GLM-4.7
glm-5-0         # GLM-5.0
glm-5-2         # GLM-5.2
glm-5-pro       # Version Pro
glm-5-plus      # Version améliorée
glm-5-lite      # Version légère
glm-5-fast      # Version rapide
```

#### 3. DeepSeek (Modèles Chinois)

```
deepseek-v3            # DeepSeek V3
deepseek-v2-5          # DeepSeek V2.5
deepseek-coder         # Spécialisé code
deepseek-coder-v2      # Coder V2
deepseek-chat          # Chat général
deepseek-reasoner      # Raisonnement
```

#### 4. Qwen (Alibaba)

```
qwen-max          # Version maximale
qwen-plus         # Version plus
qwen-turbo        # Version rapide
qwen-2-5          # Qwen 2.5
qwen-2-5-coder    # Coder 2.5
qwen-coder        # Spécialisé code
```

#### 5. Yi (01.AI)

```
yi-large    # Grande version
yi-medium   # Version moyenne
yi-vision   # Avec vision
yi-34b      # 34 milliards de paramètres
```

#### 6. Autres Modèles Chinois

```
# Baichuan
baichuan-4
baichuan-3
baichuan-turbo

# MiniMax
minimax-abab-6
minimax-abab-6-5
minimax-abab-5-5
```

#### 7. Modèles Spécialisés Windsurf

```
swe-1-6           # Software Engineering 1.6
swe-1-6-fast      # SWE rapide
swe-1-5           # Version antérieure
swe-2-0           # Nouvelle version
adaptive          # Adaptatif
adaptive-ss       # Adaptatif SS
cascade-default   # Défaut Cascade
windsurf-default  # Défaut Windsurf
```

---

## 🚀 Utilisation du Script

### Installation

```bash
cd c:\Users\amine\OmniRoute
```

### Configuration

Assurez-vous que `WINDSURF_DIRECT_KEY` est configuré:

```bash
# Vérifier la variable d'environnement
echo $env:WINDSURF_DIRECT_KEY

# Ou dans .env.windsurf.local
cat .env.windsurf.local
```

### Exécution

#### Test Complet (Toutes les Catégories)

```bash
python scripts/discover_hidden_windsurf_models.py
```

#### Test par Catégorie

```bash
# Tester uniquement les variantes Kimi
python scripts/discover_hidden_windsurf_models.py --categories kimi_variants

# Tester DeepSeek et Qwen
python scripts/discover_hidden_windsurf_models.py --categories deepseek_models qwen_models

# Tester les modèles spécialisés
python scripts/discover_hidden_windsurf_models.py --categories swe_models generic_variants
```

#### Inclure les Modèles Confirmés (Vérification)

```bash
python scripts/discover_hidden_windsurf_models.py --include-confirmed
```

#### Spécifier le Fichier de Sortie

```bash
python scripts/discover_hidden_windsurf_models.py --output my_discovery_results.json
```

---

## 📊 Interprétation des Résultats

### Status Codes

| Status           | Signification                         | Action                                  |
| ---------------- | ------------------------------------- | --------------------------------------- |
| `available`      | ✅ Modèle disponible sans BYOK        | Ajouter à la liste des modèles gratuits |
| `not_found`      | ❌ Modèle n'existe pas ou BYOK requis | Ignorer ou marquer comme BYOK           |
| `error`          | ⚠️ Erreur technique                   | Vérifier les logs                       |
| `cascade_failed` | ⚠️ Échec de création de cascade       | Problème d'authentification             |

### Exemple de Sortie

```
📦 Testing category: kimi_variants (7 models)
----------------------------------------------------------------------
  Testing: kimi-k2-5... ❌ Not found
  Testing: kimi-k2-7... ✅ Available (200)
    → Assigned model: kimi-k2-7
  Testing: kimi-k3... ❌ Not found
  Testing: kimi-k3-pro... ❌ Not found
  Testing: kimi-k2-6-fast... ✅ Available (200)
    → Assigned model: kimi-k2-6
  Testing: kimi-k2-6-lite... ❌ Not found
  Testing: kimi-k2-6-plus... ❌ Not found

🎉 NEWLY DISCOVERED MODELS:
----------------------------------------------------------------------
  ✅ kimi-k2-7
     → Backend assigned: kimi-k2-7
  ✅ kimi-k2-6-fast
     → Backend assigned: kimi-k2-6
```

### Analyse des Résultats

1. **Modèle Réel vs Alias**
   - Si `model_uid` ≠ `model_name_in_response` → C'est un **alias**
   - Exemple: `kimi-k2-6-fast` → `kimi-k2-6` (alias)

2. **Nouveau Modèle Découvert**
   - Si `model_uid` = `model_name_in_response` → C'est un **vrai modèle**
   - Exemple: `kimi-k2-7` → `kimi-k2-7` (nouveau modèle)

3. **Modèle BYOK**
   - Status `not_found` avec message "unknown model UID"
   - Nécessite configuration de clé API

---

## 🔍 Patterns de Nommage Découverts

### Règles Confirmées

1. **Utiliser des tirets, pas des points**
   - ✅ `glm-5-1` (correct)
   - ❌ `glm-5.1` (incorrect)

2. **Format général**: `{provider}-{version}-{variant}`
   - `kimi-k2-6` = Kimi, version K2.6
   - `glm-5-1` = GLM, version 5.1
   - `deepseek-v3` = DeepSeek, version V3

3. **Suffixes communs**:
   - `-fast` = Version rapide
   - `-lite` = Version légère
   - `-pro` = Version Pro
   - `-plus` = Version améliorée
   - `-coder` = Spécialisé code
   - `-chat` = Chat général

---

## 🎯 Stratégie de Test Optimale

### Phase 1: Variantes des Modèles Confirmés

```bash
# Tester d'abord les variantes de Kimi et GLM
python scripts/discover_hidden_windsurf_models.py --categories kimi_variants glm_variants
```

**Probabilité de succès**: HAUTE (même fournisseur)

### Phase 2: Modèles Chinois Populaires

```bash
# DeepSeek, Qwen, Yi
python scripts/discover_hidden_windsurf_models.py --categories deepseek_models qwen_models yi_models
```

**Probabilité de succès**: MOYENNE (partenariats possibles)

### Phase 3: Autres Fournisseurs

```bash
# Baichuan, MiniMax
python scripts/discover_hidden_windsurf_models.py --categories baichuan_models minimax_models
```

**Probabilité de succès**: FAIBLE (moins connus)

### Phase 4: Modèles Spécialisés

```bash
# SWE, adaptatifs
python scripts/discover_hidden_windsurf_models.py --categories swe_models generic_variants
```

**Probabilité de succès**: MOYENNE (spécifiques à Windsurf)

---

## 📝 Après la Découverte

### 1. Mettre à Jour la Table de Routage

Ajouter les nouveaux modèles découverts dans:

- `windsurf_model_routing_table.json`
- `open-sse/config/windsurfModels.ts`

### 2. Documenter les Alias

Si un modèle est un alias (ex: `kimi-k2-6-fast` → `kimi-k2-6`):

```typescript
{
  "model_uid": "kimi-k2-6-fast",
  "alias_of": "kimi-k2-6",
  "type": "alias",
  "note": "Fast variant routes to standard kimi-k2-6"
}
```

### 3. Tester la Qualité

Pour chaque nouveau modèle découvert:

```bash
# Test de conversation
python scripts/windsurf_direct_probe.py --model {model_uid} --prompt "What model are you?"

# Vérifier la réponse pour confirmer l'identité
```

### 4. Mettre à Jour OmniRoute

```typescript
// Ajouter dans WINDSURF_FREE_MODELS
export const WINDSURF_FREE_MODELS = [
  // Existants
  { id: "kimi-k2-6", name: "Kimi K2.6", provider: "Moonshot AI" },
  { id: "glm-5", name: "GLM-5", provider: "Zhipu AI" },

  // Nouveaux découverts
  { id: "kimi-k2-7", name: "Kimi K2.7", provider: "Moonshot AI" },
  { id: "deepseek-v3", name: "DeepSeek V3", provider: "DeepSeek" },
  // ...
];
```

---

## ⚠️ Limitations

### Rate Limiting

- Délai de 0.5s entre chaque test
- Éviter de tester trop de modèles d'un coup
- Si erreur 429, augmenter le délai

### Faux Positifs

- Un status 200 ne garantit pas que le modèle est différent
- Vérifier `model_name_in_response` pour confirmer

### Modèles Temporaires

- Certains modèles peuvent être des tests internes
- Vérifier la stabilité sur plusieurs jours

---

## 🎓 Exemples de Commandes

### Découverte Rapide (Top Candidats)

```bash
python scripts/discover_hidden_windsurf_models.py \
  --categories kimi_variants glm_variants deepseek_models \
  --output quick_discovery.json
```

### Découverte Complète

```bash
python scripts/discover_hidden_windsurf_models.py \
  --output full_discovery.json
```

### Vérification des Modèles Confirmés

```bash
python scripts/discover_hidden_windsurf_models.py \
  --categories confirmed_free \
  --include-confirmed \
  --output verification.json
```

---

## 📊 Résultats Attendus

### Scénario Optimiste

- 2-3 nouvelles variantes Kimi découvertes
- 1-2 nouvelles variantes GLM découvertes
- 1-2 modèles DeepSeek disponibles
- Total: **6-7 nouveaux modèles**

### Scénario Réaliste

- 1-2 nouvelles variantes Kimi (probablement des alias)
- 1 nouvelle variante GLM
- 0-1 modèle DeepSeek
- Total: **2-4 nouveaux modèles**

### Scénario Pessimiste

- Aucun nouveau modèle réel
- Quelques alias découverts
- La plupart nécessitent BYOK
- Total: **0-1 nouveau modèle**

---

## 🚀 Prochaines Étapes

1. **Exécuter la découverte**

   ```bash
   python scripts/discover_hidden_windsurf_models.py
   ```

2. **Analyser les résultats**

   ```bash
   cat windsurf_hidden_models_discovery.json
   ```

3. **Tester les nouveaux modèles**

   ```bash
   python scripts/windsurf_direct_probe.py --model {nouveau_modele}
   ```

4. **Mettre à jour la documentation**
   - Ajouter dans `WINDSURF_MODEL_ROUTING_REVERSE_ENGINEERING_REPORT.md`
   - Mettre à jour `windsurf_model_routing_table.json`

5. **Intégrer dans OmniRoute**
   - Mettre à jour `open-sse/config/windsurfModels.ts`
   - Ajouter les tests unitaires

---

**Bonne chasse aux modèles cachés! 🎯**
