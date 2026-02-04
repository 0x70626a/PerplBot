# Test Plan: Phase 1 - API Client Layer

## Summary
Verify the new API client layer (`src/sdk/api/`) works correctly against the live Perpl API.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 22/22 integration tests passing, 259/259 unit tests passing

## Prerequisites
- PerplBot repo with `npm install` completed
- Whitelisted wallet private key in `.env` as `OWNER_PRIVATE_KEY`

## Test Categories

### 1. Unit Tests (Automated)

```bash
npm test
```

**Expected**: All 259 tests pass, including 15 new API client tests.
**Result**: PASS (259/259)

| Test File | Tests | Status |
|-----------|-------|--------|
| `test/api/client.test.ts` | 15 | PASS |

---

### 2. Type Check

```bash
npm run typecheck
```

**Expected**: No TypeScript errors.
**Result**: PASS

---

### 3. Live API Integration Tests

```bash
npx tsx scripts/test-api-client.ts
```

**Result**: 22/22 tests passing

#### 3.1 REST Client Tests

| Test | Expected | Status |
|------|----------|--------|
| Get context | Returns 5 markets, chain: Monad Testnet | PASS |
| Get candles | Returns BTC candles | PASS |
| Get announcements | Returns `{ver, active[]}` | PASS |
| Not authenticated initially | `isAuthenticated()` returns `false` | PASS |
| Authenticate | Returns nonce (44 chars) | PASS |
| Is authenticated | `isAuthenticated()` returns `true` | PASS |
| Get auth nonce | Returns nonce string | PASS |
| Get fills | Returns `{d[], np}` (28 items) | PASS |
| Get order history | Returns `{d[], np}` (36 items) | PASS |
| Get position history | Returns `{d[], np}` (10 items) | PASS |
| Get account history | Returns `{d[], np}` (32 items) | PASS |

#### 3.2 WebSocket Client Tests (Market Data)

| Test | Expected | Status |
|------|----------|--------|
| Connect market data | Connects successfully | PASS |
| Subscribe order book | Receives L2Book (9 bids, 8 asks) | PASS |
| Subscribe market state | Receives 5 markets | PASS |
| Is connected | Returns `true` | PASS |
| Disconnect | Disconnects cleanly | PASS |

#### 3.3 WebSocket Client Tests (Trading)

| Test | Expected | Status |
|------|----------|--------|
| Connect trading WS | Connects and authenticates | PASS |
| Receive wallet snapshot | Gets wallet data | PASS |
| Receive positions snapshot | Gets positions data | PASS |
| Receive orders snapshot | Gets orders data | PASS |
| Disconnect trading WS | Disconnects cleanly | PASS |

#### 3.4 Clear Auth Test

| Test | Expected | Status |
|------|----------|--------|
| Clear auth | `isAuthenticated()` returns `false` | PASS |

---

## Key Findings

### WebSocket Trading Auth Requires Cookies

**Issue**: WebSocket trading connection failed with code 3401 (auth expired) when using only the auth nonce.

**Solution**: The trading WebSocket requires both the auth nonce AND the session cookies from REST authentication.

```typescript
// Get auth nonce AND cookies from REST client
const authNonce = client.getAuthNonce();
const authCookies = client.getAuthCookies();

// Pass both to WebSocket trading connection
await tradingWs.connectTrading(authNonce, authCookies);
```

**API Updates**:
- Added `getAuthCookies()` method to `PerplApiClient`
- Updated `connectTrading(authNonce, cookies?)` signature in `PerplWebSocketClient`

---

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] All REST client tests pass against live API
- [x] WebSocket market data tests pass
- [x] WebSocket trading tests pass (with whitelisted wallet)
- [x] No memory leaks or unclosed connections

## Test Execution Commands

```bash
# 1. Type check
npm run typecheck

# 2. Unit tests
npm test

# 3. Live integration tests
npx tsx scripts/test-api-client.ts
```

## Files Created/Modified

| File | Purpose |
|------|---------|
| `src/sdk/api/types.ts` | Type definitions for API responses |
| `src/sdk/api/client.ts` | REST client with auth, pagination, cookies |
| `src/sdk/api/websocket.ts` | WebSocket with reconnection, cookie support |
| `src/sdk/api/index.ts` | Module exports |
| `src/sdk/config.ts` | API_CONFIG, USE_API flag |
| `src/sdk/index.ts` | Added API exports |
| `test/api/client.test.ts` | Unit test coverage (15 tests) |
| `scripts/test-api-client.ts` | Integration test script |

## Known Limitations

1. WebSocket trading requires whitelisted wallet
2. Empty history returns 404 (handled as valid)
3. Rate limiting not tested (would need many requests)
4. WebSocket trading requires cookies from REST auth (discovered during testing)
