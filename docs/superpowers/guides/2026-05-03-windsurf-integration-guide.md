# Windsurf Passive Observation - Integration Guide

**Date**: 2026-05-03  
**Status**: Production-ready for health checks  
**Limitation**: CSRF token requires manual configuration

---

## Executive Summary

L'observateur passif Windsurf peut détecter:
- ✅ **Port Extension Server** (ex: 53300)
- ✅ **Epoch actif** (ex: 20260504T001558)
- ✅ **PID Language Server** (ex: 12116)
- ✅ **État de santé** (alive/stale/dead)
- ✅ **Dernière activité** avec timestamp
- ❌ **CSRF Token** (nécessite configuration manuelle)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OmniRoute Routing                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│          windsurf_backend_resolver.py                        │
│  • resolve_windsurf_backend()                                │
│  • Vérifie health + CSRF token                              │
│  • Retourne: available, port, csrfToken                     │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ windsurf_health_check.py │  │ windsurf_config.json     │
│ • Observation passive    │  │ • Port: 53300            │
│ • Détecte epoch/port/PID │  │ • CSRF token (manuel)    │
│ • Calcule âge activité   │  │ • Epoch                  │
└──────────────────────────┘  └──────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Windsurf Logs (Passive)                         │
│  %APPDATA%\Windsurf\logs\{epoch}\window*\exthost\           │
│  • Windsurf.log - Bootstrap events (LS_START, port, PID)    │
│  • Windsurf ACP.log - Agent registrations                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Modules Créés

### 1. `windsurf_health_check.py`

**Fonction**: Observation passive du runtime Windsurf

**Capacités**:
- Découvre l'epoch le plus récent
- Extrait le port Extension Server des logs
- Extrait le PID Language Server
- Calcule l'âge de la dernière activité
- Vérifie si le processus est vivant

**Usage**:
```bash
python scripts/windsurf_health_check.py
```

**Output**:
```json
{
  "status": "alive",
  "port": 53300,
  "epoch": "20260504T001558",
  "pid": 12116,
  "lastActivity": "2026-05-04T00:16:30.736000+00:00",
  "ageMinutes": 2.5,
  "csrfToken": null,
  "message": "Windsurf is active (last activity 2.5 minutes ago)"
}
```

**Exit codes**:
- `0`: alive (< 5 minutes)
- `1`: stale (5-30 minutes)
- `2`: dead (> 30 minutes)
- `3`: error

### 2. `windsurf_connection_helper.py`

**Fonction**: Assistant interactif pour configurer la connexion Windsurf

**Workflow**:
1. Vérifie le health de Windsurf
2. Charge la configuration existante
3. Demande le CSRF token à l'utilisateur (avec instructions)
4. Sauvegarde dans `windsurf_config.json`

**Usage**:
```bash
python scripts/windsurf_connection_helper.py
```

**Instructions pour obtenir le CSRF token**:
1. Ouvrir Windsurf et démarrer un chat Cascade
2. Ouvrir Fiddler/Charles/Browser DevTools (Network tab)
3. Soumettre un message dans Cascade
4. Trouver la requête POST vers `https://server.self-serve.windsurf.com/api/v1/cascade/...`
5. Copier la valeur du header `x-csrf-token` ou `csrf-token`

**Format du token**: UUID (ex: `a07dae5d-afc8-4fd9-839e-b505412f481b`)

### 3. `windsurf_backend_resolver.py`

**Fonction**: Module d'intégration pour OmniRoute

**API principale**:
```python
from windsurf_backend_resolver import resolve_windsurf_backend

backend = resolve_windsurf_backend(
    max_age_minutes=5.0,  # Seuil de fraîcheur
    require_csrf=True     # Nécessite CSRF token
)

if backend["available"]:
    # Windsurf est disponible pour routing
    url = f"http://127.0.0.1:{backend['port']}/api/v1/cascade/start"
    headers = {"x-csrf-token": backend["csrfToken"]}
    # Faire la requête...
else:
    # Fallback vers autre provider
    print(f"Reason: {backend['reason']}")
```

**Retour**:
```python
{
    "available": bool,      # True si Windsurf prêt pour routing
    "port": int | None,     # Port Extension Server
    "csrfToken": str | None,# Token CSRF (de config)
    "epoch": str | None,    # Epoch actif
    "status": str,          # alive/stale/dead/error
    "message": str,         # Message lisible
    "reason": str | None    # Raison si unavailable
}
```

**Fonctions utilitaires**:
```python
# Obtenir les headers HTTP
headers = get_windsurf_request_headers(csrf_token)
# {"x-csrf-token": "...", "Content-Type": "application/json", ...}

# Construire l'URL API
url = get_windsurf_api_url(port, "/api/v1/cascade/start")
# "http://127.0.0.1:53300/api/v1/cascade/start"
```

---

## Configuration File: `windsurf_config.json`

**Emplacement**: `scripts/windsurf_config.json`

**Format**:
```json
{
  "port": 53300,
  "epoch": "20260504T001558",
  "pid": 12116,
  "csrfToken": "a07dae5d-afc8-4fd9-839e-b505412f481b",
  "lastUpdated": "2026-05-04T00:16:30.736000+00:00",
  "status": "alive"
}
```

**Champs**:
- `port`: Port Extension Server (détecté automatiquement)
- `epoch`: Epoch Windsurf actif (détecté automatiquement)
- `pid`: PID Language Server (détecté automatiquement)
- `csrfToken`: Token CSRF (fourni manuellement par l'utilisateur)
- `lastUpdated`: Timestamp dernière activité
- `status`: État de santé au moment de la configuration

---

## Intégration dans OmniRoute

### Étape 1: Setup initial

```bash
# 1. Démarrer Windsurf
# 2. Configurer la connexion
python scripts/windsurf_connection_helper.py
# 3. Suivre les instructions pour obtenir le CSRF token
```

### Étape 2: Intégration dans le routing

```python
# Dans open-sse/handlers/chatCore.ts ou équivalent
from scripts.windsurf_backend_resolver import resolve_windsurf_backend

def route_chat_request(request):
    # Vérifier si Windsurf est disponible
    windsurf = resolve_windsurf_backend(max_age_minutes=5.0)
    
    if windsurf["available"]:
        # Router vers Windsurf
        return route_to_windsurf(
            url=f"http://127.0.0.1:{windsurf['port']}/api/v1/cascade/start",
            headers={"x-csrf-token": windsurf["csrfToken"]},
            request=request
        )
    else:
        # Fallback vers autre provider
        logger.info(f"Windsurf unavailable: {windsurf['reason']}")
        return route_to_fallback_provider(request)
```

### Étape 3: Health check périodique

```python
# Vérifier périodiquement si Windsurf est toujours vivant
import time
from scripts.windsurf_health_check import windsurf_health_check

def monitor_windsurf_health():
    while True:
        health = windsurf_health_check()
        
        if health["status"] == "dead":
            logger.warning("Windsurf is dead, disabling routing")
            disable_windsurf_routing()
        elif health["status"] == "stale":
            logger.info("Windsurf is stale, may be idle")
        else:
            logger.info(f"Windsurf is alive (age: {health['ageMinutes']:.1f}min)")
        
        time.sleep(60)  # Check every minute
```

---

## Limitations et Workarounds

### ❌ Limitation 1: CSRF Token manuel

**Problème**: Le CSRF token n'est pas accessible via observation passive

**Raisons**:
- Token existe uniquement en mémoire du processus NodeService
- Non loggé dans les fichiers plaintext
- Non persisté dans LevelDB ou fichiers de config
- Transmis uniquement via headers HTTP

**Workaround**:
1. **Configuration manuelle** (Recommandé pour OmniRoute):
   - Utiliser `windsurf_connection_helper.py` pour configurer une fois
   - Stocker le token dans `windsurf_config.json`
   - Réutiliser le token pour toutes les requêtes
   - Reconfigurer si le token expire (rare)

2. **Capture réseau automatique** (Complexe):
   - Implémenter un proxy MITM (Fiddler/Charles en mode automatique)
   - Intercepter les requêtes Windsurf → server.self-serve.windsurf.com
   - Extraire automatiquement le CSRF token des headers
   - Mettre à jour `windsurf_config.json` automatiquement

3. **Demander à l'utilisateur** (Simple):
   - Afficher un message dans OmniRoute UI
   - "Windsurf détecté mais CSRF token manquant"
   - Lien vers instructions pour obtenir le token
   - Input field pour coller le token

### ❌ Limitation 2: Submit detection

**Problème**: L'observateur passif ne peut pas détecter quand un submit Cascade se produit

**Raisons**:
- Événements cascade non loggés en temps réel
- Logs buffered (flush delayed)
- network.log vide (logging désactivé)

**Workaround**:
- Ne pas utiliser pour détection de submit
- Utiliser uniquement pour health check avant routing
- Accepter que le routing soit "best effort"

### ❌ Limitation 3: Horloge système

**Problème**: Calcul d'âge incorrect si horloge système désynchronisée

**Workaround**:
- Utiliser `abs()` pour gérer les timestamps futurs
- Considérer les événements "futurs" comme récents
- Ajouter une marge de tolérance (±5 minutes)

---

## Production Recommendations

### ✅ Utiliser l'observateur passif pour:

1. **Health check avant routing**
   - Vérifier si Windsurf est vivant avant de router
   - Éviter les timeouts sur instance morte
   - Fallback automatique si dead/stale

2. **Découverte de port dynamique**
   - Port Extension Server change à chaque redémarrage
   - Détection automatique via logs
   - Pas besoin de configuration manuelle du port

3. **Monitoring de santé**
   - Vérifier périodiquement l'état de Windsurf
   - Alerter si Windsurf crash ou devient stale
   - Métriques pour dashboard OmniRoute

4. **Détection d'epoch**
   - Identifier quand Windsurf redémarre (nouvel epoch)
   - Invalider les caches/sessions liés à l'ancien epoch
   - Reconfigurer si nécessaire

### ❌ Ne PAS utiliser pour:

1. **Détection de submit**
   - Impossible de détecter quand un submit se produit
   - Pas d'événements en temps réel

2. **Vérification d'inférence**
   - Impossible de prouver qu'une inférence a été exécutée
   - Pas d'evidence P4 (inference-boundary)

3. **Trace propagation**
   - Pas de trace IDs déterministes en mode passif
   - Impossible de corréler request → inference → response

4. **Authentification automatique**
   - CSRF token nécessite configuration manuelle
   - Pas d'extraction automatique du token

---

## Troubleshooting

### Problème: "Windsurf appears inactive"

**Causes possibles**:
1. Windsurf n'est pas démarré
2. Windsurf a crashé
3. Logs pas encore flushés (attendre 30-60 secondes)
4. Horloge système désynchronisée

**Solutions**:
```bash
# Vérifier si Windsurf tourne
Get-Process -Name "Windsurf"

# Vérifier l'epoch le plus récent
ls $env:APPDATA\Windsurf\logs | Sort-Object Name -Descending | Select-Object -First 1

# Relancer le health check
python scripts/windsurf_health_check.py
```

### Problème: "CSRF token not configured"

**Solution**:
```bash
# Configurer le token manuellement
python scripts/windsurf_connection_helper.py

# Ou éditer directement windsurf_config.json
# {
#   "csrfToken": "votre-token-ici"
# }
```

### Problème: "Port not found in logs"

**Causes possibles**:
1. Epoch trop récent (logs pas encore écrits)
2. Windsurf n'a pas démarré le Language Server
3. Logs corrompus

**Solutions**:
```bash
# Attendre 10-15 secondes après démarrage Windsurf
Start-Sleep -Seconds 15
python scripts/windsurf_health_check.py

# Vérifier manuellement les logs
cat $env:APPDATA\Windsurf\logs\{epoch}\window1\exthost\codeium.windsurf\Windsurf.log
```

---

## Next Steps

### Court terme (Implémentation OmniRoute)

1. **Intégrer le backend resolver dans chatCore**
   - Ajouter `resolve_windsurf_backend()` dans le flux de routing
   - Implémenter fallback si Windsurf unavailable
   - Tester avec Windsurf vivant et mort

2. **Créer UI pour configuration CSRF**
   - Ajouter page dans dashboard OmniRoute
   - Input field pour CSRF token
   - Instructions visuelles pour obtenir le token
   - Bouton "Test Connection" pour valider

3. **Ajouter monitoring**
   - Health check périodique (toutes les 60 secondes)
   - Métriques: uptime, dernière activité, nombre de routing
   - Alertes si Windsurf devient dead

### Moyen terme (Amélioration)

1. **Capture réseau automatique**
   - Implémenter proxy MITM pour extraire CSRF automatiquement
   - Ou utiliser Fiddler API pour automation
   - Mettre à jour config automatiquement

2. **Support multi-instance**
   - Détecter plusieurs instances Windsurf (multi-window)
   - Router vers l'instance la plus récente/active
   - Load balancing si plusieurs instances

3. **Améliorer détection de fraîcheur**
   - Ajouter plus de sources de logs (renderer.log, main.log)
   - File watching pour détection temps réel
   - Réduire latence de détection

### Long terme (Partenariat)

1. **Demander APIs officielles à Codeium**
   - Proposer use case: routing proxy avec observabilité
   - Demander endpoint pour health check
   - Demander méthode officielle pour obtenir CSRF token

2. **Alternative: Windsurf plugin**
   - Créer extension Windsurf qui expose APIs
   - Endpoint local pour health check
   - Endpoint pour obtenir CSRF token
   - Éviter observation passive

---

## Files Created

```
scripts/
├── windsurf_health_check.py           # Health check passif
├── windsurf_connection_helper.py      # Assistant configuration interactif
├── windsurf_backend_resolver.py       # Module intégration OmniRoute
└── windsurf_config.json               # Configuration (créé par helper)
```

## Documentation

```
docs/superpowers/
├── specs/
│   ├── 2026-05-03-windsurf-hybrid-runtime-current-design.md
│   ├── 2026-05-03-windsurf-passive-observation-gap-analysis.md
│   └── 2026-05-03-windsurf-observability-final-status.md
└── reports/
    └── 2026-05-03-windsurf-runtime-inspection-report.md
```

---

## Conclusion

L'observateur passif Windsurf est **production-ready pour health checks** avec la limitation que le CSRF token nécessite une configuration manuelle initiale. Cette approche est suffisante pour:

- ✅ Détecter si Windsurf est vivant avant routing
- ✅ Obtenir le port dynamique automatiquement
- ✅ Fallback automatique si Windsurf mort/stale
- ✅ Monitoring de santé continu

La configuration manuelle du CSRF token est un compromis acceptable car:
- Le token est stable (ne change pas fréquemment)
- Configuration une seule fois par session Windsurf
- Processus simple avec instructions claires
- Alternative (capture réseau) trop complexe pour le bénéfice

**Recommandation**: Intégrer dans OmniRoute avec UI pour configuration CSRF token.
