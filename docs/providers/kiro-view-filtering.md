# Kiro Provider: View-Only Enabled Accounts (Task 4)

## Overview

Implemented UI filtering to show only enabled (active) Kiro accounts while hiding disabled ones across all provider management views. This improves the user experience by reducing clutter and focusing attention on operational connections.

## Implementation Date

June 8, 2026

## Changes Made

### 1. Main Provider List (`src/app/(dashboard)/dashboard/providers/page.tsx`)

**Location**: Lines 304-313 in `getProviderStats()` function

**Change**: Added second filter chain to exclude disabled Kiro connections when calculating provider statistics.

```typescript
const providerConnections = connections.filter((c) => {
  if (c.provider !== providerId) return false;
  if (authType === "free") return true;
  return c.authType === authType;
}).filter((c) => {
  // For Kiro provider, mask/hide disabled connections (isActive=false)
  if (providerId === "kiro" && c.isActive === false) return false;
  return true;
});
```

**Effect**: Disabled Kiro connections are excluded from:
- Connected count
- Error count
- Total count
- Provider card statistics

### 2. Provider Detail Page (`src/app/(dashboard)/dashboard/providers/[id]/page.tsx`)

**Location**: Lines 1759-1767 in `fetchConnections()` callback

**Change**: Added second filter chain after provider ID filter to exclude disabled Kiro connections.

```typescript
const filtered = (connectionsData.connections || [])
  .filter((c) => c.provider === providerId)
  .filter((c) => {
    // For Kiro provider, mask/hide disabled connections (isActive=false)
    if (providerId === "kiro" && c.isActive === false) return false;
    return true;
  });
```

**Effect**: When viewing the Kiro provider detail page (`/dashboard/providers/kiro`), only enabled connections are displayed in the connection list.

### 3. Quota/Usage Dashboard (`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx`)

**Location**: Lines 498-512 in `filteredConnections` useMemo

**Change**: Added second filter chain to exclude disabled Kiro connections from quota view.

```typescript
const filteredConnections = useMemo(
  () =>
    connections
      .filter(
        (conn) =>
          USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
          (conn.authType === "oauth" || conn.authType === "apikey")
      )
      .filter((conn) => {
        // For Kiro provider, mask/hide disabled connections (isActive=false)
        if (conn.provider === "kiro" && conn.isActive === false) return false;
        return true;
      }),
  [connections]
);
```

**Effect**: Disabled Kiro connections are excluded from:
- Quota card display
- Tier statistics
- Purchase type filters
- Status filters
- Environment tag filters

## Behavior

### For Kiro Provider (`provider === "kiro"`)

- **Enabled connections** (`isActive !== false`): ✅ Displayed in all views
- **Disabled connections** (`isActive === false`): ❌ Hidden from all views

### For Other Providers

- **No change**: All connections are displayed regardless of `isActive` status
- Filter is Kiro-specific only

## User Experience

### Before

- Disabled Kiro connections appeared in all provider lists and detail views
- Users saw cluttered connection lists mixing active and inactive accounts
- Statistics included disabled connections in total counts

### After

- Only enabled Kiro connections are visible in all views
- Cleaner UI focused on operational connections
- Statistics reflect only active connections
- Disabled connections are "masked" (completely hidden from view)

## Technical Notes

### Filter Pattern

The same filter pattern is applied consistently across all three views:

```typescript
.filter((c) => {
  if (providerId === "kiro" && c.isActive === false) return false;
  return true;
})
```

This pattern:
- Checks if the connection is for Kiro provider
- Returns `false` (excludes) if `isActive === false`
- Returns `true` (includes) for all other cases

### Database Field

The filter relies on the `isActive` field in the `provider_connections` table:
- Type: `boolean`
- Values: `true` (enabled), `false` (disabled), `null` (treated as enabled)
- Updated via: PATCH `/api/providers/:id` endpoint

### Views Not Modified

The following views were analyzed but **not modified** because they serve different purposes:

1. **Runtime Monitor** (`/dashboard/runtime`): Shows all connections for debugging/monitoring, including disabled ones
2. **Home Dashboard** (`/dashboard`): Already filters with `isActive !== false` for all providers (general filter, not Kiro-specific)
3. **Quota Pool Wizard**: Configuration view where users need to see all connections to understand pool membership
4. **API Manager**: Uses allowed connections list which has its own filtering logic
5. **Playground API Tab**: Doesn't display individual connection details

## Testing Recommendations

### Manual Testing

1. **Create test connections**:
   - Add 3 Kiro connections (e.g., conn1, conn2, conn3)
   - Disable conn2: PATCH `/api/providers/:conn2_id` with `{ isActive: false }`

2. **Test main provider list** (`/dashboard/providers`):
   - Verify only conn1 and conn3 appear in Kiro card statistics
   - Check that total count shows 2 (not 3)
   - Verify other providers still show all connections

3. **Test provider detail page** (`/dashboard/providers/kiro`):
   - Verify only conn1 and conn3 are listed
   - Verify conn2 is completely absent from the connection list

4. **Test quota view** (`/dashboard/usage`):
   - Verify only conn1 and conn3 appear in Kiro quota cards
   - Verify conn2 is not in any filter results

5. **Test bulk disable**:
   - Use bulk action to disable all Kiro connections
   - Verify Kiro card shows "0 connected" on main list
   - Verify Kiro detail page shows empty state
   - Verify Kiro disappears from quota view

### Unit Test Scenarios

Recommended test file: `tests/unit/kiro-view-filtering.test.ts`

```typescript
describe("Kiro View Filtering", () => {
  test("getProviderStats excludes disabled Kiro connections", () => {
    const connections = [
      { provider: "kiro", isActive: true, testStatus: "active" },
      { provider: "kiro", isActive: false, testStatus: "active" },
      { provider: "openai", isActive: false, testStatus: "active" },
    ];
    const stats = getProviderStats("kiro", "oauth");
    expect(stats.total).toBe(1); // Only 1 active Kiro connection
  });

  test("filteredConnections excludes disabled Kiro from quota view", () => {
    const connections = [
      { provider: "kiro", authType: "oauth", isActive: true },
      { provider: "kiro", authType: "oauth", isActive: false },
    ];
    const filtered = filterForQuotaView(connections);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].isActive).toBe(true);
  });

  test("other providers show all connections regardless of isActive", () => {
    const connections = [
      { provider: "openai", isActive: true },
      { provider: "openai", isActive: false },
    ];
    const stats = getProviderStats("openai", "apikey");
    expect(stats.total).toBe(2); // Both connections count
  });
});
```

## Related Tasks

This is Task 4 of the Kiro provider improvements series:

1. ✅ **Task 1**: Enable rate limit protection by default ([docs/providers/kiro-rate-limit-protection.md](./kiro-rate-limit-protection.md))
2. ✅ **Task 2**: Auto-deactivate on credit exhaustion ([docs/providers/kiro-rate-limit-protection.md](./kiro-rate-limit-protection.md))
3. ✅ **Task 3**: Bulk enable/disable operations ([docs/providers/kiro-rate-limit-protection.md](./kiro-rate-limit-protection.md))
4. ✅ **Task 4**: View filtering (this document)

## API Compatibility

No API changes required. The filtering is implemented entirely in the frontend using existing `isActive` field from the `provider_connections` table.

## Rollback Procedure

If this feature needs to be reverted:

1. Remove the second `.filter()` chain from all three files:
   - `src/app/(dashboard)/dashboard/providers/page.tsx` (lines 310-313)
   - `src/app/(dashboard)/dashboard/providers/[id]/page.tsx` (lines 1764-1767)
   - `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx` (lines 507-511)

2. All connections will be visible again regardless of `isActive` status.

## Validation

- ✅ ESLint: No errors
- ✅ TypeScript: No new errors (pre-existing style warnings only)
- ✅ No breaking changes to other providers
- ✅ No API modifications required
- ✅ Consistent filter pattern across all views
