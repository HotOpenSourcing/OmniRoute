# Windsurf Dual Approach Analysis

**Date**: 2026-05-04  
**Status**: Comparative analysis of active vs passive approaches  

---

## Executive Summary

Deux approches complémentaires pour interagir avec Windsurf ont été développées:

1. **Approche Passive** (OmniRoute modules) - Observation read-only via logs
2. **Approche Active** (windsurf_test_immediate.py) - Appels HTTP directs à l'API

Chaque approche a des forces et limitations distinctes. Une architecture hybride peut combiner le meilleur des deux.

---

## Approche 1: Passive Observation (OmniRoute)

### Architecture

```
windsurf_health_check.py
    ↓ (read logs)
%APPDATA%\Windsurf\logs\{epoch}\
    ↓ (extract)
Port, PID, Epoch, LastActivity
    ↓ (combine with)
windsurf_config.json (CSRF token manuel)
    ↓ (provide to)
windsurf_backend_resolver.py
    ↓ (routing decision)
OmniRoute chatCore
```

### Capacités

✅ **Détection automatique**:
- Port Extension Server (ex: 53300)
- Epoch actif (ex: 20260504T001558)
- PID Language Server (ex: 12116)
- État de santé (alive/stale/dead)
- Dernière activité avec timestamp

❌ **Limitations**:
- CSRF token nécessite configuration manuelle
- Pas de détection de submit en temps réel
- Pas de vérification d'inférence
- Latence de détection (logs buffered)

### Fichiers Créés

```
scripts/
├── windsurf_health_check.py           (145 lignes)
├── windsurf_connection_helper.py      (145 lignes)
├── windsurf_backend_resolver.py       (174 lignes)
└── windsurf_config.json               (généré)

docs/superpowers/
├── guides/2026-05-03-windsurf-integration-guide.md (650 lignes)
├── reports/2026-05-03-windsurf-runtime-inspection-report.md (296 lignes)
└── reports/2026-05-03-windsurf-integration-final-summary.md (415 lignes)
```

### Use Cases Idéaux

1. **Health check avant routing**
   - Vérifier si Windsurf est vivant
   - Éviter timeouts sur instance morte
   - Fallback automatique

2. **Monitoring continu**
   - Vérification périodique (60 secondes)
   - Alertes si crash/stale
   - Métriques pour dashboard

3. **Découverte de port dynamique**
   - Port change à chaque redémarrage
   - Détection automatique sans config

---

## Approche 2: Active API Testing (windsurf_test_immediate.py)

### Architecture

```
windsurf_test_immediate.py
    ↓ (HTTP POST)
http://localhost:59455/StartCascade
    ↓ (avec headers)
X-CSRF-Token: a5d004fc-a32d-49ab-ab4d-3d27db4167f9
Host: l.localhost
    ↓ (retourne)
cascadeId
    ↓ (utilise pour)
SendUserCascadeMessage, AssignModel
```

### Capacités

✅ **Vérification active**:
- Test complet du flow cascade
- Vérification d'authentification
- Validation de CSRF token
- Test de bout en bout
- Détection immédiate d'erreurs

✅ **Endpoints testés**:
- `StartCascade` - Création de session
- `SendUserCascadeMessage` - Envoi de message
- `AssignModel` - Attribution de modèle

❌ **Limitations**:
- Nécessite CSRF token hardcodé
- Port hardcodé (59455)
- Pas de découverte automatique
- Crée des sessions cascade réelles
- Pas de monitoring continu

### Configuration Hardcodée

```python
CSRF_TOKEN = "a5d004fc-a32d-49ab-ab4d-3d27db4167f9"
HOST_HEADER = "l.localhost"
API_BASE = "http://localhost:59455"  # Language Server port
```

### Use Cases Idéaux

1. **Validation d'authentification**
   - Tester si CSRF token fonctionne
   - Vérifier headers requis
   - Valider format de requête

2. **Test de bout en bout**
   - Vérifier flow complet cascade
   - Tester création de session
   - Valider envoi de message

3. **Debugging d'API**
   - Comprendre format de requête/réponse
   - Identifier erreurs d'API
   - Tester nouveaux endpoints

---

## Comparaison Détaillée

| Aspect | Passive (OmniRoute) | Active (test_immediate) |
|--------|---------------------|-------------------------|
| **Détection de port** | ✅ Automatique via logs | ❌ Hardcodé (59455) |
| **CSRF token** | ⚠️ Config manuelle une fois | ⚠️ Hardcodé dans script |
| **Health check** | ✅ Oui (alive/stale/dead) | ❌ Non |
| **Monitoring continu** | ✅ Oui (périodique) | ❌ Non |
| **Validation API** | ❌ Non | ✅ Oui (test complet) |
| **Impact runtime** | ✅ Read-only (aucun) | ⚠️ Crée sessions cascade |
| **Latence détection** | ⚠️ Logs buffered (~30s) | ✅ Immédiate |
| **Découverte epoch** | ✅ Automatique | ❌ Non |
| **Vérification PID** | ✅ Oui | ❌ Non |
| **Test d'inférence** | ❌ Non | ✅ Oui (via message) |

---

## Différences Architecturales Clés

### 1. Port Utilisé

**Passive**: Port 53300 (Extension Server)
- Extrait de `Windsurf.log`
- Port du serveur HTTP principal
- Change à chaque redémarrage

**Active**: Port 59455 (Language Server)
- Hardcodé dans script
- Port du Language Server RPC
- Différent du Extension Server

**Implication**: Les deux approches ciblent des composants différents de Windsurf!

### 2. Headers Requis

**Passive** (pour routing futur):
```python
{
    "x-csrf-token": csrf_token,
    "Content-Type": "application/json",
    "Accept": "application/json"
}
```

**Active**:
```python
{
    "X-CSRF-Token": csrf_token,
    "Host": "l.localhost",  # Tunnel header spécial
    "User-Agent": "Windsurf/2.1.32",
    "Content-Type": "application/json",
    "Accept": "application/json"
}
```

**Différence**: Active utilise `Host: l.localhost` (tunnel local) et `User-Agent` spécifique.

### 3. Endpoints

**Passive**: Prépare pour routing vers Extension Server
- Pas d'appels directs
- Fournit connection details pour OmniRoute

**Active**: Appelle directement Language Server RPC
- `/StartCascade`
- `/SendUserCascadeMessage`
- `/AssignModel`

---

## Architecture Hybride Proposée

Combiner les deux approches pour maximiser les capacités:

```
┌─────────────────────────────────────────────────────────────┐
│                  OmniRoute Routing Layer                     │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ Passive Health Check     │  │ Active API Validator     │
│ (windsurf_health_check)  │  │ (test_immediate logic)   │
│                          │  │                          │
│ • Port discovery         │  │ • CSRF validation        │
│ • Epoch detection        │  │ • API connectivity test  │
│ • PID verification       │  │ • Cascade flow test      │
│ • Activity age           │  │ • Model assignment test  │
└──────────────────────────┘  └──────────────────────────┘
            │                             │
            └─────────┬───────────────────┘
                      ▼
        ┌──────────────────────────┐
        │ Unified Backend Resolver │
        │                          │
        │ • Health: passive        │
        │ • Validation: active     │
        │ • Decision: combined     │
        └──────────────────────────┘
                      │
                      ▼
        ┌──────────────────────────┐
        │ windsurf_config.json     │
        │                          │
        │ • port (auto-detected)   │
        │ • csrfToken (validated)  │
        │ • lastHealthCheck        │
        │ • lastApiTest            │
        └──────────────────────────┘
```

### Workflow Hybride

**1. Setup Initial** (Une fois):
```python
# Étape 1: Découverte passive
health = windsurf_health_check()
# → port: 53300, epoch: 20260504T001558, pid: 12116

# Étape 2: Configuration CSRF
csrf_token = prompt_user_for_csrf_token()
# → token: a5d004fc-...

# Étape 3: Validation active
validation = test_windsurf_api(health["port"], csrf_token)
# → StartCascade: PASS, SendMessage: PASS

# Étape 4: Sauvegarde config validée
save_config({
    "port": health["port"],
    "csrfToken": csrf_token,
    "validated": True,
    "lastValidation": datetime.now()
})
```

**2. Monitoring Runtime** (Périodique):
```python
# Toutes les 60 secondes
health = windsurf_health_check()

if health["status"] == "dead":
    disable_windsurf_routing()
elif health["status"] == "stale":
    # Optionnel: validation active pour confirmer
    if not test_api_connectivity():
        disable_windsurf_routing()
```

**3. Routing Decision** (Chaque requête):
```python
backend = resolve_windsurf_backend(
    max_age_minutes=5.0,
    require_csrf=True,
    validate_api=False  # Validation déjà faite en monitoring
)

if backend["available"]:
    route_to_windsurf(backend)
else:
    route_to_fallback(backend["reason"])
```

---

## Modules à Créer pour Hybride

### 1. `windsurf_api_validator.py`

Extrait la logique de `windsurf_test_immediate.py` en module réutilisable:

```python
def validate_windsurf_api(
    port: int,
    csrf_token: str,
    host_header: str = "l.localhost"
) -> dict[str, Any]:
    """
    Validate Windsurf API connectivity and authentication.
    
    Returns:
        {
            "valid": bool,
            "startCascade": bool,
            "sendMessage": bool,
            "assignModel": bool,
            "cascadeId": str | None,
            "errors": list[str]
        }
    """
    pass
```

### 2. `windsurf_hybrid_resolver.py`

Combine passive health + active validation:

```python
def resolve_windsurf_backend_hybrid(
    max_age_minutes: float = 5.0,
    require_csrf: bool = True,
    validate_api: bool = False
) -> dict[str, Any]:
    """
    Resolve Windsurf backend with hybrid approach.
    
    Args:
        max_age_minutes: Max age for passive health
        require_csrf: Require CSRF token
        validate_api: Perform active API validation
    
    Returns:
        {
            "available": bool,
            "port": int,
            "csrfToken": str,
            "health": dict,  # From passive
            "validation": dict | None,  # From active if requested
            "reason": str | None
        }
    """
    pass
```

### 3. `windsurf_unified_config.py`

Gestion unifiée de configuration:

```python
class WindsurfConfig:
    """Unified Windsurf configuration manager."""
    
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.config = self.load()
    
    def update_from_health(self, health: dict) -> None:
        """Update config from passive health check."""
        pass
    
    def update_from_validation(self, validation: dict) -> None:
        """Update config from active API validation."""
        pass
    
    def is_valid(self) -> bool:
        """Check if config is valid and recent."""
        pass
```

---

## Recommandations

### Court Terme (Semaine 1)

1. **Créer `windsurf_api_validator.py`**
   - Extraire logique de `windsurf_test_immediate.py`
   - Rendre réutilisable et configurable
   - Ajouter tests unitaires

2. **Créer `windsurf_hybrid_resolver.py`**
   - Combiner passive health + active validation
   - Mode validation optionnel (coûteux)
   - Fallback gracieux si validation échoue

3. **Tester approche hybride**
   - Setup initial avec validation
   - Monitoring avec health check seul
   - Validation périodique (toutes les 5 minutes)

### Moyen Terme (Mois 1)

1. **Intégrer dans OmniRoute**
   - Utiliser hybrid resolver dans chatCore
   - Dashboard UI pour configuration
   - Métriques: health checks, validations, routing

2. **Améliorer détection de port**
   - Détecter à la fois Extension Server (53300) et Language Server (59455)
   - Router vers le bon port selon le type de requête
   - Fallback si un port échoue

3. **Automatiser validation CSRF**
   - Proxy MITM pour capture automatique
   - Ou extension Windsurf pour exposition
   - Mise à jour config automatique

### Long Terme (Trimestre 1)

1. **Partenariat Codeium**
   - Proposer use case: routing proxy avec observabilité
   - Demander APIs officielles
   - Éviter reverse engineering

2. **Extension Windsurf officielle**
   - Créer extension qui expose APIs
   - Health check endpoint
   - CSRF token endpoint
   - Éviter observation passive/active

---

## Conclusion

Les deux approches sont **complémentaires**, pas concurrentes:

| Use Case | Approche Recommandée |
|----------|---------------------|
| Health check continu | **Passive** (léger, read-only) |
| Validation d'authentification | **Active** (test complet) |
| Découverte de port | **Passive** (automatique) |
| Test de bout en bout | **Active** (vérification réelle) |
| Monitoring production | **Passive** (pas d'impact) |
| Setup initial | **Hybride** (passive + active) |

**Recommandation finale**: Implémenter l'architecture hybride qui utilise:
- **Passive** pour monitoring continu (60 secondes)
- **Active** pour validation initiale et périodique (5 minutes)
- **Hybride** pour routing decisions avec fallback gracieux

**Status**: Prêt pour implémentation des modules hybrides

---

**Auteur**: Claude Opus 4.7  
**Date**: 2026-05-04  
**Projet**: OmniRoute Windsurf Integration  
**Version**: 2.0.0 (Hybrid Architecture)
