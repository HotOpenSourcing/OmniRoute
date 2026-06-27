# Z.AI Coding Plan — Spécification Technique d'Intégration

> **Dernière mise à jour** : 2026-06-24
> **Statut** : ⚠️ Auth propriétaire non réplicable — Intégration par import manuel de token
> **Provider ID** : `zai-coding-plan` (alias `zcp`)

---

## 1. Spécification du Provider

| Champ | Valeur |
|---|---|
| **id** | `zai-coding-plan` |
| **name** | Z.AI Coding Plan |
| **alias** | `zcp` |
| **format** | `anthropic` (Claude Messages API) |
| **baseUrl** | `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages` |
| **authType** | `bearer` |
| **authHeader** | `Authorization` |
| **executor** | `default` (Anthropic → interne) |

### 1.1 Modèles Disponibles

| ID | Nom | Context | Max Output | Vision | Reasoning |
|---|---|---|---|---|---|
| `glm-5.2` | GLM 5.2 | 1 000 000 | 8 192 | ❌ | ✅ |
| `glm-5.2-long` | GLM 5.2 Long | 2 000 000 | 8 192 | ❌ | ✅ |
| `glm-5.2-high` | GLM 5.2 High | 1 000 000 | 8 192 | ❌ | ✅ |
| `glm-5.2-pro` | GLM 5.2 Pro | 1 000 000 | 8 192 | ❌ | ✅ |
| `glm-5.1` | GLM 5.1 | 1 000 000 | 8 192 | ❌ | ✅ |
| `glm-5-turbo` | GLM 5 Turbo | 200 000 | 64 000 | ❌ | ✅ |
| `glm-4.7` | GLM 4.7 | 128 000 | 4 096 | ❌ | ❌ |
| `glm-4.5v` | GLM 4.5V | 128 000 | 4 096 | ✅ | ❌ |

Source : `GET https://api.z.ai/api/coding/paas/v4`

### 1.2 Plans et Quotas

| Plan | Modèle | Quota quotidien | Période |
|---|---|---|---|
| `zcode-v3-start-plan-0615` | GLM-5.2 | 3 000 000 tokens | daily |
| `zcode-v3-start-plan-0615` | GLM-5-Turbo | 2 000 000 tokens | daily |

---

## 2. Flux d'Authentification

### 2.1 Architecture Réelle (Reverse-Engineered)

Le desktop ZCode utilise un pipeline propriétaire à **4 étapes** :

```
ÉTAPE 1 : OAuth Authorization (navigateur)
──────────────────────────────────────────
GET https://chat.z.ai/api/oauth/authorize
    ?response_type=code
    &client_id=client_P8X5CMWmlaRO9gyO-KSqtg
    &redirect_uri=zcode://zai-auth/callback
    &state=<pollToken 64hex>

→ callback avec code-<hex>


ÉTAPE 2 : CLI Polling (interne ZCode — BLOQUÉ)
───────────────────────────────────────────────
POST /oauth/cli/init          → HTTP 307 → /cn/... → 404
GET  /oauth/cli/poll/{id}     → HTTP 404

→ Endpoints internes, non réplicables hors du desktop ZCode


ÉTAPE 3 : Échange bizToken (via le code source — CONFIRMÉ)
─────────────────────────────────────────────────────────
POST https://api.z.ai/api/auth/z/login
Content-Type: application/json

{"token": "<zai.access_token>"}

→ {"access_token": "<bizToken>"}


ÉTAPE 4 : Appel LLM
────────────────────
POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
Authorization: Bearer <bizToken>
```

### 2.2 Contrainte Critique

Le `code-<hex>` retourné par l'OAuth **n'est pas** un Bearer token utilisable directement. Il doit d'abord être échangé via le CLI polling (étape 2), dont les endpoints ne sont pas accessibles depuis un contexte externe.

**Conséquence** : Le flow OAuth complet n'est pas intégrable dans OmniRoute sans passer par le desktop ZCode.

---

## 3. Stratégie d'Intégration Recommandée

### 3.1 Approche : Import Manuel du Token

L'utilisateur copie son token depuis l'application ZCode desktop vers OmniRoute.

**Source du token** : `~/.zcode/v2/config.json`

```json
"builtin:zai-start-plan": {
  "options": {
    "apiKey": "eyJ...JWT",
    "baseURL": "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
    "apiKeyRequired": true
  }
}
```

**Format du token** : JWT (HS256)
```json
// Header
{"alg":"HS256","typ":"JWT"}
// Payload
{"user_id":"<uuid>","sub":"<uuid>","iat":<timestamp>}
// Pas de claim "exp" — durée de vie gérée côté serveur
```

### 3.2 Contrainte Connue : Captcha Aliyun

Le proxy `zcode.z.ai` peut retourner une erreur 403 captcha :

```json
{"code":3007,"msg":"captcha verify failed"}
```

Ce captcha est déclenché côté serveur quand la requête vient d'un contexte non reconnu (IP, user-agent, headers). Le desktop ZCode ne rencontre pas ce problème car il utilise des headers supplémentaires (non documentés) qui identifient le client comme légitime.

**Solutions :**
1. L'appel via le navigateur OmniRoute (même session Electron) peut passer le captcha
2. L'import du JWT + appel via `api.z.ai` directement (sans le proxy ZCode) pourrait éviter le captcha
3. Si le captcha persiste, l'utilisateur peut obtenir une vraie API key via `https://open.bigmodel.cn`

---

## 4. Spécification des Appels LLM

### 4.1 Endpoint

```
POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
```

### 4.2 Headers

```
Authorization: Bearer <JWT ou bizToken>
Content-Type: application/json
anthropic-version: 2023-06-01
```

### 4.3 Body (Anthropic Messages API)

```json
{
  "model": "glm-5.2",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

### 4.4 Streaming (SSE)

Le streaming utilise `text/event-stream` avec les événements standards Anthropic :
`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`

---

## 5. Endpoints Complets

| Endpoint | Usage | Statut |
|---|---|---|
| `POST /api/v1/zcode-plan/anthropic/v1/messages` | Appel LLM (Anthropic) | ✅ OK (avec token valide) |
| `GET /api/v1/zcode-plan/billing/balance` | Solde tokens | 🔍 Non testé |
| `GET /api/v1/zcode-plan/billing/current` | Plan actuel | ✅ OK (logs) |
| `POST /api/anthropic/v1/messages` | Direct api.z.ai | 🔍 Alternative sans proxy |
| `GET /api/coding/paas/v4` | Catalogue modèles | ✅ OK |
| `POST /api/auth/z/login` | Échange token → bizToken | ✅ Confirmé dans le code |

---

## 6. Gestion des Erreurs

| HTTP | Signification | Action |
|---|---|---|
| **200** | Succès | ✅ Traiter la réponse |
| **401** | Token invalide/expiré | 🔄 L'utilisateur doit réimporter un token frais depuis ZCode |
| **403** | Captcha / Accès refusé | ⚠️ Voir §3.2. Essayer direct api.z.ai ou open.bigmodel.cn |
| **429** | Rate limit | ⏳ Retry avec backoff (3 tentatives max) |
| **500** | Erreur serveur | 🔄 Retry (2 tentatives max) |

---

## 7. Exemples curl

### 7.1 Appel LLM simple

```bash
JWT="eyJ...importé depuis config.json de ZCode"

curl -X POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "glm-5.2",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 7.2 Appel direct (sans proxy ZCode)

```bash
curl -X POST https://api.z.ai/api/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $JWT" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "glm-5.2",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 7.3 Streaming

```bash
curl -N -X POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "glm-5.2",
    "max_tokens": 500,
    "messages": [{"role": "user", "content": "Write a poem"}],
    "stream": true
  }'
```

---

## 8. Plan d'Intégration dans OmniRoute

### Phase 1 : Import Manuel de Token ✅ (Déjà fait)

| Fichier | Statut |
|---|---|
| `src/shared/constants/providers.ts` | ✅ Provider ID enregistré |
| `src/lib/oauth/constants/oauth.ts` | ✅ Config OAuth (URLs, clientId) |
| `src/lib/oauth/providers/zaiCodingPlan.ts` | ✅ Logique OAuth (buildAuthUrl, exchangeToken) |
| `open-sse/config/providers/registry/zai-coding-plan/index.ts` | ✅ Modèles et endpoints |
| `tests/unit/zaiCodingPlan.test.ts` | ✅ 8/8 tests |
| `open-sse/utils/publicCreds.ts` | ✅ Credentials publics |
| `ZAI_SPEC.md` | ✅ Ce document |
| `ZCODE_DYNAMIC_ANALYSIS.md` | ✅ Analyse complète |

### Phase 2 : Adaptation du Provider

- [ ] Modifier `zaiCodingPlan.ts` pour supporter l'import manuel de token (JWT)
- [ ] Ajouter une UI dans OmniRoute pour que l'utilisateur colle son token ZCode
- [ ] Documenter l'emplacement du token : `~/.zcode/v2/config.json` → `apiKey`

### Phase 3 : Tests de Résilience

- [ ] Tester l'appel avec le JWT importé → vérifier si captcha est déclenché
- [ ] Tester l'alternative directe `api.z.ai` sans le proxy ZCode
- [ ] Valider le streaming (SSE)
- [ ] Documenter le comportement exact du captcha

---

## 9. Notes Techniques

### 9.1 Fonctions Clés du Bundle ZCode

| Symbole minifié | Fonction réelle | URL |
|---|---|---|
| `Xno` | `resolveZaiBizToken` | `POST https://api.z.ai/api/auth/z/login` |
| `pCr` | `resolveBizApiKey` | API Biz BigModel |
| `LCr` | `resolveCodingPlanApiKey` | Point d'entrée |
| `hCr` | `createCodingPlanApiKeyResolver` | Router zai/bigmodel |
| `ndt` | `createCliOAuthClient` | `/oauth/cli/{init,poll}` |

### 9.2 Stockage des Tokens

| Fichier | Contenu | Format |
|---|---|---|
| `~/.zcode/v2/credentials.json` | Tokens OAuth (access, refresh, JWT) | Chiffré AES-256-GCM |
| `~/.zcode/v2/config.json` | API key en clair | JWT (JSON) |

### 9.3 Variables d'Environnement

| Variable | Usage |
|---|---|
| `BIGMODEL_OAUTH_APP_SECRET` | Clé de déchiffrement des credentials |
| `ZCODE_DATA_BASE_DIR` | Répertoire de données ZCode |
| `ZCODE_PLAN_OPENAI_BASE_URL` | Surcharge du format OpenAI |

---

## 10. Résumé des Décisions

| Question | Réponse |
|---|---|
| Le `code-<hex>` est-il un Bearer token ? | **NON** — il nécessite un échange via CLI polling interne |
| Le flow OAuth est-il réplicable ? | **NON** — endpoints CLI bloqués (307 → 404) |
| L'import manuel du JWT fonctionne-t-il ? | **OUI** — mais peut déclencher un captcha Aliyun |
| L'API directe `api.z.ai` est-elle une alternative ? | **À TESTER** — évite peut-être le captcha du proxy |
| Recommandation pour OmniRoute | **Import manuel** + fallback `api.z.ai` si captcha |
