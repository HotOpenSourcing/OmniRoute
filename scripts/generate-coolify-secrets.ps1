# OmniRoute - Coolify Secrets Generator (PowerShell)
#
# This script generates secure random secrets required for OmniRoute deployment on Coolify.
# Run this before deploying to get the required environment variables.
#
# Usage: .\scripts\generate-coolify-secrets.ps1

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  OmniRoute - Coolify Deployment Secrets Generator" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if OpenSSL is available
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $opensslPath) {
    Write-Host "❌ Error: openssl is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   You can:" -ForegroundColor Yellow
    Write-Host "   1. Install Git for Windows (includes OpenSSL)" -ForegroundColor Yellow
    Write-Host "   2. Install OpenSSL from https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    Write-Host "   3. Use WSL: wsl bash scripts/generate-coolify-secrets.sh" -ForegroundColor Yellow
    exit 1
}

Write-Host "Generating secure random secrets..." -ForegroundColor Green
Write-Host ""

# Generate JWT_SECRET (48 bytes base64 for session tokens)
$JWT_SECRET = & openssl rand -base64 48
Write-Host "✅ JWT_SECRET generated (64 characters base64)" -ForegroundColor Green

# Generate API_KEY_SECRET (32 bytes hex for API key encryption)
$API_KEY_SECRET = & openssl rand -hex 32
Write-Host "✅ API_KEY_SECRET generated (64 characters hex)" -ForegroundColor Green

# Generate optional STORAGE_ENCRYPTION_KEY (32 bytes hex for SQLite encryption)
$STORAGE_ENCRYPTION_KEY = & openssl rand -hex 32
Write-Host "✅ STORAGE_ENCRYPTION_KEY generated (64 characters hex)" -ForegroundColor Green

# Generate optional QDRANT_API_KEY (32 bytes base64 for Qdrant security)
$QDRANT_API_KEY = & openssl rand -base64 32
Write-Host "✅ QDRANT_API_KEY generated (44 characters base64)" -ForegroundColor Green

# Generate a secure random initial password
$INITIAL_PASSWORD = (& openssl rand -base64 16) -replace '[=+/]','' | Select-Object -First 1 | ForEach-Object { $_.Substring(0, [Math]::Min(20, $_.Length)) }
Write-Host "✅ INITIAL_PASSWORD generated (20 characters alphanumeric)" -ForegroundColor Green

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Copy these values to Coolify Environment Variables" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "# Required Secrets (MUST be set in Coolify)" -ForegroundColor Yellow
Write-Host "JWT_SECRET=$JWT_SECRET"
Write-Host ""
Write-Host "API_KEY_SECRET=$API_KEY_SECRET"
Write-Host ""
Write-Host "INITIAL_PASSWORD=$INITIAL_PASSWORD"
Write-Host ""
Write-Host "# Optional: Database Encryption (recommended for production)" -ForegroundColor Yellow
Write-Host "STORAGE_ENCRYPTION_KEY=$STORAGE_ENCRYPTION_KEY"
Write-Host "STORAGE_ENCRYPTION_KEY_VERSION=v1"
Write-Host ""
Write-Host "# Optional: Qdrant API Key (recommended if exposing ports)" -ForegroundColor Yellow
Write-Host "QDRANT_API_KEY=$QDRANT_API_KEY"
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Copy the secrets above to Coolify:" -ForegroundColor White
Write-Host "   - Go to your Docker Compose application in Coolify"
Write-Host "   - Navigate to 'Environment Variables' section"
Write-Host "   - Add each variable with its generated value"
Write-Host ""
Write-Host "2. Set your public URL:" -ForegroundColor White
Write-Host "   BASE_URL=https://omniroute.demo.ty-dev.site"
Write-Host "   NEXT_PUBLIC_BASE_URL=https://omniroute.demo.ty-dev.site"
Write-Host ""
Write-Host "3. Optional: Save secrets securely" -ForegroundColor White
Write-Host "   .\scripts\generate-coolify-secrets.ps1 > .secrets.env"
Write-Host "   # Add .secrets.env to .gitignore (already done)"
Write-Host ""
Write-Host "⚠️  SECURITY WARNING:" -ForegroundColor Red
Write-Host "   - Never commit these secrets to git"
Write-Host "   - Store them in a password manager"
Write-Host "   - The initial password can be changed after first login"
Write-Host ""
Write-Host "✅ Secrets generated successfully!" -ForegroundColor Green
Write-Host ""
