# Test Plan: Phase 4 - Portfolio Update

## Summary
Verify the Portfolio class now uses API batch queries with contract fallback.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 259/259 unit tests passing, typecheck passing

## Changes Made

### Modified Files
- `src/sdk/trading/portfolio.ts`

### New Features

1. **API Client Support**: Portfolio constructor now accepts optional `apiClient`
2. **API-first getPositions**: Uses batch API query, falls back to N+1 contract calls
3. **New API Methods**:
   - `getOrderHistory()`: Get all order history
   - `getFills()`: Get all fill history
   - `getPositionHistory()`: Get all position history
   - `getOpenOrders()`: Get open orders (uses Exchange API-first method)
   - `getAllOpenOrders()`: Get open orders across all markets

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

### 3. API Integration Usage

```typescript
import { Portfolio } from './sdk/trading/portfolio';
import { PerplApiClient, API_CONFIG } from './sdk/api';

// Create API client and authenticate
const apiClient = new PerplApiClient(API_CONFIG);
await apiClient.authenticate(address, signMessage);

// Create Portfolio with API support
const portfolio = new Portfolio(
  exchange,
  publicClient,
  exchangeAddress,
  apiClient  // NEW: optional API client
);

portfolio.setAccountId(accountId);

// Check API mode
console.log(`API enabled: ${portfolio.isApiEnabled()}`);

// getPositions now uses API batch query (single request)
const positions = await portfolio.getPositions();

// New API methods
const orderHistory = await portfolio.getOrderHistory();
const fills = await portfolio.getFills();
const positionHistory = await portfolio.getPositionHistory();

// Open orders (uses Exchange API-first method)
const openOrders = await portfolio.getOpenOrders(perpId);
const allOpenOrders = await portfolio.getAllOpenOrders();
```

### 4. Fallback Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| API client provided, authenticated | Uses API batch query for `getPositions` |
| API client provided, not authenticated | Falls back to contract N+1 queries |
| API client not provided | Uses contract N+1 queries |
| API call fails | Falls back to contract with warning |
| `PERPL_USE_API=false` | Uses contract regardless of API client |

### 5. Performance Comparison

| Method | Without API | With API |
|--------|-------------|----------|
| `getPositions()` | N+1 contract calls per market | 1 API call + mark price lookups |
| `getOpenOrders()` | Bitmap iteration + N calls | 1 API call |
| `getOrderHistory()` | Not available | Paginated API calls |
| `getFills()` | Not available | Paginated API calls |

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] Portfolio constructor accepts `apiClient` parameter
- [x] `getPositions()` uses API when available
- [x] Contract fallback works when API fails
- [x] New API methods work (`getOrderHistory`, `getFills`, etc.)
- [x] `getOpenOrders()` leverages Exchange API support
- [x] Existing functionality preserved

## Files Modified

| File | Changes |
|------|---------|
| `src/sdk/trading/portfolio.ts` | Added apiClient support, API-first getPositions, new API methods |

## Architecture Notes

### getPositions API Flow
1. Check if `useApi` && `apiClient.isAuthenticated()`
2. Call `apiClient.getPositionHistory()` (single batch request)
3. Filter for open positions (status === 1)
4. For each position, get current mark price from contract (for accurate PnL)
5. Format and return

### Contract Fallback Flow
1. For each perpId in list
2. Call `exchange.getPosition(perpId, accountId)`
3. Call `exchange.getPerpetualInfo(perpId)`
4. Calculate PnL and format

### API-Only Methods
These methods require API client and authentication:
- `getOrderHistory()` - No contract equivalent
- `getFills()` - No contract equivalent
- `getPositionHistory()` - No contract equivalent (only current position via contract)

## Known Limitations

1. Position PnL still requires mark price from contract (API doesn't provide real-time)
2. History methods require API authentication
3. Contract fallback for positions does N+1 queries
