# Z.AI Start Plan — Investigation CDP / Captcha — Findings

**Date**: 2026-06-27
**Status**: Étape 2 (réutilisabilité) répondue — **le captcha est single-use**

---

## Résultats empiriques

### 1. Captcha token = SINGLE-USE ❌

Replay exact de la requête capturée (même JWT, même captcha token, mêmes headers) :

```
🛡️ Status: 403
Body: {"code":3007,"msg":"captcha verify failed"}
```

Testé avec :
- Cookie `acw_tc` frais (acquis via GET /) → 403
- Headers Origin + Referer → 403
- Cookie + Origin + Referer combinés → 403

**Conclusion** : Le `securityToken` dans le `x-aliyun-captcha-verify-param` est consommé au premier appel. Il faut en générer un nouveau pour chaque requête LLM.

### 2. Les appels LLM viennent du MAIN PROCESS ⚠️

CDP Network sur le renderer a capturé **zéro** requêtes vers zcode.z.ai pendant 10 secondes.

Le `window.fetch()` du renderer retourne **401 Unauthorized** (pas 403) quand appelé directement — ni JWT ni captcha ne sont injectés par le renderer.

```
Architecture confirmée :
  Renderer (chat UI)
    → IPC → Main process (Electron host)
      → Main process génère le captcha token
      → Main process fait POST zcode.z.ai avec JWT + captcha
      → Retourne la réponse au renderer via IPC
```

### 3. Aliyun Captcha SDK présent dans le renderer

| Global | Type | Clés |
|--------|------|------|
| `initAliyunCaptcha` | function | Initialise le widget captcha |
| `AliyunCaptchaConfig` | object | region: "sgp", prefix: "no8xfe" |
| `AliyunCaptcha` | constructor | Constructeur du widget |
| `__ALIYUN_CAPTCHA_UTILS` | object | UUID, makeURL, isFunction... |
| `__ALIYUN_CRYPT` | object | CryptoJS complet (AES, SHA256, HMAC...) |
| `FEILIN.initFeiLin` | function | Fingerprint device Aliyun (飞鳞) |
| `ArmsEventBridge.send` | function | ARMS event reporting |
| `um.getToken()` | function | Retourne device fingerprint token |
| `z_um.getToken()` | function | Même token (alias ZCode) |

### 4. `um.getToken()` fonctionne mais ≠ captcha token

```json
{
  "umToken": "U0dfV0VCIzM3OTVkMjgyNDJhMTE2MTli...",
  "type": "string"
}
```

C'est un device fingerprint, PAS le `x-aliyun-captcha-verify-param`. Le captcha param a une structure différente :

```json
{
  "certifyId": "kGN0g6n7bE",
  "sceneId": "11xygtvd",
  "isSign": true,
  "securityToken": "6oOo7e72nA61uVLiZVKiLYqF1m9..."
}
```

### 5. `initAliyunCaptcha()` ne génère pas de token automatiquement

Initialisé avec succès (`{}` retourné) mais le callback `captchaVerifyCallback` n'a pas été déclenché. Le widget captcha nécessite un déclencheur (interaction utilisateur ou méthode spécifique sur l'instance).

### 6. `window.zcode` = Desktop API (pas LLM)

72 méthodes contextBridge (`[native code]`, arity 0) :
- Fenêtres : captureWindowScreenshot, setZoomLevel, setTitleBarTheme
- Fichiers : selectDirectory, selectFile, openInEditor, openInFileManager
- Updates : getUpdateState, quitAndInstallUpdate, onUpdateReady
- Remote : connectRemote, startWebRemoteControl, cancelPendingRemoteConnection
- OAuth : onOAuthCallback, registerOAuthState
- Telemetry : reportArmsCustomEvent, reportTelemetryEvent
- Docker/WSL : isDockerAvailable, listDockerContainers, listWSLDistros
- MCP : loadMcpFromUserDirectory, saveMcpToUserDirectory

**Aucune méthode LLM/chat/captcha.**

---

## Voies d'intégration restantes

### Path A — CDP Bridge (RECOMMANDÉ) ✅

Utiliser ZCode comme backend LLM via CDP :
1. ZCode tourne avec `--remote-debugging-port=9222`
2. CDP `Input.dispatchKeyEvent` pour taper un message dans le chat
3. ZCode main process gère le captcha + JWT en interne
4. Capturer la réponse LLM depuis le DOM du renderer
5. OmniRoute route vers ZCode via CDP au lieu de HTTP

**Avantages** : Contourne totalement le problème captcha
**Inconvénients** : ZCode doit tourner, latence ajoutée, concurrence limitée

### Path B — Génération de captcha token frais ⚠️

1. Appeler `initAliyunCaptcha()` avec le bon trigger
2. Capturer le `captchaVerifyParam` depuis `captchaVerifyCallback`
3. L'utiliser immédiatement en HTTP

**Bloqué par** : le SDK ne produit pas de token sans interaction. Le renderer est maintenant `about:blank` — il faut redémarrer ZCode.

### Path C — Hook Frida du main process ⚠️

1. Hook `https.request` au niveau V8 (pas export natif)
2. Capturer/modifier les requêtes du main process
3. Complexité élevée, fragilité

---

## Prochaine action recommandée

1. **Redémarrer ZCode** avec `--remote-debugging-port=9222`
2. **Tester Path A** : script CDP qui tape un message dans le chat ZCode et capture la réponse
3. Si Path A fonctionne → intégrer comme executor `zai-start-plan` dans OmniRoute
