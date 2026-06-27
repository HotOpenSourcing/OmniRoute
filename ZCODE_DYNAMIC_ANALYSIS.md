# ZCode — Analyse Dynamique du Workflow d'Authentification

> **Date**: 2026-06-24  
> **Source**: Analyse statique du bundle `zcode.cjs` (9.4 Mo) + logs applicatifs + tests réseau en direct  
> **Statut**: ✅ Workflow reverse-engineered, endpoints documentés, mais non réplicable depuis un contexte externe

---

## 1. Architecture Globale d'Authentification

### 1.1 Diagramme du Flux Complet

```
                  ┌──────────────────────────────────────┐
                  │          ZCode Desktop App            │
                  │         (Électron + Node.js)          │
                  └──────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ OAuth Flow   │  │ Token        │  │ LLM API      │
   │ (Navigateur) │  │ Exchange     │  │ (Proxy)      │
   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
          │                 │                 │
          ▼                 ▼                 ▼
   chat.z.ai           api.z.ai          zcode.z.ai
   /oauth/authorize    /auth/z/login     /zcode-plan/anthropic
```

### 1.2 Flux Détaillé (5 étapes)

```
ÉTAPE 1 : OAuth Authorization
──────────────────────────────────────────────────────────
GET https://chat.z.ai/api/oauth/authorize
    ?response_type=code
    &client_id=client_P8X5CMWmlaRO9gyO-KSqtg
    &redirect_uri=zcode://zai-auth/callback
    &state=<pollToken 64hex>

→ Redirect to zcode://zai-auth/callback?code=code-<hex>&state=<pollToken>


ÉTAPE 2 : CLI Init (POST)
──────────────────────────────────────────────────────────
POST https://zcode.z.ai/oauth/cli/init
Authorization: Bearer <pollToken>
Content-Type: application/json

{"provider": "zai"}

→ HTTP 307 Redirect to /cn/oauth/cli/init
→ (Endpoint semble supprimé en production — 404 après redirect)


ÉTAPE 3 : CLI Poll (GET) — SI init OK
──────────────────────────────────────────────────────────
GET https://zcode.z.ai/oauth/cli/poll/{flow_id}
Authorization: Bearer <pollToken>

→ Retourne {zai: {access_token: "..."}, token: "...", user: {...}}


ÉTAPE 4 : Échange bizToken (POST) — CONFIRMÉ par le code
──────────────────────────────────────────────────────────
POST https://api.z.ai/api/auth/z/login
Content-Type: application/json

{"token": "<zai.access_token>"}

→ Retourne {access_token: "<bizToken>"}

Headers constants :
  mCr = "https://api.z.ai"
  fCr = "application/json"
  dCr = "zcode" (nom de clé API par défaut)


ÉTAPE 5 : Appel LLM (POST) — CONFIRMÉ par les logs
──────────────────────────────────────────────────────────
POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
Authorization: Bearer <bizToken>
Content-Type: application/json
anthropic-version: 2023-06-01

{
  "model": "GLM-5.2",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "..."}]
}
```

---

## 2. Fonctions Décompilées (extraction du bundle minifié)

### 2.1 `resolveZaiBizToken` (Xno) — Le pont manquant

```javascript
// Xno = resolveZaiBizToken
// Fichier : zcode.cjs (minifié)
// Rôle : Échange l'access_token OAuth contre un bizToken

async function Xno(e, t, r) {
  // e = { httpClient, trace }
  // t = accessToken (from oauth:zai:access_token)
  // r = options

  let o = await h7(e.httpClient, {
    body: new TextEncoder().encode(JSON.stringify({
      token: t                     // ← L'access_token OAuth
    })),
    headers: {
      "Content-Type": "application/json"  // fCr
    },
    method: "POST",
    trace: e.trace,
    url: `https://api.z.ai/api/auth/z/login`  // mCr = "https://api.z.ai"
  }, r);

  let n = o?.access_token?.trim() ?? o?.accessToken?.trim() ?? "";
  if (!n) throw new Error("Z.AI biz token response is missing access_token.");
  return n;
}
```

### 2.2 `resolveBizApiKey` (pCr) — Alternative BigModel

```javascript
// pCr = resolveBizApiKey
// Rôle : Pour le provider "bigmodel", obtient une clé API via l'API Biz

async function pCr(e, t) {
  // 1. GET infos client
  let r = await h7({ ... url: `${e.host}/api/biz/customer/getCustomerInfo` });
  
  // 2. Extraire org/project
  let o = Yno(r);  // pickOrgAndProject
  
  // 3. Créer ou récupérer une API key
  let u = await h7({ 
    method: "GET", 
    url: `${e.host}/api/biz/v1/organization/${o.orgId}/projects/${o.projectId}/api_keys`
  });
  
  // 4. Copier la clé (obtenir le secretKey)
  let c = await h7({
    method: "GET",
    url: `${url}/copy/${encodeURIComponent(u)}`
  });
  
  // 5. Retourner apiKey.secretKey
  return `${u}.${c?.secretKey}`;
}
```

### 2.3 `resolveCodingPlanApiKey` (LCr)

```javascript
// LCr = resolveCodingPlanApiKey
// Rôle : Point d'entrée pour résoudre la clé API du Coding Plan

LCr(e) {
  return (e.resolver ?? hCr({
    httpClient: e.httpClient ?? BCr(e.env),  // createDefaultHttpClient
    trace: e.trace
  })).resolve(e);
}

// Appelé avec :
LCr({
  accessToken: c.zai.access_token,   // ← De oauth:zai:access_token
  env: t,
  httpClient: e.httpClient,
  providerId: "zai",                  // ou "bigmodel"
  resolver: e.apiKeyResolver
});
```

### 2.4 `createCodingPlanApiKeyResolver` (hCr)

```javascript
// hCr = createCodingPlanApiKeyResolver
// Rôle : Crée le résolveur qui appelle l'endpoint d'échange

hCr(e) {
  return {
    async resolve(t, r) {
      let o = t.accessToken.trim();
      if (!o) throw new Error("OAuth access token is required.");
      
      if (t.providerId === "bigmodel")
        return pCr({ authorization: o, host: ... });  // resolveBizApiKey
      
      // Pour "zai" (notre cas)
      return Xno(e, o, r);  // resolveZaiBizToken
    }
  };
}
```

### 2.5 CLI OAuth Client (ndt)

```javascript
// ndt = createCliOAuthClient
// Rôle : Gère le polling CLI pour l'authentification OAuth

function ndt(e) {
  let t = ioo(e.baseUrl ?? too);  // too = "https://zcode.z.ai" (probablement)
  let r = new TextEncoder();
  
  return {
    async init(o, n) {
      // o = { pollToken }
      // n = signal d'annulation
      let i = await h7(e.httpClient, {
        body: r.encode(JSON.stringify({ provider: "zai" })),
        headers: {
          Authorization: `Bearer ${o.pollToken}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        url: `${t}/oauth/cli/init`
      }, n);
      return aoo(i.data);  // parse flow_id
    },
    
    async poll(o, n) {
      // o = { flowId, pollToken }
      let i = encodeURIComponent(o.flowId);
      let a = await h7(e.httpClient, {
        headers: {
          Authorization: `Bearer ${o.pollToken}`
        },
        method: "GET",
        url: `${t}/oauth/cli/poll/${i}`
      }, n);
      return soo(a.data);  // parse auth result
    }
  };
}
```

### 2.6 Générateur de pollToken

```javascript
// vCr = generatePollToken
// Rôle : Génère un token unique pour le polling OAuth

function vCr() {
  return crypto.randomBytes(32).toString("hex");
  // → 64 caractères hexadécimaux
}
```

---

## 3. Correspondance des Noms Minifiés

| Minifié | Nom réel | Rôle |
|---|---|---|
| `mCr` | — | Base URL `https://api.z.ai` |
| `fCr` | — | Content-Type `"application/json"` |
| `dCr` | — | Nom par défaut `"zcode"` |
| `noo` | — | Taille aléatoire `32` (bytes) |
| `ooo` | — | Content-Type `"application/json"` |
| `jCr` | — | Timeout `300000` (5 min) |
| `woo` | — | Intervalle poll `1000` (1 sec) |
| `Xno` | `resolveZaiBizToken` | Échange access_token → bizToken |
| `pCr` | `resolveBizApiKey` | Échange access_token → apiKey (BigModel) |
| `LCr` | `resolveCodingPlanApiKey` | Point d'entrée résolution clé |
| `hCr` | `createCodingPlanApiKeyResolver` | Crée le résolveur |
| `h7` | `requestRemoteData` | Fonction HTTP générique |
| `ndt` | `createCliOAuthClient` | Client OAuth CLI (init + poll) |
| `vCr` | `generatePollToken` | Génère token 64 hex |
| `koo` | `loginZCodeCli` | Login OAuth complet |
| `Soo` | `loginBigmodelCodingPlan` | Login BigModel |
| `Ioo` | `configureCodingPlanApiKey` | Écrit la config |
| `Coo` | `logoutZCodeCli` | Déconnexion |
| `Too` | `createOAuthClient` | Crée client OAuth standard |
| `Eoo` | `resolveCliZCodeEndpointOrigin` | Résout l'origine API |
| `BCr` | `createDefaultHttpClient` | Crée client HTTP par défaut |
| `Zue` | `createBizAuthHeaders` | Crée headers d'auth Biz |
| `Yno` | `pickOrgAndProject` | Extrait org/project |
| `eoo` | `isSuccessfulRemoteCode` | Vérifie code succès |
| `Ky` | `CodingPlanApiKeyError` | Erreur spécifique |
| `u_` | `ZCodeCliLoginError` | Erreur login CLI |

---

## 4. Endpoints Découverts

### 4.1 OAuth / Authentification

| Endpoint | Domaine | Usage | Statut |
|---|---|---|---|
| `GET /api/oauth/authorize` | `chat.z.ai` | Génération code OAuth | ✅ OK |
| `GET /api/oauth/userinfo` | `chat.z.ai` | Infos utilisateur | 🔍 Non testé |
| `POST /api/v1/oauth/token` | `zcode.z.ai` | Refresh token (si refresh_token dispo) | ❌ `parameter error` |
| `POST /oauth/cli/init` | `zcode.z.ai` | Init flow CLI (avec pollToken) | ⚠️ 307 → Next.js 404 |
| `GET /oauth/cli/poll/{flow_id}` | `zcode.z.ai` | Poll flow CLI | ⚠️ 404 |
| `POST /api/auth/z/login` | `api.z.ai` | Échange token → bizToken | ✅ Confirmé dans le code |

### 4.2 API LLM / Billing

| Endpoint | Domaine | Usage | Statut |
|---|---|---|---|
| `POST /api/v1/zcode-plan/anthropic/v1/messages` | `zcode.z.ai` | Appel LLM (Anthropic format) | ✅ OK (avec bon token) |
| `GET /api/v1/zcode-plan/billing/balance` | `zcode.z.ai` | Solde de tokens | 🔍 Non testé |
| `GET /api/v1/zcode-plan/billing/current` | `zcode.z.ai` | Plan actuel | 🔍 Non testé |
| `GET /api/coding/paas/v4` | `api.z.ai` | Catalogue modèles | ✅ OK |
| `POST /api/anthropic/v1/messages` | `api.z.ai` | Direct Anthropic API | 🔍 Non testé |

### 4.3 Système / Télémétrie

| Endpoint | Domaine | Usage | Statut |
|---|---|---|---|
| — | `zcode.z.ai` | ARMS (Alibaba Cloud Monitor) | ✅ Actif |
| — | `zcode.z.ai` | Crash reporting (Sentry-like) | ✅ Actif |

---

## 5. Stockage et Cycle de Vie des Tokens

### 5.1 Credentials (chiffré AES-256-GCM)

Fichier : `~/.zcode/v2/credentials.json`

```json
{
  "oauth:active_provider": "enc:v1:...",
  "oauth:zai:access_token": "enc:v1:...",
  "oauth:zai:refresh_token": "enc:v1:...",
  "oauth:zai:user_info": "enc:v1:...",
  "zcodejwttoken": "enc:v1:...",
  "zcodefeedbackclientid": "enc:v1:..."
}
```

**Clé de chiffrement** : `BIGMODEL_OAUTH_APP_SECRET` (env var, fallback)

### 5.2 Config (API Key en clair)

Fichier : `~/.zcode/v2/config.json`

```json
"builtin:zai-start-plan": {
  "options": {
    "apiKey": "eyJ...JWT",
    "baseURL": "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
    "apiKeyRequired": true
  }
}
```

### 5.3 Durée de Vie

| Token | Durée | Source |
|---|---|---|
| `code-<hex>` (OAuth) | ~minutes (non documenté) | Observation empirique |
| `zai.access_token` (OAuth) | Inconnue (pas de `expires_in`) | Code source |
| `bizToken` (JWT) | Pas de `exp` (géré serveur) | Décodage base64 |
| `refresh_token` | Présent dans credentials.json | Fichier credentials |

### 5.4 RPC Calls Observés (logs)

```text
oauth.restoreCachedSession        → restore la session depuis credentials.json
model-provider.refreshCodingPlanApiKey → rafraîchit la clé API (via /api/auth/z/login)
model-provider.getAll             → liste les modèles disponibles
zcode-session.create              → crée une session LLM
zcode-session.respondProviderRuntimeHeaders → headers pour le provider
model-provider.setProviderRuntimeHeaders → configure les headers d'appel
coding-plan-subscription.getBillingDiscount → info facturation
```

---

## 6. Conclusion et Recommandation Finale

### 6.1 Pourquoi le flow OAuth est non réplicable

Le flow OAuth de Z.AI Coding Plan utilise un mécanisme propriétaire à 3 couches :

1. **OAuth standard** (code-<hex>) — ne sert que d'identifiant de session
2. **Polling CLI** (`/oauth/cli/init` → `/oauth/cli/poll`) — endpoints internes (307 → 404 en production)
3. **Échange bizToken** (`/api/auth/z/login`) — nécessite un `access_token` qui ne peut être obtenu qu'après le polling CLI

Le `code-<hex>` n'est PAS un Bearer token. Il est échangé via le polling CLI contre un `access_token` OAuth, qui est ensuite échangé contre un `bizToken` via `/api/auth/z/login`.

### 6.2 Bloqueurs Identifiés

| Bloqueur | Cause |
|---|---|
| Polling CLI (init) | Endpoint redirige vers Next.js 404 (`/cn/oauth/cli/init`) |
| Polling CLI (poll) | Endpoint 404 |
| Captcha Aliyun | JWT apiKey retourne 403 captcha depuis un contexte externe |
| Paramètres d'échange | Le format exact du `POST /auth/z/login` nécessite un paramètre `token` non-standard |

### 6.3 Recommandations Stratégiques

| # | Stratégie | Faisabilité | Effort |
|---|---|---|---|
| **1** | **Import Manuel** (token JWT depuis `config.json` ZCode) | ✅ Fonctionnelle (captcha limitant) | Faible |
| **2** | **API Key Zhipu** (via `open.bigmodel.cn`) | ✅ Alternative officielle BigModel | Moyen |
| **3** | **Proxy OmniRoute → ZCode desktop** | ⚠️ Complexe (nécessite Electron) | Très élevé |
| **4** | **Reverse engineering complet du CLI polling** | ❌ Endpoints non fonctionnels | Abandonné |

### 6.4 Décision Finale

L'intégration du **Z.AI Coding Plan via OAuth n'est pas viable** pour OmniRoute en l'état actuel. Le mécanisme d'authentification est trop dépendant de l'infrastructure desktop ZCode (polling CLI interne, endpoints régionaux `/cn/`, captcha Aliyun côté proxy).

**Recommandation : Import manuel du token JWT** depuis le fichier `~/.zcode/v2/config.json` de l'utilisateur (clé `apiKey`). Ce token JWT peut être utilisé directement comme Bearer token sur l'endpoint `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages`.

**Si le captcha Aliyun bloque les appels** : essayer l'appel direct à `https://api.z.ai/api/anthropic/v1/messages` avec `x-api-key` comme header, ou rediriger l'utilisateur vers `https://open.bigmodel.cn` pour obtenir une vraie API Key.

---

## 7. Références

- Bundle analysé : `C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs` (9.4 Mo)
- Version ZCode : 3.1.1
- En-tête du bundle : `apps/zcode-cli/packages/cli/dist/zcode.cjs`
- User ID : `e312b1d6-c455-43fa-b695-4d8a7dfa2ffa`
- Device ID : `b9d600bb-89f3-4f5c-b4b1-dd93bd05425d`
