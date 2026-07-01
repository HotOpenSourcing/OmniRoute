# Generate Coolify Secrets

Automated secret generation scripts for OmniRoute Coolify deployment.

## Usage

### Auto-detect platform (Recommended)
```bash
npm run secrets:generate
```
This automatically runs the correct script for your platform (bash on Linux/macOS, PowerShell on Windows).

### Platform-specific commands

#### Linux/macOS/WSL (Bash)
```bash
npm run secrets:generate:bash
# or directly:
bash scripts/generate-coolify-secrets.sh
```

#### Windows (PowerShell)
```powershell
npm run secrets:generate:powershell
# or directly:
.\scripts\generate-coolify-secrets.ps1
```

#### Windows (Git Bash)
```bash
npm run secrets:generate:bash
# or directly:
bash scripts/generate-coolify-secrets.sh
```

## What Gets Generated

### Required Secrets
- **JWT_SECRET** - 64-character base64 string for session token signing
- **API_KEY_SECRET** - 64-character hex string for API key encryption
- **INITIAL_PASSWORD** - 20-character alphanumeric password (changeable after first login)

### Optional Secrets
- **STORAGE_ENCRYPTION_KEY** - 64-character hex string for SQLite database encryption
- **QDRANT_API_KEY** - 44-character base64 string for Qdrant API security

## Quick Start

1. **Generate secrets:**
   ```bash
   # Auto-detect platform (recommended)
   npm run secrets:generate
   
   # Or platform-specific:
   npm run secrets:generate:bash        # Linux/macOS/WSL/Git Bash
   npm run secrets:generate:powershell  # Windows PowerShell
   ```

2. **Copy output to Coolify:**
   - Go to your Coolify dashboard
   - Open your OmniRoute application
   - Navigate to "Environment Variables"
   - Paste the generated secrets

3. **Add public URLs:**
   ```bash
   BASE_URL=https://omniroute.demo.ty-dev.site
   NEXT_PUBLIC_BASE_URL=https://omniroute.demo.ty-dev.site
   ```

4. **Deploy!**

## Saving Secrets Securely

### Save to file (DON'T commit!)
```bash
# Auto-detect platform
npm run secrets:generate > .secrets.env

# Or platform-specific
npm run secrets:generate:bash > .secrets.env        # Bash
npm run secrets:generate:powershell > .secrets.env  # PowerShell
```

The `.secrets.env` file is already in `.gitignore` and will not be committed.

### Store in password manager
Copy the generated secrets to your password manager (1Password, Bitwarden, etc.)

## Requirements

- **OpenSSL** must be installed and in PATH
  - Linux/macOS: Usually pre-installed
  - Windows: Included with Git for Windows, or install from [slproweb.com](https://slproweb.com/products/Win32OpenSSL.html)

## Security Notes

⚠️ **Never commit secrets to git**

✅ **Best practices:**
- Generate fresh secrets for each environment (dev/staging/prod)
- Store secrets in a password manager
- Rotate secrets periodically (especially after team member changes)
- Change INITIAL_PASSWORD immediately after first login

## Troubleshooting

### "openssl command not found"

**Linux/macOS:**
```bash
# Ubuntu/Debian
sudo apt-get install openssl

# macOS
brew install openssl
```

**Windows:**
- Install Git for Windows (includes OpenSSL): https://git-scm.com/download/win
- OR use WSL: `wsl bash scripts/generate-coolify-secrets.sh`
- OR download OpenSSL: https://slproweb.com/products/Win32OpenSSL.html

### Script won't execute (PowerShell)

If you get "execution policy" errors:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\generate-coolify-secrets.ps1
```

## Integration with Coolify

The generated secrets work seamlessly with `docker-compose.coolify.yaml`:

```yaml
environment:
  JWT_SECRET: ${JWT_SECRET}                    # ← Paste here
  API_KEY_SECRET: ${API_KEY_SECRET}            # ← Paste here
  INITIAL_PASSWORD: ${INITIAL_PASSWORD}        # ← Paste here
  STORAGE_ENCRYPTION_KEY: ${STORAGE_ENCRYPTION_KEY}  # Optional
  QDRANT_API_KEY: ${QDRANT_API_KEY}            # Optional
```

## Example Output

```
═══════════════════════════════════════════════════════════════
  OmniRoute - Coolify Deployment Secrets Generator
═══════════════════════════════════════════════════════════════

Generating secure random secrets...

✅ JWT_SECRET generated (64 characters base64)
✅ API_KEY_SECRET generated (64 characters hex)
✅ INITIAL_PASSWORD generated (20 characters alphanumeric)
✅ STORAGE_ENCRYPTION_KEY generated (64 characters hex)
✅ QDRANT_API_KEY generated (44 characters base64)

═══════════════════════════════════════════════════════════════
  Copy these values to Coolify Environment Variables
═══════════════════════════════════════════════════════════════

# Required Secrets (MUST be set in Coolify)
JWT_SECRET=ABC123...xyz789

API_KEY_SECRET=def456...uvw012

INITIAL_PASSWORD=ghi789jkl012mno345pq

# Optional: Database Encryption (recommended for production)
STORAGE_ENCRYPTION_KEY=rst678...xyz901
STORAGE_ENCRYPTION_KEY_VERSION=v1

# Optional: Qdrant API Key (recommended if exposing ports)
QDRANT_API_KEY=tuv234...wxy567

═══════════════════════════════════════════════════════════════
```
