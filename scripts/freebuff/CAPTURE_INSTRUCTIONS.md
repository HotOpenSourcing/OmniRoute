# Instructions pour capturer le trafic CLI Freebuff

## Status
- ✅ mitmdump lancé sur port 8080
- 📝 Fichier de capture: `C:\Users\amine\freebuff-cli-real.mitm`

## Étapes pour capturer

### 1. Installer le certificat mitm (si pas déjà fait)
```powershell
# Le certificat est dans: C:\Users\amine\.mitmproxy\
# Double-cliquer sur mitmproxy-ca-cert.cer et l'installer dans "Autorités de certification racines de confiance"
```

### 2. Configurer le proxy pour Node.js
```powershell
$env:HTTPS_PROXY="http://127.0.0.1:8080"
$env:HTTP_PROXY="http://127.0.0.1:8080"
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
```

### 3. Lancer le CLI Freebuff
```powershell
# Option 1: Via node directement
node "C:\Users\amine\.config\manicode\codebuff\cli\release\index.js"

# Option 2: Via npm (si installé globalement)
freebuff

# Option 3: Via le package manager
npx freebuff
```

### 4. Dans le CLI, envoyer UN message simple
```
Exemple: "Hello, reply with PONG"
```

### 5. Fermer le CLI proprement (Ctrl+C)

### 6. Analyser la capture
```powershell
# Parser avec notre script Python
python C:\Users\amine\OmniRoute\scripts\freebuff\parse-mitm.py

# Ou visualiser avec mitmweb
mitmweb -r C:\Users\amine\freebuff-cli-real.mitm
```

## Ce qu'on cherche dans la capture

### Headers critiques à comparer
- `User-Agent` (version CLI exacte)
- `Authorization` (format du token)
- Tous les headers `x-*` custom
- `x-freebuff-instance-id`
- `x-cli-version`
- `x-client-fingerprint`
- Tout autre header non-standard

### Body de la requête chat
- Structure de `codebuff_metadata`
- Valeurs exactes de `cost_mode`, `run_id`, `client_id`
- Champs additionnels qu'on n'a pas

## Prochaine analyse
Une fois la capture faite, on va comparer ligne par ligne nos requêtes vs les vraies requêtes CLI.
