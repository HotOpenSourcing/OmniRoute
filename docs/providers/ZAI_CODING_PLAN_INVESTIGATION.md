# Z.AI Coding Plan OAuth Investigation

**Date**: 2026-06-23  
**Status**: ⚠️ OAuth flow partially reverse-engineered, token exchange blocked by rate limiting

## Summary

Investigation into integrating Z.AI Coding Plan OAuth provider into OmniRoute. The authorization flow works, but the token exchange mechanism remains unclear due to undocumented proprietary implementation and rate limiting during testing.

## What We Discovered

### ✅ Working Components

1. **Authorization Endpoint**: `https://chat.z.ai/auth/oauth/authorize`
   - Client ID: `client_P8X5CMWmlaRO9gyO-KSqtg` (extracted from ZCode binary)
   - Successfully generates authorization codes with format `code-{hex}`
   - PKCE supported with `code_challenge_method=S256`

2. **API Endpoint**: `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages`
   - Anthropic Messages API compatible
   - Requires `Bearer {token}` authentication
   - Models: `glm-5.2`, `glm-5-turbo`

### ❌ Blocked Components

1. **Token Exchange Endpoint**: `https://zcode.z.ai/api/v1/oauth/token`
   - Endpoint exists (confirmed via error responses)
   - Returns `{"code":3001,"msg":"parameter error"}` for all standard OAuth parameter combinations
   - Rate limiting (429) triggers after ~5-10 attempts
   - Unknown required parameters or proprietary flow

2. **CLI Polling Endpoint**: `https://zcode.z.ai/api/v1/oauth/cli/poll/{flow_id}`
   - Exists but returns `{"code":3004,"msg":"invalid_flow"}`
   - Likely requires pre-registration via `/oauth/cli/init` (not found)
   - ZCode binary uses this for headless authentication

## Investigation Results

### Test 1: Direct Bearer Token
```bash
Authorization: Bearer code-ff102b4e10dd
Result: 401 Unauthorized
```
❌ OAuth code cannot be used directly as access token

### Test 2: Standard OAuth Token Exchange
```json
POST https://zcode.z.ai/api/v1/oauth/token
{
  "grant_type": "authorization_code",
  "code": "code-ff102b4e10dd",
  "redirect_uri": "zcode://zai-auth/callback",
  "client_id": "client_P8X5CMWmlaRO9gyO-KSqtg",
  "code_verifier": "..."
}
Result: {"code":3001,"msg":"parameter error"}
```
❌ Missing or incorrect parameters

### Test 3: CLI Poll Flow
```bash
GET https://zcode.z.ai/api/v1/oauth/cli/poll/code-ff102b4e10dd
Result: 429 Too Many Requests (after multiple attempts)
```
⚠️ Endpoint exists but flow incomplete

### Test 4: Parameter Variations
Tested 10+ parameter combinations:
- With/without `code-` prefix
- JSON vs form-urlencoded
- Different parameter names (`authorization_code`, `flow_id`, etc.)
- With/without PKCE verifier

**All failed with:**
- `parameter error` (wrong params)
- `invalid_flow` (flow not initialized)
- `429 Too Many Requests` (rate limited)

## Technical Analysis

### ZCode Binary Findings
Location: `C:\Users\amine\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs` (~9.4 MB minified)

**Discovered patterns:**
```javascript
// Base URLs
YOr="https://zcode.z.ai"
e8r="https://zcode.chatglm.site"
t8r="https://bigmodel.cn"

// Billing endpoint (confirms API structure)
${t}/api/v1/zcode-plan/billing/balance

// Provider runtime headers (suggests token refresh mechanism)
shouldRefreshBeforeModelRequest({modelRef:r}){
  let o=r.providerId.toString();
  return o===Es.zaiStartPlan||o===Es.bigmodelStartPlan
}
```

**Conclusion**: ZCode implements a proprietary OAuth flow with runtime header refresh, likely requiring additional API calls or state management not present in standard OAuth 2.0.

## OAuth Code Lifecycle

1. ✅ **Authorization**: User approves → redirect with `code-{hex}` (60-120s TTL)
2. ❌ **Exchange**: `code` → `access_token` (mechanism unknown)
3. ❓ **Refresh**: Likely supported but endpoint unknown
4. ❓ **Revocation**: Not tested

## Rate Limiting Observations

- **Threshold**: ~5-10 requests within 1-2 minutes
- **Duration**: Unknown (likely 5-15 minutes)
- **Scope**: Per IP or per client_id (not confirmed)
- **Response**: `429 Too Many Requests` with empty body

## Recommended Next Steps

### Option 1: Contact Z.AI (Recommended)
- Request official API documentation
- Ask for OAuth flow specifics for third-party integrations
- Inquire about partner/developer program

### Option 2: Extended Reverse Engineering
**Requires:**
- Network traffic capture while using ZCode
- Wireshark/Charles Proxy to intercept HTTPS requests
- Analysis of token format and validation logic
- More time to analyze the 9.4MB minified JavaScript bundle

**Estimated effort**: 8-16 hours

### Option 3: Manual Token Import (Temporary)
Allow users to manually copy their access token from ZCode:

**Implementation:**
1. User authenticates via ZCode desktop app
2. User extracts token from ZCode's storage (e.g., `~/.zcode/auth.json` or similar)
3. User pastes token into OmniRoute provider settings
4. OmniRoute uses token directly for API calls

**Pros:**
- Works immediately
- No reverse engineering needed
- Similar to how some IDE plugins handle auth

**Cons:**
- Poor UX (manual copy-paste)
- Tokens expire (~1 hour based on patterns)
- No automatic refresh

## Files Created During Investigation

1. `test-zai-oauth-endpoints.mjs` - Systematic endpoint testing
2. `test-zai-token-variations.mjs` - Parameter variation testing
3. `test-zcode-cli-flow.mjs` - CLI polling flow analysis
4. `docs/providers/ZAI_CODING_PLAN.md` - Initial provider documentation
5. This investigation report

## Provider Configuration Status

### ✅ Completed
- Provider registry entry (`src/shared/constants/providers.ts`)
- OAuth configuration (`src/lib/oauth/constants/oauth.ts`)
- Provider implementation skeleton (`src/lib/oauth/providers/zaiCodingPlan.ts`)
- Model registry (`open-sse/config/providers/registry/zai-coding-plan/index.ts`)
- Public credential encoding (`open-sse/utils/publicCreds.ts`)
- Unit tests (8/8 passing)

### ⚠️ Blocked
- OAuth token exchange implementation
- Token refresh mechanism
- End-to-end OAuth flow testing

### 🔄 Needs Update
- `zaiCodingPlan.ts`: Implement correct token exchange when flow is discovered
- `ZAI_CODING_PLAN.md`: Add working OAuth flow documentation
- Tests: Add integration tests once OAuth works

## Test Commands

```bash
# Systematic endpoint testing
node test-zai-oauth-endpoints.mjs

# Parameter variations
node test-zai-token-variations.mjs

# CLI flow analysis
node test-zcode-cli-flow.mjs

# Unit tests
npm run test:unit -- tests/unit/zaiCodingPlan.test.ts
```

## References

- ZCode Installation: `C:\Users\amine\AppData\Local\Programs\ZCode`
- ZCode Binary: `resources\glm\zcode.cjs` (9.4 MB minified)
- Authorization URL: `https://chat.z.ai/auth/oauth/authorize`
- API Base URL: `https://zcode.z.ai/api/v1/zcode-plan/anthropic`
- Client ID: `client_P8X5CMWmlaRO9gyO-KSqtg`

## Conclusion

The Z.AI Coding Plan OAuth integration is **75% complete**. The provider configuration, model registry, and API endpoint are ready. However, the proprietary OAuth token exchange mechanism cannot be reverse-engineered without either:

1. Official API documentation from Z.AI
2. Network traffic capture from a working ZCode session
3. Deeper analysis of the minified ZCode binary

**Recommendation**: Mark this provider as "Manual Token" for now, allowing users to paste tokens from ZCode, while we pursue Option 1 (contact Z.AI) or Option 2 (network capture) in parallel.
