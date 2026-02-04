# Test Plan: Phase 3 - State Management Update

## Summary
Verify the ExchangeStateTracker now supports WebSocket real-time updates with contract fallback.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 259/259 unit tests passing, typecheck passing

## Changes Made

### Modified Files
- `src/sdk/state/exchange.ts`

### New Features

1. **WebSocket Real-time Updates**: ExchangeStateTracker can now connect to trading WebSocket
2. **Real-time State Tracking**:
   - Positions (open/closed status)
   - Orders (open/filled/cancelled)
   - Wallet accounts
3. **Event Emission**: Type-safe events for state changes
4. **Contract Fallback**: Original refresh methods preserved

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

### 3. Real-time Connection Usage

```typescript
import { ExchangeStateTracker } from './sdk/state/exchange';
import { PerplWebSocketClient, PerplApiClient, API_CONFIG } from './sdk/api';

// Setup
const stateTracker = new ExchangeStateTracker(exchange, publicClient);

// Create WebSocket client
const wsClient = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);

// Authenticate via REST first
const apiClient = new PerplApiClient(API_CONFIG);
const authNonce = await apiClient.authenticate(address, signMessage);
const authCookies = apiClient.getAuthCookies();

// Connect real-time updates
await stateTracker.connectRealtime(wsClient, authNonce, authCookies);

// Listen for updates
stateTracker.on('positions-updated', (positions) => {
  console.log('Positions updated:', positions.size);
});

stateTracker.on('orders-updated', (orders) => {
  console.log('Orders updated:', orders.size);
});

stateTracker.on('wallet-updated', (accounts) => {
  console.log('Wallet accounts:', accounts.length);
});

// Access real-time state
const positions = stateTracker.getRealtimePositions();
const orders = stateTracker.getRealtimeOrders();
const accounts = stateTracker.getRealtimeWalletAccounts();

// Check connection status
console.log('Connected:', stateTracker.isRealtimeConnected());
console.log('State age:', stateTracker.getRealtimeStateAge(), 'ms');

// Disconnect when done
stateTracker.disconnectRealtime();
```

### 4. Events Emitted

| Event | Payload | When Triggered |
|-------|---------|----------------|
| `positions-updated` | `Map<number, Position>` | Position snapshot/update received |
| `orders-updated` | `Map<number, Order>` | Order snapshot/update received |
| `wallet-updated` | `WalletAccount[]` | Wallet snapshot received |
| `realtime-connected` | none | WebSocket connected and authenticated |
| `realtime-disconnected` | `code: number` | WebSocket disconnected |
| `auth-expired` | none | WebSocket auth expired (code 3401) |

### 5. Fallback Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| Real-time connected | Use `getRealtimePositions()`, `getRealtimeOrders()` |
| Real-time not connected | Use `refreshPosition()`, `refreshAll()` (contract calls) |
| WebSocket disconnects | `realtime-disconnected` event emitted, fall back to refresh |
| Auth expires | `auth-expired` event emitted, reconnection needed |

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] ExchangeStateTracker extends EventEmitter
- [x] `connectRealtime()` method accepts WebSocket client + auth
- [x] Position/order/wallet events emitted on WebSocket updates
- [x] `getRealtimePositions()`, `getRealtimeOrders()`, `getRealtimeWalletAccounts()` methods work
- [x] Original refresh methods still work (contract fallback)
- [x] Type-safe event interface

## Files Modified

| File | Changes |
|------|---------|
| `src/sdk/state/exchange.ts` | Added WebSocket support, event emission, real-time state |

## Architecture Notes

### State Structure

```
ExchangeStateTracker
├── state (contract-based)
│   ├── account: AccountInfo
│   ├── positions: Map<bigint, {position, markPrice}>
│   ├── perpetuals: Map<bigint, PerpetualInfo>
│   └── lastUpdate: number
└── realtimeState (WebSocket-based)
    ├── walletAccounts: WalletAccount[]
    ├── apiPositions: Map<number, Position>
    ├── apiOrders: Map<number, Order>
    ├── connected: boolean
    └── lastWsUpdate: number
```

### Position Status Handling
- Status 1 (Open): Add to apiPositions map
- Other status (Closed, Liquidated): Remove from map

### Order Status Handling
- Remove flag (`r: true`): Remove from apiOrders map
- Status 2 (Open), 3 (PartiallyFilled): Add to map
- Other status: Remove from map

## Known Limitations

1. Contract-based state and real-time state use different data formats
2. Real-time positions don't include mark price (use contract `getPosition` for that)
3. WebSocket requires authentication (REST auth flow first)
