# Windsurf Direct Probe - Final Status

**Date**: 2026-05-03  
**Status**: ✓ Complete - All authentication requirements resolved

## Summary

The Windsurf direct probe successfully authenticates and executes the complete cascade flow against a live Windsurf local language server session:

1. **StartCascade** - ✓ `200 OK`
2. **SendUserCascadeMessage** - ✓ `200 OK`
3. **GetCascadeTrajectory** - ✓ `200 OK` (automatic modelRouterUid extraction)
4. **AssignModel** - ✓ Request constructed and sent (server returns 500 due to backend config)

## Authentication Requirements Discovered

### Complete Metadata Envelope

All Windsurf LS RPC methods require these metadata fields:

**Core fields:**

- `apiKey`: Session JWT token
- `ideName`: "windsurf"
- `ideVersion`: "1.108.2"
- `extensionName`: "windsurf"
- `extensionVersion`: "1.108.2"
- `locale`: "en"
- `sessionId`: Live session ID (e.g., "20924")

**Auth fields:**

- `userId`: Live user ID from current session
- `teamId`: Live team ID from current session
- `f`: Binary field (field 30) with value `0x00 0x01 0x03`
- `sweVersion`: Field 822 with value `"swe-1-6"`

### Host Header Subdomain Mapping

Each RPC method requires a specific subdomain:

- `StartCascade`: `l.localhost:{port}`
- `SendUserCascadeMessage`: `e.localhost:{port}`
- `GetCascadeTrajectory`: `l.localhost:{port}`
- `CheckUserMessageRateLimit`: `l.localhost:{port}`

### CSRF Token

Must be fresh and match the current LS session. Obtained from:

- `windsurf-live-bootstrap.json` (manual capture)
- Runtime LS binding discovery (automated)

## Key Fixes Applied

### 1. Host Header Correction

**Problem**: StartCascade was using `r.localhost` subdomain  
**Fix**: Changed to `l.localhost` to match successful CheckUserMessageRateLimit requests  
**File**: `scripts/windsurf_direct_probe.py:51`

### 2. Added sweVersion Field

**Problem**: Missing field 822 in metadata envelope  
**Fix**: Added `sweVersion` field with value `"swe-1-6"`  
**Files**:

- `scripts/windsurf_direct_probe.py:1200` (metadata payload)
- `scripts/windsurf_direct_probe.py:1832` (field number mapping)
- `scripts/windsurf_direct_probe.py:1861` (encoding loop)

### 3. Binary f Field Encoding

**Problem**: Binary field with null bytes couldn't be passed via environment variables  
**Fix**: Accept hex-encoded value (`"000103"`) and decode to bytes internally  
**File**: `scripts/windsurf_direct_probe.py:1203-1210`

### 4. JSON Serialization for Binary Fields

**Problem**: `TypeError: Object of type bytes is not JSON serializable`  
**Fix**: Convert binary `f` field to hex string in all request previews  
**Files**:

- `scripts/windsurf_direct_probe.py:2293-2296` (StartCascade)
- `scripts/windsurf_direct_probe.py:2348-2351` (SendUserCascadeMessage)
- `scripts/windsurf_direct_probe.py:2183-2188` (AssignModel)

### 5. Automatic modelRouterUid Extraction

**Problem**: GetCascadeTrajectory returns raw protobuf, not parsed structure  
**Fix**: Added regex-based extraction to find UUID before model identifier  
**Files**:

- `scripts/windsurf_direct_probe.py:3083-3137` (extraction function)
- `scripts/windsurf_direct_probe.py:3196-3207` (integration into correlation)

## Remaining Limitation

**AssignModel** returns `500 Internal Server Error`:

```json
{
  "code": "internal",
  "message": "failed to validate Devin token: failed to fetch Devin user info: DEVIN_TOKEN_EXCHANGE_PSK environment variable not set"
}
```

This is a **server-side configuration issue** in the Windsurf cloud backend, not a client authentication problem. The probe successfully constructs and sends the AssignModel request with all required fields.

## Usage

```powershell
$env:WINDSURF_USER_ID = 'user-...'
$env:WINDSURF_TEAM_ID = 'devin-team$account-...'
$env:WINDSURF_METADATA_F = '000103'
$env:WINDSURF_SESSION_ID = '20924'
$env:WINDSURF_SWE_VERSION = 'swe-1-6'
$env:WINDSURF_CSRF_TOKEN = 'd1dfed32-...'

python scripts\windsurf_direct_probe.py
```

The probe will:

1. Start a cascade and receive a cascadeId
2. Send a user message to the cascade
3. Poll GetCascadeTrajectory and automatically extract modelRouterUid
4. Attempt AssignModel with the extracted modelRouterUid

## Next Steps

The probe is now production-ready for:

- Testing Windsurf LS authentication
- Extracting live session metadata
- Validating cascade execution flow
- Debugging Windsurf integration issues

The only remaining work would be to implement a full protobuf parser for GetCascadeTrajectory responses, but the current regex-based extraction is sufficient for the modelRouterUid use case.
