# Test Plan: Phase 2 - Exchange Wrapper Update

## Summary
Verify the Exchange wrapper now supports API client with contract fallback.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 259/259 unit tests passing, typecheck passing

## Changes Made

### Modified Files
- `src/sdk/contracts/Exchange.ts`

### New Features
1. **API Client Support**: Exchange constructor now accepts optional `apiClient` parameter
2. **API-first getOpenOrders**: Uses API to fetch orders (avoiding bitmap iteration), with contract fallback
3. **Helper Methods**:
   - `isApiEnabled()`: Check if API mode is active
   - `getApiClient()`: Get the API client instance

## Test Categories

### 1. Unit Tests

```bash
npm test
```

**Expected**: All 259 tests pass
**Result**: PASS

### 2. Type Check

```bash
npm run typecheck
```

**Expected**: No TypeScript errors
**Result**: PASS

### 3. API Integration Verification

The Exchange wrapper can now be initialized with an API client:

```typescript
import { Exchange } from './sdk/contracts/Exchange';
import { PerplApiClient, API_CONFIG } from './sdk/api';

// Create API client
const apiClient = new PerplApiClient(API_CONFIG);
await apiClient.authenticate(address, signMessage);

// Create Exchange with API support
const exchange = Exchange.withDelegatedAccount(
  exchangeAddress,
  delegatedAccountAddress,
  publicClient,
  walletClient,
  apiClient  // NEW: optional API client
);

// Check API mode
console.log(`API enabled: ${exchange.isApiEnabled()}`);

// getOpenOrders now uses API first, falls back to contract
const orders = await exchange.getOpenOrders(perpId, accountId);
```

### 4. Fallback Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| API client provided, authenticated | Uses API for `getOpenOrders` |
| API client provided, not authenticated | Falls back to contract |
| API client not provided | Uses contract directly |
| API call fails | Falls back to contract with warning |
| `PERPL_USE_API=false` | Uses contract regardless of API client |

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] Exchange constructor accepts `apiClient` parameter
- [x] `withDelegatedAccount` factory accepts `apiClient` parameter
- [x] `getOpenOrders` uses API when available
- [x] Contract fallback works when API fails
- [x] Existing functionality preserved

## Files Modified

| File | Changes |
|------|---------|
| `src/sdk/contracts/Exchange.ts` | Added apiClient support, API-first getOpenOrders |

## Architecture Notes

The API-first pattern for `getOpenOrders`:
1. Check if `useApi` is enabled AND `apiClient.isAuthenticated()`
2. If yes, call `apiClient.getOrderHistory()` and filter for open orders
3. If API fails or not available, fall back to `getOpenOrdersFromContract()`
4. Contract method uses bitmap iteration (slower but works without auth)

## Known Limitations

1. `getPosition` still uses contract calls (API doesn't provide real-time mark price)
2. API requires authentication for order queries
3. Order type mapping: API uses 1-based (OpenLong=1), contract uses 0-based (OpenLong=0)
