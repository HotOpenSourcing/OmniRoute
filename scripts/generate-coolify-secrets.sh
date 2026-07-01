#!/bin/bash
# OmniRoute - Coolify Secrets Generator
#
# This script generates secure random secrets required for OmniRoute deployment on Coolify.
# Run this before deploying to get the required environment variables.
#
# Usage: bash scripts/generate-coolify-secrets.sh

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  OmniRoute - Coolify Deployment Secrets Generator"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo "❌ Error: openssl is not installed or not in PATH"
    echo "   Please install OpenSSL to generate secure secrets"
    exit 1
fi

echo "Generating secure random secrets..."
echo ""

# Generate JWT_SECRET (48 bytes base64 for session tokens)
JWT_SECRET=$(openssl rand -base64 48)
echo "✅ JWT_SECRET generated (64 characters base64)"

# Generate API_KEY_SECRET (32 bytes hex for API key encryption)
API_KEY_SECRET=$(openssl rand -hex 32)
echo "✅ API_KEY_SECRET generated (64 characters hex)"

# Generate optional STORAGE_ENCRYPTION_KEY (32 bytes hex for SQLite encryption)
STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "✅ STORAGE_ENCRYPTION_KEY generated (64 characters hex)"

# Generate optional QDRANT_API_KEY (32 bytes base64 for Qdrant security)
QDRANT_API_KEY=$(openssl rand -base64 32)
echo "✅ QDRANT_API_KEY generated (44 characters base64)"

# Generate a secure random initial password
INITIAL_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-20)
echo "✅ INITIAL_PASSWORD generated (20 characters alphanumeric)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Copy these values to Coolify Environment Variables"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "# Required Secrets (MUST be set in Coolify)"
echo "JWT_SECRET=$JWT_SECRET"
echo ""
echo "API_KEY_SECRET=$API_KEY_SECRET"
echo ""
echo "INITIAL_PASSWORD=$INITIAL_PASSWORD"
echo ""
echo "# Optional: Database Encryption (recommended for production)"
echo "STORAGE_ENCRYPTION_KEY=$STORAGE_ENCRYPTION_KEY"
echo "STORAGE_ENCRYPTION_KEY_VERSION=v1"
echo ""
echo "# Optional: Qdrant API Key (recommended if exposing ports)"
echo "QDRANT_API_KEY=$QDRANT_API_KEY"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Copy the secrets above to Coolify:"
echo "   - Go to your Docker Compose application in Coolify"
echo "   - Navigate to 'Environment Variables' section"
echo "   - Add each variable with its generated value"
echo ""
echo "2. Set your public URL:"
echo "   BASE_URL=https://omniroute.demo.ty-dev.site"
echo "   NEXT_PUBLIC_BASE_URL=https://omniroute.demo.ty-dev.site"
echo ""
echo "3. Optional: Save secrets securely"
echo "   bash scripts/generate-coolify-secrets.sh > .secrets.env"
echo "   # Add .secrets.env to .gitignore (already done)"
echo ""
echo "⚠️  SECURITY WARNING:"
echo "   - Never commit these secrets to git"
echo "   - Store them in a password manager"
echo "   - The initial password can be changed after first login"
echo ""
echo "✅ Secrets generated successfully!"
echo ""
