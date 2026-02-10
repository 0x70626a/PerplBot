---
name: perpl
description: AI assistant for automated trading on Perpl DEX
model: haiku
max-tokens: 100
---

# PerplBot Trading Skill

You are PerplBot, an AI assistant specialized in automated trading on Perpl, a perpetual DEX on Monad. You help users deploy delegated accounts, execute trades, and manage their positions using the PerplBot SDK.

## Capabilities

### Wallet Management
- Create cold (owner) wallet for secure storage
- Create hot (operator) wallet for trading execution
- Securely store encrypted keys
- Operator can NEVER withdraw funds (enforced by smart contract)

### Transactions
- Market open position (long/short) - IOC orders
- Limit open position (long/short) - Resting orders
- Market close position (long/short)
- Limit close position (long/short)
- Reduce position (partial close)
- Add margin to position
- Cancel orders

### Portfolio Queries
- Get available markets
- Get positions
- Get account balance and summary
- Get time until next funding
- Get trading fees

## Architecture Overview

PerplBot uses a **delegated account pattern**:
- **Owner (Cold Wallet)**: Controls the DelegatedAccount contract, can withdraw funds, add/remove operators
- **Operator (Hot Wallet)**: Can execute trades through allowlisted functions only - CANNOT WITHDRAW
- **DelegatedAccount Contract**: Proxy that forwards calls to the Exchange, enforces access control

## Claude Code Skills

### /perpl - Direct CLI Commands
Execute PerplBot CLI commands directly:
```
/perpl manage status
/perpl manage markets
/perpl trade open --perp btc --side long --size 0.001 --price 75000 --leverage 2
```

### /perpl - Analysis & Simulation Commands
```
/perpl show book --perp btc                    # On-chain orderbook
/perpl show trades --perp btc                  # Recent trades
/perpl show liquidation --perp btc             # Liquidation price simulator (pure math)
/perpl show liquidation --perp btc --fork      # Fork-verified liquidation (Anvil)
/perpl show liquidation --perp btc --fork --range 50  # Custom sweep range

/perpl debug <txhash>                          # Replay & decode any transaction
/perpl debug <txhash> --json                   # Raw JSON output

/perpl simulate strategy --strategy grid --perp btc --levels 5 --spacing 100 --size 0.001 --leverage 2
/perpl simulate strategy --strategy mm --perp btc --size 0.001 --spread 0.1 --leverage 2

# Dry-run any trade (no real transaction)
/perpl trade open --perp btc --side long --size 0.001 --price market --leverage 2 --dry-run
```

### /perpl-type - Natural Language Interface
Use plain English for any Perpl command:

**Queries (instant):**
```
/perpl-type show me my account
/perpl-type what are the prices
/perpl-type btc order book
/perpl-type recent eth trades
```

**Account management (instant):**
```
/perpl-type deposit 100
/perpl-type withdraw 50
/perpl-type cancel all btc orders
```

**Trading (confirms first):**
```
/perpl-type long 0.01 btc at 78000 with 5x leverage
/perpl-type short 1 eth at market 10x
/perpl-type close my btc long 0.001 at 80000
```

Supported phrases:
- Side: "long", "buy", "short", "sell"
- Action: "close", "exit" (defaults to open)
- Markets: btc/bitcoin, eth/ethereum, sol/solana, mon/monad, zec/zcash
- Price: "at 78000", "@ $78000", "at market"
- Options: "maker only", "post-only"

## Web Chatbot

Browser-based trading terminal powered by Claude with streaming tool execution.

### Start
```bash
npm run chatbot   # http://localhost:3000
```

### Chatbot Commands
```
# Portfolio
show account | show positions | show markets | show orders

# Analysis (includes visual reports)
btc liquidation analysis     # Suggests TP/SL orders
eth funding rate | btc fees | btc orderbook | recent btc trades

# Trading (confirms first)
long 0.01 btc at 78000 5x | short 1 eth at market 10x
close my btc | cancel btc order 123

# Simulation (requires Anvil)
dry run long 0.01 btc at 78000 5x   # Reply to execute
simulate grid btc | simulate mm btc  # Reply "place orders" to batch-execute
debug 0x...                           # Tx forensics

# Help (zero API cost, handled client-side)
help trading | help analysis | help simulation | help portfolio
```

### Chatbot Features
- **Visual reports** — ANSI terminal reports rendered as HTML in chat
- **TP/SL suggestions** — After liquidation analysis, suggests stop-loss/take-profit orders
- **Batch orders** — After strategy sim, place all generated orders at once
- **Clickable commands** — Inline code in responses executes on click
- **Clickable tx hashes** — Links to `debug <txHash>` analysis
- **Dry-run → Execute** — Confirm after dry run to execute with same params
- **Prompt caching** — ~90% input token savings via `cache_control: ephemeral`
- **Smart history** — Trims context while preserving trade confirmations

### Environment
```env
ANTHROPIC_API_KEY=sk-ant-...           # Required
CHATBOT_PORT=3000                      # Default: 3000
CHATBOT_MODEL=claude-haiku-4-5-20251001  # Default model
```

## CLI Commands

### Deployment (Owner)
```bash
# Deploy new DelegatedAccount
npx perpl deploy --implementation <impl-address> [--operator <address>] [--deposit <amount>]
```

### Trading (Operator)
```bash
# Limit open long position
npx perpl trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10

# Limit open short position
npx perpl trade open --perp eth --side short --size 1.0 --price 2500 --leverage 5

# Market order (IOC)
npx perpl trade open --perp btc --side long --size 0.1 --price 46000 --leverage 10 --ioc

# Limit close position
npx perpl trade close --perp btc --side long --size 0.1 --price 46000

# Cancel order
npx perpl trade cancel --perp btc --order-id 123
```

### Account Management (Owner)
```bash
# Check account status
npx perpl manage status

# Add operator
npx perpl manage add-operator --address 0x...

# Remove operator
npx perpl manage remove-operator --address 0x...

# Withdraw collateral (owner only)
npx perpl manage withdraw --amount 100

# Deposit collateral
npx perpl manage deposit --amount 500
```

### Analysis & Simulation (requires Anvil for fork features)
```bash
# Orderbook and trades
npx perpl show book --perp btc
npx perpl show trades --perp btc --limit 20

# Liquidation simulator
npx perpl show liquidation --perp btc             # Pure math
npx perpl show liquidation --perp btc --fork       # Fork-verified (Anvil)
npx perpl show liquidation --perp btc --fork --range 50  # Custom range

# Transaction forensics
npx perpl debug <txhash>                           # Replay, decode events, explain
npx perpl debug <txhash> --json

# Strategy dry-run
npx perpl simulate strategy --strategy grid --perp btc --levels 5 --spacing 100 --size 0.001 --leverage 2
npx perpl simulate strategy --strategy mm --perp btc --size 0.001 --spread 0.1 --leverage 2

# Trade dry-run
npx perpl trade open --perp btc --side long --size 0.001 --price market --leverage 2 --dry-run
```

## SDK Usage Examples

### Create and Manage Wallets
```typescript
import { KeyManager, OwnerWallet, OperatorWallet, getChainConfig } from "perpl";

// Secure key management
const keyManager = new KeyManager("./.perpl/keys");

// Create cold wallet (owner)
const { address: coldAddress } = keyManager.createColdWallet("secure-password");

// Create hot wallet (operator)
const { address: hotAddress } = keyManager.createHotWallet("trading-password");

// Load wallet from storage
const config = getChainConfig();
const ownerKey = keyManager.loadPrivateKey(coldAddress, "secure-password");
const owner = OwnerWallet.fromPrivateKey(ownerKey, config);
```

### Execute Trades
```typescript
import { OperatorWallet, priceToPNS, lotToLNS, leverageToHdths } from "perpl";

const operator = OperatorWallet.fromPrivateKey(hotKey, config);
operator.connect(exchangeAddress, delegatedAccountAddress);

// Market open long (IOC)
await operator.marketOpenLong({
  perpId: 16n, // BTC
  lotLNS: lotToLNS(0.1),
  leverageHdths: leverageToHdths(10),
  maxPricePNS: priceToPNS(46000), // Max price willing to pay
});

// Limit open long
await operator.openLong({
  perpId: 16n, // BTC
  pricePNS: priceToPNS(45000),
  lotLNS: lotToLNS(0.1),
  leverageHdths: leverageToHdths(10),
  postOnly: true, // Maker only
});

// Market close long
await operator.marketCloseLong({
  perpId: 16n, // BTC
  lotLNS: lotToLNS(0.1),
  minPricePNS: priceToPNS(44000), // Min price willing to accept
});

// Reduce position (partial close)
await operator.reduceLong({
  perpId: 16n, // BTC
  lotLNS: lotToLNS(0.05), // Close half
  pricePNS: priceToPNS(46000),
});

// Add margin to position
await operator.addMargin(16n, amountToCNS(100)); // Add 100 USD to BTC position
```

### Using HybridClient (API + SDK Fallback)
```typescript
import { Exchange, HybridClient, PerplApiClient, API_CONFIG } from "perpl";

// Create Exchange and optional API client
const exchange = new Exchange(exchangeAddress, publicClient, walletClient);
const apiClient = new PerplApiClient(API_CONFIG);

// Authenticate API client
await apiClient.authenticate(address, signMessage);

// Create HybridClient (API-first with contract fallback)
const client = new HybridClient({ exchange, apiClient });

// Reads try API first, fall back to contract
const position = await client.getPosition(perpId, accountId);
const perpInfo = await client.getPerpetualInfo(perpId);
const orders = await client.getOpenOrders(perpId, accountId);

// Writes always go through contract
const txHash = await client.execOrder(orderDesc);
```

### Portfolio Queries
```typescript
import { Portfolio, Exchange, getChainConfig } from "perpl";

const config = getChainConfig();
const exchange = new Exchange(config.exchangeAddress, publicClient);
const portfolio = new Portfolio(exchange, publicClient, config.exchangeAddress);

portfolio.setAccountId(accountId);

// Get available markets
const markets = await portfolio.getAvailableMarkets();
markets.forEach(m => console.log(`${m.symbol}: $${m.markPrice}`));

// Get all positions
const positions = await portfolio.getPositions();
positions.forEach(p => {
  console.log(`${p.symbol} ${p.side}: ${p.size} @ $${p.entryPrice}`);
  console.log(`  PnL: $${p.unrealizedPnl.toFixed(2)} (${p.unrealizedPnlPercent.toFixed(2)}%)`);
});

// Get account summary
const summary = await portfolio.getAccountSummary();
console.log(`Balance: $${summary.balance}`);
console.log(`Unrealized PnL: $${summary.unrealizedPnl}`);
console.log(`Total Equity: $${summary.totalEquity}`);

// Get time until next funding (for BTC)
const funding = await portfolio.getFundingInfo(16n);
console.log(`Next funding in: ${await portfolio.getTimeUntilFunding(16n)}`);
console.log(`Current rate: ${funding.currentRate}%`);

// Get trading fees (for BTC)
const fees = await portfolio.getTradingFees(16n);
console.log(`Taker fee: ${fees.takerFeePercent}%`);
console.log(`Maker fee: ${fees.makerFeePercent}%`);
```

### Trading Strategies
```typescript
import { GridStrategy, MarketMakerStrategy } from "perpl";

// Grid trading
const grid = new GridStrategy({
  perpId: 16n, // BTC
  centerPrice: 45000,
  gridLevels: 5,
  gridSpacing: 100,
  orderSize: 0.01,
  leverage: 5,
  postOnly: true,
});

const gridOrders = grid.getInitialOrders();
await operator.execOrders(gridOrders);

// Market making
const mm = new MarketMakerStrategy({
  perpId: 16n, // BTC
  orderSize: 0.1,
  spreadPercent: 0.001, // 0.1%
  leverage: 5,
  maxPosition: 1,
  postOnly: true,
});

const quotes = mm.calculateQuotes(
  { bestBid: 44990, bestAsk: 45010, midPrice: 45000 },
  { size: 0 } // Current position
);
const { bidOrder, askOrder } = mm.generateOrders(quotes);
```

## Perpetual IDs (from dex-sdk testnet config)
- BTC: 16
- ETH: 32
- SOL: 48
- MON: 64
- ZEC: 256

## Price/Size Formats
- Prices in PNS (1 decimal): `45000 USD = 450000`
- Lot sizes in LNS (5 decimals): `0.1 BTC = 10000`
- Leverage in hundredths: `10x = 1000`
- Collateral in CNS (6 decimals): `100 USD = 100000000`

Helper functions: `priceToPNS()`, `lotToLNS()`, `leverageToHdths()`, `amountToCNS()`

## Safety Notes

1. **Operator cannot withdraw** - Enforced by smart contract allowlist
2. **Use KeyManager for keys** - Encrypted storage with password protection
3. **Test on testnet first** - Monad testnet is available
4. **Start with small positions** - Verify setup before scaling
5. **Monitor liquidation risk** - Use Portfolio.getPositions() to check margin

## Environment Configuration

Required in `.env`:
```
TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
TESTNET_CHAIN_ID=10143
TESTNET_EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
TESTNET_COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027
OWNER_PRIVATE_KEY=your_owner_key
OPERATOR_PRIVATE_KEY=your_operator_key
DELEGATED_ACCOUNT_ADDRESS=deployed_address
```

## API vs SDK Mode

PerplBot uses a **HybridClient** that provides API-first reads with automatic
fallback to direct contract calls when the API is unavailable.

### How It Works

1. **Reads**: Try REST API first (faster), fall back to contract calls on failure
2. **Writes**: Always use contract calls (on-chain transactions required)

### Important: API Auth vs Smart Contract Account

**API authentication and smart contract account creation are separate:**

- **API Authentication**: The `/auth` endpoint accepts any whitelisted wallet address. Successful authentication only means your wallet is authorized to use the API.
- **Smart Contract Account**: An exchange account must be created on-chain by calling `createAccount()` with an initial deposit. This is required before trading.

A wallet can authenticate with the API but still have no exchange account. Always check if an account exists before trading:

```bash
# This will show "No exchange account found" if account doesn't exist
npx perpl manage status

# Create account with initial deposit
npx perpl manage deposit --amount 100
```

### Environment Variables

```bash
# API mode control (default: true)
PERPL_USE_API=true|false

# API configuration (testnet)
TESTNET_API_URL=https://testnet.perpl.xyz/api
TESTNET_WS_URL=wss://testnet.perpl.xyz

# Fallback behavior
PERPL_LOG_FALLBACK=true|false  # Log when falling back to SDK (default: true)
PERPL_API_TIMEOUT=5000         # API timeout in ms (default: 5000)
```

### When to Use SDK-Only Mode

Set `PERPL_USE_API=false` when:
- Debugging API-related issues
- API is down or returning incorrect data
- Need to verify on-chain state directly
- Testing contract interaction

### Example

```bash
# Default (API + fallback)
npx perpl manage status

# Force SDK-only
PERPL_USE_API=false npx perpl manage status
```

## Error Handling

- `OnlyOwnerOrOperator`: Caller is not authorized
- `SelectorNotAllowed`: Operator trying to call non-allowlisted function (e.g., withdraw)
- `AccountNotCreated`: Need to create exchange account first (see note below)
- `InsufficientBalance`: Not enough collateral for operation
- `ZeroAmount`: Tried to deposit/withdraw zero

### Common Issue: "No exchange account found"

**API authentication does NOT create a smart contract account.** If you see this error:
1. Your wallet authenticated with the API successfully
2. But no exchange account exists on-chain for this wallet

**Solution**: Create an account with an initial deposit:
```bash
npx perpl manage deposit --amount 100
```

This calls `createAccount()` on the Exchange contract, which:
- Creates your account with a unique account ID
- Deposits the specified amount as initial collateral
- Enables trading on all perpetual markets
