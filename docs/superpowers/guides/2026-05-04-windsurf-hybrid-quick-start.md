# Windsurf Hybrid Approach - Quick Start Guide

**Date**: 2026-05-04  
**Version**: 2.0.0 (Hybrid Architecture)  

---

## Overview

L'approche hybride combine:
- **Passive observation** (léger, continu) pour health checks
- **Active validation** (complet, périodique) pour vérification d'authentification

---

## Quick Start

### 1. Setup Initial (Une fois)

```bash
# Démarrer Windsurf d'abord
# Puis configurer la connexion
python scripts/windsurf_connection_helper_hybrid.py
```

Le helper va:
1. ✅ Détecter automatiquement le port Extension Server (passive)
2. ✅ Détecter l'epoch et PID (passive)
3. ❓ Demander le CSRF token (manuel)
4. ❓ Demander le port Language Server (défaut: 59455)
5. ✅ Valider la configuration via API test (active)
6. ✅ Sauvegarder dans `windsurf_config.json`

### 2. Utilisation dans OmniRoute

```python
from scripts.windsurf_hybrid_resolver import resolve_windsurf_backend_hybrid

# Routing decision (chaque requête)
backend = resolve_windsurf_backend_hybrid(
    max_age_minutes=5.0,      # Seuil de fraîcheur
    require_csrf=True,        # Nécessite CSRF token
    validate_api=False        # Pas de validation (déjà fait en monitoring)
)

if backend["available"]:
    # Route vers Windsurf
    url = f"http://127.0.0.1:{backend['port']}/api/v1/cascade/start"
    headers = {"x-csrf-token": backend["csrfToken"]}
    # ... faire la requête
else:
    # Fallback vers autre provider
    logger.info(f"Windsurf unavailable: {backend['reason']}")
    # ... router vers Claude API, etc.
```

### 3. Monitoring Périodique

```python
import time
from scripts.windsurf_hybrid_resolver import resolve_windsurf_backend_hybrid

def monitor_windsurf():
    """Monitor Windsurf health every 60 seconds."""
    while True:
        # Health check (passive, léger)
        backend = resolve_windsurf_backend_hybrid(
            max_age_minutes=5.0,
            require_csrf=True,
            validate_api=False  # Pas de validation à chaque check
        )
        
        if backend["status"] == "alive":
            logger.info(f"Windsurf OK (age: {backend['health']['ageMinutes']:.1f}min)")
        elif backend["status"] == "stale":
            logger.warning(f"Windsurf stale (age: {backend['health']['ageMinutes']:.1f}min)")
        else:
            logger.error("Windsurf dead, disabling routing")
        
        time.sleep(60)  # Check every minute
```

### 4. Validation Périodique (Optionnel)

```python
import time
from scripts.windsurf_hybrid_resolver import resolve_windsurf_backend_hybrid

def validate_windsurf_periodically():
    """Validate Windsurf API every 5 minutes."""
    while True:
        # API validation (active, complet)
        backend = resolve_windsurf_backend_hybrid(
            max_age_minutes=5.0,
            require_csrf=True,
            validate_api=True  # Validation active
        )
        
        if backend["validation"]:
            if backend["validation"]["valid"]:
                logger.info("Windsurf API validation: PASS")
            else:
                logger.error(f"Windsurf API validation: FAIL - {backend['validation']['errors']}")
        
        time.sleep(300)  # Validate every 5 minutes
```

---

## Modules Créés

### 1. `windsurf_api_validator.py`

**Fonction**: Validation active de l'API Windsurf

**API principale**:
```python
from windsurf_api_validator import validate_windsurf_api

result = validate_windsurf_api(
    port=59455,
    csrf_token="a5d004fc-...",
    host_header="l.localhost",
    timeout=10.0,
    test_message=True,
    test_model=False
)

# result = {
#     "valid": bool,
#     "startCascade": bool,
#     "sendMessage": bool,
#     "assignModel": bool,
#     "cascadeId": str | None,
#     "errors": list[str],
#     "details": dict
# }
```

**Test rapide**:
```bash
python scripts/windsurf_api_validator.py
```

### 2. `windsurf_hybrid_resolver.py`

**Fonction**: Résolution hybride (passive + active)

**API principale**:
```python
from windsurf_hybrid_resolver import resolve_windsurf_backend_hybrid

backend = resolve_windsurf_backend_hybrid(
    max_age_minutes=5.0,
    require_csrf=True,
    validate_api=False
)

# backend = {
#     "available": bool,
#     "port": int,                    # Extension Server
#     "languageServerPort": int,      # Language Server
#     "csrfToken": str,
#     "epoch": str,
#     "status": str,
#     "health": dict,                 # Passive results
#     "validation": dict | None,      # Active results (if requested)
#     "reason": str | None
# }
```

**Test**:
```bash
python scripts/windsurf_hybrid_resolver.py
```

### 3. `windsurf_unified_config.py`

**Fonction**: Gestion unifiée de configuration

**API principale**:
```python
from windsurf_unified_config import WindsurfConfig

config = WindsurfConfig()

# Update from health check
health = windsurf_health_check()
config.update_from_health(health)

# Update from validation
validation = validate_windsurf_api(...)
config.update_from_validation(validation, language_server_port=59455)

# Check validity
if config.is_valid():
    port = config.get("port")
    csrf_token = config.get("csrfToken")

# Check if validation needed
if config.needs_validation(validation_interval_minutes=5.0):
    # Run validation
    pass
```

**Test**:
```bash
python scripts/windsurf_unified_config.py
```

### 4. `windsurf_connection_helper_hybrid.py`

**Fonction**: Setup interactif avec validation

**Usage**:
```bash
python scripts/windsurf_connection_helper_hybrid.py
```

**Workflow**:
1. Health check (passive)
2. Prompt CSRF token
3. Prompt Language Server port
4. API validation (active)
5. Save config

---

## Configuration File: `windsurf_config.json`

**Format v2.0.0**:
```json
{
  "version": "2.0.0",
  "port": 53300,
  "languageServerPort": 59455,
  "epoch": "20260504T001558",
  "pid": 12116,
  "csrfToken": "a5d004fc-a32d-49ab-ab4d-3d27db4167f9",
  "lastUpdated": "2026-05-04T00:16:30.736000+00:00",
  "lastHealthCheck": "2026-05-04T00:16:30.736000+00:00",
  "lastValidation": "2026-05-04T00:17:00.123000+00:00",
  "lastValidationResult": "success",
  "lastValidationErrors": [],
  "status": "alive"
}
```

**Champs**:
- `version`: Version du format de config (2.0.0)
- `port`: Port Extension Server (détecté automatiquement)
- `languageServerPort`: Port Language Server (configuré manuellement)
- `epoch`: Epoch Windsurf actif
- `pid`: PID Language Server
- `csrfToken`: Token CSRF (configuré manuellement)
- `lastUpdated`: Timestamp dernière mise à jour
- `lastHealthCheck`: Timestamp dernier health check (passive)
- `lastValidation`: Timestamp dernière validation (active)
- `lastValidationResult`: Résultat dernière validation (success/failed)
- `lastValidationErrors`: Erreurs de validation
- `status`: État de santé (alive/stale/dead)

---

## Comparaison v1.0.0 vs v2.0.0

| Aspect | v1.0.0 (Passive Only) | v2.0.0 (Hybrid) |
|--------|----------------------|-----------------|
| **Port detection** | ✅ Extension Server | ✅ Extension + Language Server |
| **Health check** | ✅ Passive | ✅ Passive |
| **API validation** | ❌ Non | ✅ Active (optionnel) |
| **CSRF validation** | ❌ Non | ✅ Oui (via API test) |
| **Config format** | Simple | Structuré avec versioning |
| **Validation tracking** | ❌ Non | ✅ Timestamp + résultat |
| **Migration** | N/A | ✅ Auto-migration de v1 → v2 |

---

## Troubleshooting

### Problème: "API validation failed"

**Causes possibles**:
1. CSRF token invalide ou expiré
2. Language Server port incorrect
3. Windsurf pas démarré ou crashé
4. Firewall bloque localhost

**Solutions**:
```bash
# 1. Vérifier que Windsurf tourne
Get-Process -Name "Windsurf"

# 2. Reconfigurer avec nouveau token
python scripts/windsurf_connection_helper_hybrid.py

# 3. Vérifier le port Language Server
# Ouvrir Windsurf DevTools et chercher "Language Server" dans console
```

### Problème: "Configuration is not valid"

**Causes possibles**:
1. Config trop ancienne (> 30 minutes)
2. CSRF token manquant
3. Port manquant

**Solutions**:
```bash
# Reconfigurer
python scripts/windsurf_connection_helper_hybrid.py
```

### Problème: "Health check shows 'dead'"

**Causes possibles**:
1. Windsurf pas démarré
2. Logs pas encore écrits (attendre 30 secondes)
3. Epoch trop ancien

**Solutions**:
```bash
# Démarrer Windsurf et attendre 30 secondes
Start-Sleep -Seconds 30

# Relancer health check
python scripts/windsurf_health_check.py
```

---

## Migration depuis v1.0.0

La migration est **automatique**. Le système détecte l'ancien format et migre vers v2.0.0:

```python
# Ancien format (v1.0.0)
{
  "port": 53300,
  "epoch": "20260504T001558",
  "pid": 12116,
  "csrfToken": "a5d004fc-...",
  "lastUpdated": "2026-05-04T00:16:30.736000+00:00",
  "status": "alive"
}

# Nouveau format (v2.0.0) - auto-migré
{
  "version": "2.0.0",
  "port": 53300,
  "languageServerPort": null,  # À configurer
  "epoch": "20260504T001558",
  "pid": 12116,
  "csrfToken": "a5d004fc-...",
  "lastUpdated": "2026-05-04T00:16:30.736000+00:00",
  "lastHealthCheck": null,
  "lastValidation": null,
  "lastValidationResult": null,
  "lastValidationErrors": [],
  "status": "alive"
}
```

Après migration, relancer le helper pour configurer le Language Server port:
```bash
python scripts/windsurf_connection_helper_hybrid.py
```

---

## Best Practices

### 1. Setup Initial
- ✅ Utiliser `windsurf_connection_helper_hybrid.py` pour setup
- ✅ Valider la configuration avec API test
- ✅ Vérifier que `lastValidationResult` = "success"

### 2. Monitoring Production
- ✅ Health check passif toutes les 60 secondes (léger)
- ✅ Validation active toutes les 5 minutes (complet)
- ✅ Alerter si status = "dead" ou validation échoue

### 3. Routing Decisions
- ✅ Utiliser `validate_api=False` pour routing (déjà validé en monitoring)
- ✅ Fallback automatique si unavailable
- ✅ Logger la raison d'unavailability

### 4. Configuration
- ✅ Sauvegarder `windsurf_config.json` dans version control (sans CSRF token)
- ✅ Utiliser variables d'environnement pour CSRF token en production
- ✅ Revalider après redémarrage Windsurf

---

## Next Steps

### Court Terme
1. Tester les modules hybrides avec Windsurf actif
2. Vérifier la migration automatique v1 → v2
3. Valider le workflow complet (setup → monitoring → routing)

### Moyen Terme
1. Intégrer dans OmniRoute chatCore
2. Créer UI dashboard pour configuration
3. Ajouter métriques (health checks, validations, routing)

### Long Terme
1. Automatiser capture CSRF token (proxy MITM)
2. Support multi-instance Windsurf
3. Partenariat Codeium pour APIs officielles

---

**Auteur**: Claude Opus 4.7  
**Date**: 2026-05-04  
**Projet**: OmniRoute Windsurf Integration  
**Version**: 2.0.0 (Hybrid Architecture)
