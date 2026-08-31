# Analyse de la signature CLI Freebuff

## Requête capturée du CLI réel

### Headers
```
Authorization: Bearer 008fc8b8-4d8e-49be-a16b-71eb1beb3cae
Content-Type: application/json
User-Agent: ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser
Connection: keep-alive
Accept: */*
Host: www.codebuff.com
Accept-Encoding: gzip, deflate, br, zstd
```

### Body - Métadonnées clés
```json
{
  "model": "deepseek/deepseek-v4-flash",
  "stop": ["\"cb_easp\""],
  "codebuff_metadata": {
    "freebuff_instance_id": "70fb92e2-d3eb-4a4e-83c5-3d3de7326823",
    "trace_session_id": "a214f05c-b63f-4eeb-8ae9-a818d037a511",
    "run_id": "21dcd572-bbd1-41d1-97c3-a326936513d0",
    "client_id": "4utb3yxkau",
    "cost_mode": "free"
  },
  "provider": {
    "data_collection": "deny"
  }
}
```

## Éléments de signature identifiés

### 1. User-Agent spécifique
- Format: `ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser`
- Pattern: `ai-sdk/openai-compatible/{version}/codebuff ai-sdk/provider-utils/{version} runtime/{runtime}`
- Version CLI: `0.0.0-test`
- **Hypothèse**: Le backend vérifie la présence de `/codebuff` dans le User-Agent

### 2. client_id dans codebuff_metadata
- Valeur capturée: `"4utb3yxkau"`
- **Hypothèse**: ID client OAuth ou identifiant de session CLI

### 3. freebuff_instance_id
- UUID v4: `"70fb92e2-d3eb-4a4e-83c5-3d3de7326823"`
- Persiste probablement pendant la session CLI

### 4. trace_session_id
- UUID v4: `"a214f05c-b63f-4eeb-8ae9-a818d037a511"`
- Probablement unique par requête ou session de trace

### 5. run_id
- UUID v4: `"21dcd572-bbd1-41d1-97c3-a326936513d0"`
- Probablement unique par appel API

### 6. stop token
- Valeur: `["\"cb_easp\""]`
- Token d'arrêt spécifique au CLI (escaped quotes)

### 7. provider.data_collection
- Valeur: `"deny"`
- Indique que l'utilisateur refuse la collecte de données

## Différences avec nos tentatives précédentes

| Élément | CLI réel | Nos tentatives | Impact probable |
|---------|----------|----------------|-----------------|
| User-Agent | `ai-sdk/.../codebuff...runtime/browser` | `ai-sdk/.../codebuff...runtime/node` | **CRITIQUE** - détection runtime |
| client_id | `"4utb3yxkau"` | Manquant ou générique | **CRITIQUE** - authentification client |
| freebuff_instance_id | UUID persistant | Nouveau à chaque fois | Moyen - fingerprinting |
| trace_session_id | UUID | Manquant ou incorrect | Moyen - traçabilité |
| run_id | UUID | Manquant ou incorrect | Faible - traçabilité |
| stop | `["\"cb_easp\""]` | Peut-être différent | Faible - comportement |
| runtime dans UA | `runtime/browser` | `runtime/node` | **CRITIQUE** |

## Hypothèses de blocage

### Hypothèse #1: Détection runtime/browser (TRÈS PROBABLE)
Le backend détecte que les requêtes viennent de `runtime/node` au lieu de `runtime/browser` et bloque.

**Test**: Modifier le User-Agent pour mettre `runtime/browser`

### Hypothèse #2: client_id requis (TRÈS PROBABLE)
Le `client_id` est un identifiant OAuth ou de session nécessaire pour accéder au mode free.

**Test**: Extraire le client_id du CLI et le réutiliser

### Hypothèse #3: Fingerprinting combiné
Le backend combine plusieurs signaux (User-Agent + client_id + instance_id) pour détecter le CLI légitime.

**Test**: Reproduire tous les champs exactement

## Prochaines étapes

1. ✅ Capturer la requête réelle (fait)
2. 🔄 Tester avec User-Agent complet incluant `runtime/browser`
3. 🔄 Extraire et réutiliser le `client_id`
4. 🔄 Reproduire tous les champs metadata exactement
5. 🔄 Si échec, analyser si le client_id est lié au token Bearer
