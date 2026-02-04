# Test Plan: Phase 5 - Wallet Classes Update

## Summary
Verify the OperatorWallet now supports WebSocket order submission with contract fallback.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 259/259 unit tests passing, typecheck passing

## Changes Made

### Modified Files
- `src/sdk/wallet/operator.ts`

### New Features

1. **API Client Integration**: OperatorWallet can initialize API client during connect
2. **WebSocket Trading**: Support for WebSocket order submission
3. **Market Orders via WebSocket**: Faster order execution for market orders
4. **Contract Fallback**: Original contract methods preserved

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

### 3. WebSocket Trading Usage

```typescript
import { OperatorWallet } from './sdk/wallet/operator';

// Create operator wallet
const operator = OperatorWallet.fromPrivateKey(privateKey, chainConfig);

// Connect with API enabled
const exchange = operator.connect(
  exchangeAddress,
  delegatedAccountAddress,
  { enableApi: true }  // NEW: enables API mode
);

// Authenticate and connect WebSocket
await operator.connectApi();  // NEW: connects trading WebSocket

// Check connection status
console.log('API connected:', operator.isApiConnected());

// Set account ID (usually obtained from wallet snapshot)
operator.setAccountId(accountId);

// Market orders now use WebSocket when available
// Returns request ID (number) for WebSocket, or tx hash for contract
const result = await operator.marketOpenLong({
  perpId: 16n,
  lotLNS: 1000000n,
  leverageHdths: 1000n,
  maxPricePNS: 100000000n,
});

// Disconnect when done
operator.disconnectApi();
```

### 4. API Mode Methods

| Method | Purpose |
|--------|---------|
| `connect(addr, da, { enableApi: true })` | Enable API mode during connect |
| `connectApi()` | Authenticate and connect trading WebSocket |
| `disconnectApi()` | Disconnect WebSocket |
| `isApiConnected()` | Check WebSocket connection status |
| `getApiClient()` | Get the API client instance |
| `getWsClient()` | Get the WebSocket client instance |
| `setAccountId(id)` | Set account ID for WebSocket orders |

### 5. Market Order Behavior

| Scenario | Return Type | Execution Path |
|----------|-------------|----------------|
| WebSocket connected + accountId set | `number` (request ID) | WebSocket submission |
| WebSocket not connected | `Hash` (tx hash) | Contract submission |
| WebSocket connected but no accountId | `Hash` | Contract fallback |

### 6. WebSocket Order Methods

These methods now support WebSocket execution:
- `marketOpenLong()`
- `marketOpenShort()`
- `marketCloseLong()` (requires positionId for WebSocket)
- `marketCloseShort()` (requires positionId for WebSocket)

### 7. Fallback Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| `enableApi: true` in connect | API client initialized |
| `connectApi()` called | WebSocket connected, authenticated |
| WebSocket connected | Market orders use WebSocket |
| WebSocket disconnected | Market orders use contract |
| `enableApi: false` | No API initialization |
| `USE_API=false` env | No API initialization |

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] OperatorWallet `connect()` accepts `enableApi` option
- [x] `connectApi()` authenticates and connects WebSocket
- [x] Market orders use WebSocket when available
- [x] Contract fallback works when WebSocket not connected
- [x] Existing functionality preserved

## Files Modified

| File | Changes |
|------|---------|
| `src/sdk/wallet/operator.ts` | Added API/WebSocket support, market order WebSocket execution |

## Architecture Notes

### Order Submission Flow (WebSocket)
1. Check `wsClient?.isConnected()` && `accountId !== undefined`
2. Get current block number
3. Call WebSocket method (e.g., `wsClient.openLong()`)
4. Returns request ID (number)

### Order Submission Flow (Contract)
1. Create OrderDesc struct
2. Call `exchange.execOrder()`
3. Returns transaction hash

### Position Close via WebSocket
Close methods require `positionId` parameter for WebSocket execution:
```typescript
await operator.marketCloseLong({
  perpId: 16n,
  lotLNS: 1000000n,
  minPricePNS: 90000000n,
  positionId: 123,  // Required for WebSocket
});
```

Without positionId, falls back to contract.

## Known Limitations

1. WebSocket orders require prior authentication via `connectApi()`
2. Close orders via WebSocket need position ID
3. WebSocket returns request ID, not transaction hash
4. Account ID must be set (either from wallet snapshot or manually)
