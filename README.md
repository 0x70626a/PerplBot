# PerplBot

AI agent toolkit for automated trading on [Perpl](https://perpl.xyz), a perpetual DEX on Monad.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [CLI Reference](#cli-reference)
- [SDK Usage](#sdk-usage)
- [Telegram Bot](#telegram-bot)
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
- **Portfolio Queries** — Markets, positions, PnL, funding rates, fees
- **Strategies** — Grid trading, market making with position-based skew
- **Interfaces** — CLI, TypeScript SDK, Telegram bot, Claude Code skills

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
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10
npm run dev -- trade open --perp btc --side long --size 0.1 --price 46000 --leverage 10 --ioc  # Market order
npm run dev -- trade cancel --perp btc --order-id 123
npm run dev -- trade cancel-all --perp btc

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
} from "perplbot";

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

```
status                          # Account info
markets                         # Prices
long 0.01 btc at 78000 5x       # Open position (confirms first)
cancel all btc orders           # Cancel orders
close all                       # Close everything
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
| `npm run build` | Build TypeScript |
| `npm run typecheck` | Type check |
| `npm test` | Run tests |

## Related Projects

- [api-docs](https://github.com/PerplFoundation/api-docs) — Perpl REST & WebSocket API documentation
- [delegated-account](https://github.com/PerplFoundation/delegated-account) — Owner/operator smart contract
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk) — Perpl exchange SDK and ABIs

## License

MIT
