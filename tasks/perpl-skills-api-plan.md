# Feature: Update perpl-type Skill & Bot to Use API

## Summary
Update the perpl-type skill and PerplBot handlers to use the new API client for reads instead of direct contract calls, improving performance and enabling real-time updates.

## Context
- Why is this needed?
  - API client (`PerplApiClient`) exists but skills still use contract calls via CLI
  - Direct contract calls are slow (~500ms-1s per RPC call)
  - API provides batch endpoints and faster response times
  - Bot handlers don't use API at all currently

- What problem does it solve?
  - Faster status/position queries
  - Single API call vs N contract calls
  - Enables future WebSocket integration for real-time updates

## Current Flow

```
/perpl-type "long 0.01 btc"
    ↓
Skill parses → CLI command
    ↓
npm run dev -- trade open ...
    ↓
CLI creates OwnerWallet + Exchange
    ↓
Exchange.execOrder() → viem → Contract
Exchange.getPosition() → viem → Contract (slow!)
```

## Target Flow

```
/perpl-type "long 0.01 btc"
    ↓
Skill parses → CLI command
    ↓
npm run dev -- trade open ...
    ↓
CLI creates OwnerWallet + Exchange + ApiClient
    ↓
Exchange.execOrder() → viem → Contract (writes stay on-chain)
Exchange.getPosition() → ApiClient → REST API (fast!)
```

## Current State Analysis

### What Already Exists
- `PerplApiClient` class in `src/sdk/api/client.ts`
- SIWE authentication implementation
- `USE_API` feature flag in config
- API fallback pattern in `Exchange.getOpenOrders()`

### What's Missing
- API calls in `Exchange.getPosition()`
- API calls in `Exchange.getPerpetualInfo()`
- API calls in `Exchange.getAccountByAddress()`
- API initialization in bot handlers
- Authentication before API reads

## Design

### Phase 1: Extend Exchange API Integration

**File:** `src/sdk/contracts/Exchange.ts`

Add API-first pattern to read methods:

```typescript
async getPosition(perpId: bigint, accountId: bigint) {
  // Try API first
  if (this.useApi && this.apiClient?.isAuthenticated()) {
    try {
      const positions = await this.apiClient.getPositions(accountId);
      const position = positions.find(p => p.mkt === Number(perpId));
      if (position) {
        return this.mapApiPositionToInternal(position);
      }
    } catch (error) {
      console.warn('API getPosition failed, falling back to contract:', error);
    }
  }
  // Fallback to contract
  return this.getPositionFromContract(perpId, accountId);
}

async getPerpetualInfo(perpId: bigint) {
  if (this.useApi && this.apiClient?.isAuthenticated()) {
    try {
      const context = await this.apiClient.getContext();
      const market = context.markets.find(m => m.id === Number(perpId));
      if (market) {
        return this.mapApiMarketToInternal(market);
      }
    } catch (error) {
      console.warn('API getPerpetualInfo failed, falling back to contract:', error);
    }
  }
  return this.getPerpetualInfoFromContract(perpId);
}
```

### Phase 2: Update CLI Authentication

**File:** `src/cli/trade.ts`

Ensure API client is authenticated before queries:

```typescript
import { USE_API, API_CONFIG } from '../config';
import { PerplApiClient } from '../sdk/api/client';

// Add after wallet creation
let apiClient: PerplApiClient | undefined;
if (USE_API) {
  apiClient = new PerplApiClient(API_CONFIG);
  try {
    await apiClient.authenticate(
      owner.account.address,
      (message) => owner.account.signMessage({ message })
    );
  } catch (error) {
    console.warn('API auth failed, using contract fallback:', error);
  }
}

const exchange = new Exchange(
  config.chain.exchangeAddress,
  owner.publicClient,
  owner.walletClient,
  undefined,
  apiClient
);
```

**File:** `src/cli/manage.ts`

Same pattern - authenticate API client before use.

### Phase 3: Update Bot Handlers

**File:** `src/bot/handlers/status.ts`

```typescript
export async function fetchAccountStatus(wallet: OwnerWallet) {
  let apiClient: PerplApiClient | undefined;
  if (USE_API) {
    apiClient = new PerplApiClient(API_CONFIG);
    await apiClient.authenticate(
      wallet.account.address,
      (message) => wallet.account.signMessage({ message })
    );
  }

  const exchange = new Exchange(
    config.chain.exchangeAddress,
    wallet.publicClient,
    wallet.walletClient,
    undefined,
    apiClient
  );

  // Now getPosition() will use API automatically
  const positions = await portfolio.getPositions(perpIds);
}
```

**Files to update:**
- `src/bot/handlers/status.ts`
- `src/bot/handlers/trade.ts`
- `src/bot/handlers/markets.ts`

### Phase 4: Add API Methods to Client

**File:** `src/sdk/api/client.ts`

Ensure these methods exist:

```typescript
// May already exist - verify
async getContext(): Promise<Context>
async getPositions(accountId: bigint): Promise<Position[]>
async getMarkets(): Promise<Market[]>
async getAccount(accountId: bigint): Promise<Account>
```

### Phase 5: Update Skill Documentation

**File:** `.claude/skills/perpl-type/SKILL.md`

Update to mention API mode:

```markdown
## Performance
When `PERPL_USE_API=true` (default), queries use the REST API for faster responses.
Set `PERPL_USE_API=false` to use direct contract calls (slower but no API dependency).
```

## Files to Modify

| File | Change | Impact |
|------|--------|--------|
| `src/sdk/contracts/Exchange.ts` | Add API-first to getPosition, getPerpetualInfo | High |
| `src/sdk/api/client.ts` | Verify/add getPositions, getMarkets methods | Medium |
| `src/cli/trade.ts` | Initialize & authenticate API client | Medium |
| `src/cli/manage.ts` | Initialize & authenticate API client | Medium |
| `src/bot/handlers/status.ts` | Add API client initialization | Medium |
| `src/bot/handlers/trade.ts` | Add API client initialization | Medium |
| `src/bot/handlers/markets.ts` | Add API client initialization | Low |
| `.claude/skills/perpl-type/SKILL.md` | Document API mode | Low |

## Type Mapping

API responses need to be mapped to internal types:

```typescript
// API Position → Internal Position
function mapApiPositionToInternal(apiPos: ApiPosition): InternalPosition {
  return {
    perpId: BigInt(apiPos.mkt),
    accountId: BigInt(apiPos.acc),
    size: parseScaledBigInt(apiPos.s, SIZE_DECIMALS),
    entryPrice: parseScaledBigInt(apiPos.ep, PRICE_DECIMALS),
    collateral: parseAmount(apiPos.c),
    unrealizedPnl: parseAmount(apiPos.pnl),
    liquidationPrice: apiPos.lp ? parseScaledBigInt(apiPos.lp, PRICE_DECIMALS) : undefined,
  };
}

// Helper for scaled integer conversion
function parseScaledBigInt(value: number, decimals: number): bigint {
  return BigInt(Math.round(value * 10 ** decimals));
}
```

**Note**: Verify actual API response field names against `/api/v1/pub/context` market decimals.

## Testing Strategy

### Unit Tests
- Mock API client responses
- Verify fallback to contract on API error
- Test type mapping functions

### Integration Tests
```bash
# Test with API enabled (default)
npm run dev -- manage status

# Test with API disabled (fallback)
PERPL_USE_API=false npm run dev -- manage status

# Compare results should be identical
```

### Skill Testing
```bash
# Via Claude Code
/perpl-type what are my positions

# Should use API if authenticated, contract fallback otherwise
```

## Design Decisions

### Authentication Strategy
**Decision**: On-demand authentication with session caching.
- Authenticate lazily on first API call requiring auth
- Cache the auth nonce for session duration
- Re-authenticate automatically on 401/3401 errors
- Rationale: Avoids startup delay, handles session expiry gracefully

### Caching Strategy
**Decision**: No caching in ExchangeStateTracker initially.
- API responses are already fast enough (~50-100ms)
- Caching adds complexity and staleness risk for position data
- Can add caching later if profiling shows need
- Rationale: YAGNI - don't optimize prematurely

### WebSocket for Position Updates
**Decision**: Defer to future phase.
- Current REST API approach is sufficient for skill use cases
- WebSocket adds complexity (connection management, reconnection)
- Can add as Phase 6 after REST integration is stable
- Rationale: Incremental delivery - ship REST first, iterate

## Assumptions
- API client authentication works as documented in `api-docs/authentication.md`
- API response structures match `api-docs/types.md` and `api-docs/rest-endpoints.md`
- Contract fallback is reliable (existing `viem` integration)
- `USE_API` and `API_CONFIG` are exported from `src/config.ts`

## Error Handling

```typescript
// Wrap API calls with fallback pattern
async function withApiFallback<T>(
  apiCall: () => Promise<T>,
  contractFallback: () => Promise<T>,
  context: string
): Promise<T> {
  if (!this.useApi || !this.apiClient?.isAuthenticated()) {
    return contractFallback();
  }

  try {
    return await apiCall();
  } catch (error) {
    if (error instanceof ApiAuthError) {
      // Try re-auth once, then fallback
      try {
        await this.apiClient.reauthenticate();
        return await apiCall();
      } catch {
        console.warn(`API ${context} auth failed, using contract fallback`);
      }
    } else {
      console.warn(`API ${context} failed, using contract fallback:`, error);
    }
    return contractFallback();
  }
}
```

## Success Criteria

1. **CLI uses API**: `manage status` and `trade open` use API for position queries
2. **Bot uses API**: Bot status command uses API client
3. **Fallback works**: Contract fallback activates when API unavailable
4. **No regression**: All existing tests pass, functionality unchanged
5. **Performance improved**: Response times measurably faster (log before/after)

## Rollback Strategy
Set `PERPL_USE_API=false` environment variable to disable all API usage and revert to contract-only mode.

## Complexity
Medium - Extending existing pattern to more methods, updating CLI/bot initialization
