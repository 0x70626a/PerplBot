# PerplBot

AI agent toolkit for automated trading on [Perpl](https://perpl.xyz), a perpetual DEX on Monad.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Roadmap](#roadmap)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [CLI Reference](#cli-reference)
- [SDK Usage](#sdk-usage)
- [Telegram Bot](#telegram-bot)
- [Web Chatbot](#web-chatbot)
- [Claude Code Integration](#claude-code-integration)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Related Projects](#related-projects)

## Overview

PerplBot provides a TypeScript SDK and CLI for building trading bots on Perpl. It implements the **owner/operator wallet pattern** using the [delegated-account](https://github.com/PerplFoundation/delegated-account) smart contract, enabling secure separation between cold storage (owner) and hot trading wallets (operator).

**Key security feature**: Operators can execute trades but can NEVER withdraw funds — enforced at the smart contract level.

## Features

- **Wallet Management** — Cold/hot wallet separation, encrypted key storage (PBKDF2 + AES-256-GCM)
- **Trading** — Market orders (IOC), limit orders, position management, order cancellation
- **Dry-Run Simulation** — `--dry-run` flag simulates trades on an Anvil fork with visual report: ANSI colors, balance bar charts, mini orderbook, price scale diagram
- **Transaction Forensics** — Replay any transaction on a fork, decode events, explain what happened
- **Strategy Simulation** — Run grid/MM strategies against real on-chain liquidity via fork
- **Liquidation Simulator** — Pure-math sweep + fork-verified liquidation boundary with binary search
- **On-Chain Orderbook** — Reconstruct orderbook and view recent trades from on-chain events
- **Portfolio Queries** — Markets, positions, PnL, funding rates, fees
- **Strategies** — Grid trading, market making with position-based skew
- **Interfaces** — CLI, TypeScript SDK, Telegram bot, Web chatbot, Claude Code skills

## Roadmap

### Trading Features

- [ ] TWAP/VWAP order execution
- [ ] MEV protection
- [ ] Copy trading / reverse copy trading
- [ ] View transaction history

### DeFi Integrations

- [ ] Swap aggregation
- [ ] Cross-chain bridging to Monad via fun.xyz
- [ ] Auto-swap wallet assets to AUSD → deposit → trade
- [ ] Deposit MON in lending → borrow AUSD → buy perp

### Automated Strategies

- [ ] Delta neutral: funding > threshold → buy spot, short perp
- [ ] Funding rate arbitrage between Perpl and other perp DEXes
- [ ] Complex multi-metric strategies (funding + RSI + OI + correlation)
- [ ] Monte Carlo backtesting for strategy validation
- [ ] PineScript compatibility for TradingView strategies
- [ ] Yield maximization: perps + lending + liquid staking (hedged)

### Alerts & Monitoring

- [ ] Liquidation cluster alerts
- [ ] Thick orderbook level alerts
- [ ] Large position opened alerts
- [ ] Significant liquidation alerts
- [ ] User-customizable alert preferences

### UX Improvements

- [ ] Context memory ("Use same size as last time?", "Add stop loss?")
- [ ] Pre-execution order summary (asset, size, leverage, max loss, liq price)
- [ ] Learn user risk tolerance over time
- [ ] Clear distinction between info, suggestions, and executed trades
- [ ] Different notification styles for different events (+100% gain vs liquidation)

### Risk Management & Permissions

- [ ] Granular user permissions (max position size, no withdrawals, etc.)
- [ ] Portfolio stress testing via user-defined scenario simulations
- [ ] Auto-defend liquidation (using available collateral or wallet assets)
- [ ] Manual trading only vs automated strategies toggle
- [ ] Active monitoring vs notifications disabled

### Education

- [ ] Perpl features explanations for newbies
- [ ] Partner project guides (Fastlane, etc.) and Perpl integrations

### Social & Vaults

- [ ] Vault access for other users to deposit funds on your agent
- [ ] Leaderboard: "Who runs the best agent on Perpl?"

## Quick Start

### Prerequisites

- **Node.js 18+**
- **Foundry** (optional, for contract deployment) — [install](https://book.getfoundry.sh/getting-started/installation)

### Setup

```bash
# Install and generate wallets
npm install
npm run setup

# Or manually: copy .env.example to .env and add your keys
cp .env.example .env
```

### Deploy & Trade

```bash
# Deploy DelegatedAccount with 100 USD collateral (requires Foundry)
npm run deploy:all -- 100

# Check account status
npm run dev -- manage status

# View markets
npm run dev -- manage markets

# Open a position
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10
```

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  Owner Wallet   │────▶│  DelegatedAccount   │────▶│   Exchange   │
│  (Cold Storage) │     │  (Smart Contract)   │     │   (Perpl)    │
└─────────────────┘     └─────────────────────┘     └──────────────┘
                               ▲
                               │ (trading only)
                        ┌──────┴──────────┐
                        │ Operator Wallet │
                        │  (Hot Wallet)   │
                        └─────────────────┘
```

| Role | Capabilities |
|------|-------------|
| **Owner** | Deploy, withdraw, add/remove operators |
| **Operator** | Trading only — cannot withdraw |
| **DelegatedAccount** | Proxy contract enforcing access control |

## CLI Reference

```bash
# Account Management
npm run dev -- manage status              # Account balance and positions
npm run dev -- manage markets             # Prices and funding rates
npm run dev -- manage withdraw --amount 100  # Withdraw (owner only)

# Trading
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10  # Limit order
npm run dev -- trade open --perp btc --side long --size 0.1 --price market --leverage 10 # Market order
npm run dev -- trade cancel --perp btc --order-id 123
npm run dev -- trade cancel-all --perp btc

# Dry-Run Simulation (no real transaction)
npm run dev -- trade open --perp btc --side long --size 0.1 --price market --leverage 10 --dry-run
NO_COLOR=1 npm run dev -- trade open --perp btc --side long --size 0.1 --price market --leverage 10 --dry-run  # Plain text

# Close Positions
npm run dev -- trade close-all            # Close ALL positions + cancel ALL orders
npm run dev -- trade close-all --perp btc # Close BTC only

# Transaction Forensics (requires Anvil)
npm run dev -- debug <txhash>             # Replay tx on fork, decode events, explain what happened
npm run dev -- debug <txhash> --json      # Output raw JSON result
npm run dev -- debug <txhash> --rpc <url> # Custom RPC URL

# Strategy Dry-Run (requires Anvil)
npm run dev -- simulate strategy --strategy grid --perp btc --levels 5 --spacing 100 --size 0.001 --leverage 2
npm run dev -- simulate strategy --strategy mm --perp btc --size 0.001 --spread 0.1 --leverage 2
npm run dev -- simulate strategy --strategy grid --perp btc --spacing 100 --size 0.001 --json

# Analysis — Orderbook & Trades
npm run dev -- show book --perp btc              # On-chain orderbook
npm run dev -- show trades --perp btc            # Recent trades

# Analysis — Liquidation Simulator
npm run dev -- show liquidation --perp btc                # Pure-math sweep, funding projection
npm run dev -- show liquidation --perp btc --fork         # Fork-verified liquidation (Anvil)
npm run dev -- show liquidation --perp btc --fork --range 50  # Custom sweep range (%)

# Deployment
npm run dev -- deploy --implementation <addr> --operator <hot-wallet> --deposit 100
```

### Perpetual Markets

| Market | Perp ID |
|--------|---------|
| BTC | 16 |
| ETH | 32 |
| SOL | 48 |
| MON | 64 |
| ZEC | 256 |

## SDK Usage

```typescript
import {
  OperatorWallet,
  Portfolio,
  getChainConfig,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
} from "perpl";

// Setup
const config = getChainConfig();
const operator = OperatorWallet.fromPrivateKey(key, config);
operator.connect(exchangeAddress, delegatedAccountAddress);

// Market order
await operator.marketOpenLong({
  perpId: 16n, // BTC
  lotLNS: lotToLNS(0.1),
  leverageHdths: leverageToHdths(10),
  maxPricePNS: priceToPNS(46000),
});

// Query positions
const portfolio = new Portfolio(exchange, publicClient, exchangeAddress);
portfolio.setAccountId(accountId);
const positions = await portfolio.getPositions();
```

## Telegram Bot

Trade via Telegram with natural language commands.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Get your user ID from [@userinfobot](https://t.me/userinfobot)
3. Add to `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_USER_ID=your_numeric_id
   ```
4. Start: `npm run bot`

### Commands

| Command | Description |
|---------|-------------|
| `/status` | Account balance and positions |
| `/markets` | Prices and funding rates |
| `/help` | All available commands |

### Natural Language Examples

**Account & Markets**
```
status                          # Account balance and positions
markets                         # Prices and funding rates
my btc orders                   # View open orders
btc order book                  # View orderbook
```

**Trading (requires confirmation)**
```
long 0.01 btc at 78000 5x       # Limit long with leverage
short 0.1 eth at 3000           # Limit short
buy 1 sol at market             # Market order
```

**Order Management**
```
cancel btc order 14             # Cancel specific order
cancel all btc orders           # Cancel all orders on market
```

**Position Management**
```
close position btc              # Close BTC position only
close all btc                   # Close BTC position + cancel BTC orders
close all                       # Close ALL positions + cancel ALL orders
```

## Web Chatbot

Browser-based trading terminal powered by Claude with streaming responses and tool execution.

### Setup

1. Add `ANTHROPIC_API_KEY` to `.env`
2. Start: `npm run chatbot`
3. Open http://localhost:3000

### Commands

**Portfolio**: `show account` `show positions` `show markets` `show orders`
**Analysis**: `btc liquidation analysis` `eth funding rate` `btc fees` `btc orderbook` `recent btc trades`
**Trading** *(confirms first)*: `long 0.01 btc at 78000 5x` `short 1 eth at market 10x` `close my btc` `cancel btc order 123`
**Simulation**: `dry run long 0.01 btc at 78000 5x` `simulate grid btc` `simulate mm btc` `debug 0x...`

### Features

- **Streaming responses** — SSE-streamed Claude responses with real-time tool execution
- **Visual reports** — ANSI terminal reports (liquidation, forensics, strategy sim) rendered as HTML
- **Clickable commands** — Inline commands in responses are clickable to execute
- **Clickable tx hashes** — Transaction hashes link to `debug <txHash>` analysis
- **Command history** — Up/Down arrow keys cycle through previous commands
- **Contextual suggestions** — Follow-up command chips based on last action
- **Topic help** — `help trading` `help analysis` `help simulation` `help portfolio` (zero API cost)
- **Trade confirmation** — All write operations require explicit confirmation with self-contained commands
- **Dry-run → Execute flow** — After dry run, confirm to execute with same parameters
- **TP/SL suggestions** — After liquidation analysis, suggests stop-loss and take-profit orders
- **Batch order placement** — After strategy simulation, place all generated orders at once
- **Prompt caching** — System prompt and tools cached for ~90% input token savings
- **Dynamic token limits** — Adjusts max_tokens based on query type (400-1000)
- **History trimming** — Smart conversation pruning with contextual awareness

### Configuration

```env
ANTHROPIC_API_KEY=sk-ant-...     # Required
CHATBOT_PORT=3000                # Default: 3000
CHATBOT_MODEL=claude-haiku-4-5-20251001  # Default model
```

## Claude Code Integration

```bash
# Direct CLI commands
/perpl manage status
/perpl trade open --perp btc --side long --size 0.001 --price 75000 --leverage 2

# Natural language
/perpl-type show me my account
/perpl-type long 0.01 btc at 78000 5x
```

## Configuration

```env
# Network
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143

# Contracts (Monad Testnet)
EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027

# Wallets
OWNER_PRIVATE_KEY=0x...
OPERATOR_PRIVATE_KEY=0x...
DELEGATED_ACCOUNT_ADDRESS=0x...  # Set after deployment

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Install deps + generate wallets |
| `npm run generate-wallets` | Generate owner/operator wallets |
| `npm run deploy:all -- <amt>` | Deploy everything + deposit |
| `npm run dev -- <cmd>` | Run CLI commands |
| `npm run bot` | Start Telegram bot |
| `npm run chatbot` | Start web chatbot |
| `npm run build` | Build TypeScript |
| `npm run typecheck` | Type check |
| `npm test` | Run tests |

## Related Projects

- [api-docs](https://github.com/PerplFoundation/api-docs) — Perpl REST & WebSocket API documentation
- [delegated-account](https://github.com/PerplFoundation/delegated-account) — Owner/operator smart contract
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk) — Perpl exchange SDK and ABIs

## License

MIT
