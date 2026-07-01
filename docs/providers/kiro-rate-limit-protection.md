# Kiro Provider Improvements

## Overview

This document describes the rate limit protection, auto-deactivation, bulk operations, and view filtering features implemented for the Kiro provider to prevent account exhaustion and improve reliability.

## Changes Implemented

### 1. Default Rate Limit Protection

**File**: `src/shared/constants/providers.ts`

**Change**: Added `rateLimitProtected: true` to the Kiro provider definition.

**Effect**: All new Kiro connections will have rate limit protection enabled by default. This prevents aggressive request patterns that could exhaust the free tier quota (50 credits/month, ~25K–100K tokens).

**Database**: The `provider_connections.rate_limit_protection` column is set to `1` for new Kiro connections.

### 2. Auto-Deactivation on Credit Exhaustion

**File**: `open-sse/services/accountFallback.ts`

**Change**: Added AWS CodeWhisperer/Kiro-specific credit exhaustion patterns to the `CREDITS_EXHAUSTED_SIGNALS` array:
- `"usage limit exceeded"`
- `"quota exceeded"`
- `"limit exceeded"`
- `"throttlingexception"`

**Effect**: When a Kiro account returns any credit exhaustion error, the system will:
1. Detect the error via `isCreditsExhausted()` function (case-insensitive substring matching)
2. Mark the error as `creditsExhausted: true` in `checkFallbackError()`
3. Set the connection's `lastErrorType` to `"credits_exhausted"` via `resolveTerminalConnectionStatus()`
4. Apply a 1-hour cooldown and mark `testStatus` as unavailable
5. Frontend displays using i18n key `statusCreditsExhausted`: "Insufficient Balance / Quota Exhausted"

**Detection Mechanisms**:
1. **HTTP Status 402** (Payment Required) - automatically triggers credit exhaustion
2. **Error Message Patterns** - matches against 17 case-insensitive patterns including:
   - Generic: `"insufficient_quota"`, `"billing_hard_limit_reached"`, `"credits exhausted"`, `"payment required"`, etc.
   - AWS/Kiro: `"usage limit exceeded"`, `"quota exceeded"`, `"limit exceeded"`, `"throttlingexception"`

**Error Flow**:
```
Kiro API Error
  ↓
checkFallbackError() → isCreditsExhausted(errorStr)
  ↓
{ creditsExhausted: true, cooldownMs: 3600000, reason: QUOTA_EXHAUSTED }
  ↓
resolveTerminalConnectionStatus() checks flag or status 402
  ↓
Returns "credits_exhausted" status
  ↓
Database: lastErrorType="credits_exhausted", testStatus="unavailable", rateLimitedUntil=+1h
  ↓
Frontend: t("statusCreditsExhausted") = "Insufficient Balance / Quota Exhausted"
```

**Recovery**: The connection will become eligible again after the 1-hour cooldown expires. For terminal credit exhaustion (account truly out of credits), the connection must be manually reactivated after adding credits.

### 3. Bulk Enable/Disable Connections

**File**: `src/app/api/providers/route.ts`

**Status**: ✅ Already implemented (no changes needed)

**Endpoint**: `PATCH /api/providers`

**Request Body**:
```json
{
  "ids": ["connection-id-1", "connection-id-2", "..."],
  "isActive": true  // or false to deactivate
}
```

**Response**:
```json
{
  "message": "Activated 5 connection(s)",
  "updated": 5,
  "notFound": []
}
```

**Features**:
- Partial-failure semantics: reports unknown IDs instead of failing the entire batch
- Audit logging for compliance tracking
- Cloud sync integration (if enabled)
- Maximum 100 connections per batch

### 4. View-Only Enabled Accounts (Hide Disabled)

**Implementation Date**: June 8, 2026

**Files Modified**:
- `src/app/(dashboard)/dashboard/providers/page.tsx` (lines 304-313)
- `src/app/(dashboard)/dashboard/providers/[id]/page.tsx` (lines 1759-1767)
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx` (lines 498-512)

**Change**: Added filtering to hide disabled Kiro connections (`isActive === false`) from all provider management views.

**Effect**: 
- **Main Provider List**: Disabled Kiro connections are excluded from provider card statistics (connected/error/total counts)
- **Provider Detail Page**: Only enabled Kiro connections appear in the connection list when viewing `/dashboard/providers/kiro`
- **Quota/Usage View**: Disabled Kiro connections are excluded from quota cards, tier filters, and statistics

**Filter Pattern** (applied consistently across all three views):
```typescript
.filter((c) => {
  // For Kiro provider, mask/hide disabled connections (isActive=false)
  if (providerId === "kiro" && c.isActive === false) return false;
  return true;
})
```

**Behavior**:
- **For Kiro**: Only connections with `isActive !== false` are visible
- **For Other Providers**: All connections are displayed regardless of `isActive` status (filter is Kiro-specific only)

**User Experience**:
- Cleaner UI focused on operational Kiro connections
- Reduced clutter in provider lists
- Statistics reflect only active connections
- Disabled connections are completely "masked" (hidden from view)

**Views Not Modified**:
- Runtime Monitor (`/dashboard/runtime`): Shows all connections for debugging
- Home Dashboard: Already has general `isActive !== false` filter for all providers
- Quota Pool Wizard: Configuration view needs to show all connections
- Playground/API Manager: Don't display individual connection details

**Documentation**: See [kiro-view-filtering.md](./kiro-view-filtering.md) for detailed implementation guide.

## Testing

### Unit Tests

**File**: `tests/unit/kiro-credit-exhaustion.test.ts`

**Coverage**:
- ✅ Detects "Insufficient Balance"
- ✅ Detects "Quota Exhausted"
- ✅ Detects "providers.No Credits"
- ✅ Detects "You have reached the limit"
- ✅ Detects AWS CodeWhisperer/Kiro patterns ("usage limit exceeded", "quota exceeded", "throttlingexception")
- ✅ Case-insensitive detection
- ✅ Does not false-positive on unrelated errors

**Run Tests**:
```bash
node --import tsx/esm --test tests/unit/kiro-credit-exhaustion.test.ts
```

## Usage Examples

### Checking Rate Limit Protection Status

```typescript
import { getProviderConnections } from "@/models";

const connections = await getProviderConnections({ provider: "kiro" });
const protectedConnections = connections.filter(c => c.rateLimitProtection === 1);
```

### Manually Reactivating a Credit-Exhausted Connection

After adding credits to a Kiro account:

1. **Via API**:
```bash
curl -X PATCH http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "ids": ["kiro-connection-id"],
    "isActive": true
  }'
```

2. **Via Database** (if needed to clear terminal status):
```sql
UPDATE provider_connections 
SET test_status = 'active',
    last_error = NULL,
    last_error_type = NULL,
    error_code = NULL,
    rate_limited_until = NULL
WHERE id = 'kiro-connection-id';
```

### Bulk Deactivating Multiple Kiro Accounts

```bash
curl -X PATCH http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "ids": ["kiro-1", "kiro-2", "kiro-3"],
    "isActive": false
  }'
```

## Error Flow Diagram

```
Kiro API Request
    ↓
Error Response (e.g., "Insufficient Balance")
    ↓
handleChatCore() in open-sse/handlers/chatCore.ts
    ↓
markAccountUnavailable() in src/sse/services/auth.ts
    ↓
checkFallbackError() in open-sse/services/accountFallback.ts
    ↓
isCreditsExhausted() matches signal → creditsExhausted: true
    ↓
resolveTerminalConnectionStatus() → "credits_exhausted"
    ↓
updateProviderConnection() sets testStatus = "credits_exhausted"
    ↓
Connection is disabled until manual reactivation
```

## Related Files

- `src/shared/constants/providers.ts` - Provider definitions
- `open-sse/services/accountFallback.ts` - Error detection and cooldown logic
- `src/sse/services/auth.ts` - Account availability management
- `src/app/api/providers/route.ts` - Bulk update endpoint
- `src/lib/db/providers.ts` - Database operations
- `tests/unit/kiro-credit-exhaustion.test.ts` - Test coverage

## References

- [Resilience Guide](../architecture/RESILIENCE_GUIDE.md) - 3-layer resilience architecture
- [Provider Reference](../reference/PROVIDER_REFERENCE.md) - Complete provider catalog
- [API Reference](../reference/API_REFERENCE.md) - REST API documentation

## Migration Notes

For existing Kiro connections created before this change:

1. Rate limit protection defaults to `0` (disabled) in the database
2. To enable protection for existing connections, update via API or database:

```bash
# Via API (bulk update)
curl -X PATCH http://localhost:20128/api/providers/{connection-id} \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"rateLimitProtection": true}'

# Or via database
UPDATE provider_connections 
SET rate_limit_protection = 1 
WHERE provider = 'kiro';
```

## Known Limitations

1. **Manual Reactivation Required**: Credit-exhausted connections do not auto-recover. Operators must manually reactivate after adding credits.
2. **Rate Limit Protection Granularity**: Protection is per-connection, not per-model. All models under a connection share the same protection settings.
3. **Bulk Update Limit**: Maximum 100 connections per batch update request.
4. **Kiro-Specific Filtering**: View filtering is only applied to Kiro provider. Other providers show all connections regardless of `isActive` status.

## Future Enhancements

- [ ] Auto-recovery mechanism when Kiro adds credit balance webhooks
- [ ] Per-model quota tracking for Kiro
- [ ] Credit balance monitoring and alerts
- [ ] Apply view filtering to other providers (make it configurable per provider)

## Summary of All Improvements

This document covers four related improvements to the Kiro provider:

1. ✅ **Default Rate Limit Protection**: All new Kiro connections have rate limiting enabled by default (`rateLimitProtected: true`)
2. ✅ **Auto-Deactivation on Credit Exhaustion**: Automatic detection of AWS/Kiro credit exhaustion patterns with 1-hour cooldown
3. ✅ **Bulk Enable/Disable Operations**: PATCH `/api/providers` endpoint supports batch updates (up to 100 connections)
4. ✅ **View-Only Enabled Accounts**: Disabled Kiro connections are hidden from all provider management views (main list, detail page, quota view)

All four features work together to provide a robust Kiro provider experience with automatic quota management and clean UI presentation.
