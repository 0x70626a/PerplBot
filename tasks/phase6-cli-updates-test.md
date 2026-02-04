# Test Plan: Phase 6 - CLI Updates

## Summary
Verify the CLI now supports `--no-api` flag and shows connection mode in status.

## Status: VERIFIED

**Last tested**: 2026-02-04
**Result**: 259/259 unit tests passing, typecheck passing

## Changes Made

### Modified Files
- `src/cli/index.ts`
- `src/cli/manage.ts`

### New Features

1. **`--no-api` Global Flag**: Disables API mode, forces contract-only operations
2. **Connection Mode Display**: Status command shows current mode (API + Contract vs Contract only)

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

### 3. CLI Usage

```bash
# Default mode (API enabled if available)
npm run dev -- manage status
# Output: "Mode: API + Contract"

# Force contract-only mode
npm run dev -- --no-api manage status
# Output: "Mode: Contract only"

# Other commands with API mode
npm run dev -- manage markets

# Force contract-only for all operations
npm run dev -- --no-api manage markets
```

### 4. Flag Behavior

| Flag | `USE_API` env | Result |
|------|---------------|--------|
| (none) | true | API + Contract |
| (none) | false | Contract only |
| `--no-api` | true | Contract only |
| `--no-api` | false | Contract only |

### 5. Status Command Output

With API mode:
```
Fetching account status...
Mode: API + Contract

=== Exchange Account ===
...
```

Without API mode:
```
Fetching account status...
Mode: Contract only

=== Exchange Account ===
...
```

## Pass Criteria

- [x] `npm run typecheck` passes
- [x] `npm test` passes (259 tests)
- [x] `--no-api` flag accepted by CLI
- [x] Status command shows connection mode
- [x] API mode can be disabled via flag
- [x] API mode can be disabled via `PERPL_USE_API=false`

## Files Modified

| File | Changes |
|------|---------|
| `src/cli/index.ts` | Added `--no-api` global option |
| `src/cli/manage.ts` | Added API client initialization, mode display |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERPL_USE_API` | `true` | Enable/disable API mode globally |
| `PERPL_API_URL` | `https://testnet.perpl.xyz/api` | REST API base URL |
| `PERPL_WS_URL` | `wss://testnet.perpl.xyz` | WebSocket base URL |

## Architecture Notes

### Flag Priority
1. Command-line `--no-api` flag (highest priority)
2. `PERPL_USE_API` environment variable
3. Default behavior (API enabled)

### API Initialization
When API mode is enabled, the manage command:
1. Creates `PerplApiClient` with `API_CONFIG`
2. Passes it to `Exchange` constructor
3. Exchange uses API for supported queries, falls back to contract

## Manual Testing

```bash
# Build and test
npm run build

# Test with API mode
npm run dev -- manage status

# Test without API mode
npm run dev -- --no-api manage status

# Test markets command
npm run dev -- manage markets
npm run dev -- --no-api manage markets
```
