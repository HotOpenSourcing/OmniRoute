---
title: Coolify Webhook Deployment
---

# Coolify Webhook Deployment

## Overview

The `.github/workflows/deploy-coolify.yml` workflow deploys OmniRoute to Coolify using webhook-based deployment instead of SSH.

## Setup

### 1. Get Your Coolify Webhook URL

Your Coolify webhook URL format:
```
https://YOUR_COOLIFY_INSTANCE/api/v1/deploy?uuid=iphjbdqu9afcrizuhsgf9gbh&force=false
```

**Application Details**:
- **Name**: omni-route
- **UUID**: `iphjbdqu9afcrizuhsgf9gbh`
- **Repository**: HotOpenSourcing/OmniRoute
- **Branch**: main
- **Status**: running:healthy
- **Compose file**: `/docker-compose.coolify.yaml`
- **Domain**: https://omni.demo.ty-dev.site

### 2. Add GitHub Secret

1. Go to your GitHub repository: https://github.com/HotOpenSourcing/OmniRoute
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add:
   - **Name**: `COOLIFY_WEBHOOK_URL`
   - **Value**: Your full webhook URL from step 1

### 3. Enable Deployment

Make sure the repository variable `DEPLOY_ENABLED` is set to `true`:
1. Go to **Settings** → **Secrets and variables** → **Actions** → **Variables** tab
2. Create or update `DEPLOY_ENABLED` = `true`

## How It Works

### Trigger Conditions

The workflow runs when:
1. **Automatic**: After the "Publish to Docker Hub" workflow completes successfully
2. **Manual**: Via workflow_dispatch (Actions tab → Deploy to Coolify → Run workflow)

Both require `DEPLOY_ENABLED=true`.

### Deployment Process

1. GitHub workflow triggers Coolify webhook via HTTP GET request
2. Coolify receives the webhook and queues a deployment
3. Coolify:
   - Pulls latest code from `main` branch
   - Builds the Docker image using `docker-compose.coolify.yaml`
   - Performs health checks (if configured)
   - Deploys the new version with zero-downtime

### Webhook Parameters

- `uuid=iphjbdqu9afcrizuhsgf9gbh` - Your application UUID
- `force=false` - Only deploy if there are actual changes (recommended)
- Set `force=true` to force deployment even without code changes

## Monitoring

### GitHub Actions
- View workflow runs: https://github.com/HotOpenSourcing/OmniRoute/actions
- Workflow only confirms webhook trigger (HTTP 200/201)
- Does not wait for full deployment or health checks

### Coolify Dashboard
Monitor actual deployment progress in your Coolify dashboard:
- Build logs
- Container status
- Health check results
- Deployment history

### Health Checks

Coolify is configured with:
- **Path**: `/`
- **Port**: 3000
- **Method**: GET
- **Expected code**: 200
- **Scheme**: http
- **Interval**: 5s
- **Timeout**: 5s
- **Retries**: 10
- **Start period**: 5s

Currently **disabled** (`health_check_enabled: false`). Enable in Coolify dashboard for automatic rollback on failed deployments.

## Troubleshooting

### Webhook Trigger Fails (HTTP 4xx/5xx)

**Check**:
1. Webhook URL is correct and includes the UUID
2. Coolify instance is reachable from GitHub runners
3. Application still exists in Coolify (UUID hasn't changed)

**Fix**: Update `COOLIFY_WEBHOOK_URL` secret with correct URL.

### Deployment Triggered but Fails

**Check Coolify dashboard for**:
1. Build errors (docker-compose.coolify.yaml issues)
2. Container startup failures
3. Health check failures (if enabled)
4. Resource limits (memory: 6144m, cpus: 4)

**Common issues**:
- Missing environment variables in Coolify
- Docker Compose configuration errors
- Port conflicts
- Memory/CPU constraints

### Application Not Updating

**Possible causes**:
1. `force=false` and no code changes detected
2. Coolify still building (check build queue)
3. Old container still running (deployment in progress)

**Solutions**:
- Wait for build to complete (check Coolify logs)
- Manually restart from Coolify dashboard
- Change webhook to `force=true` temporarily

## Comparison: Coolify vs VPS (SSH)

| Aspect | Coolify Webhook | VPS SSH (deploy-vps.yml) |
|--------|-----------------|--------------------------|
| **Trigger** | HTTP webhook | SSH command execution |
| **Build** | Coolify handles | npm install -g on VPS |
| **Health checks** | Coolify native | Custom curl polling |
| **Rollback** | Coolify automatic | Manual |
| **Logs** | Coolify dashboard | PM2 logs |
| **Zero-downtime** | Built-in | Manual PM2 restart |
| **Network** | Any (HTTP) | SSH port 22 reachable |
| **Secrets** | 1 (webhook URL) | 3 (host, user, key) |

## Manual Deployment

### Via GitHub Actions UI
1. Go to **Actions** tab
2. Select **Deploy to Coolify** workflow
3. Click **Run workflow**
4. Select `main` branch
5. Click **Run workflow**

### Via Coolify Dashboard
1. Navigate to your application
2. Click **Deploy** button
3. Monitor build progress

### Via Coolify CLI (if installed)
```bash
coolify deploy application iphjbdqu9afcrizuhsgf9gbh
```

## Security Notes

- Webhook URL is not authenticated by default (UUID acts as token)
- Keep `COOLIFY_WEBHOOK_URL` secret - anyone with it can trigger deployments
- Consider enabling IP whitelist in Coolify if available
- Use `force=false` to prevent unnecessary deployments

## Related Files

- Workflow: `.github/workflows/deploy-coolify.yml`
- Docker Compose: `docker-compose.coolify.yaml`
- Dockerfile: `Dockerfile`
- VPS deployment (alternative): `.github/workflows/deploy-vps.yml`
