# PerplBot

AI agent toolkit for automated trading on [Perpl](https://perpl.xyz), a perpetual DEX on Monad.

## Overview

PerplBot provides a TypeScript SDK and CLI for building trading bots on Perpl. It implements the **owner/operator wallet pattern** using the [delegated-account](https://github.com/PerplFoundation/delegated-account) smart contract, enabling secure separation between cold storage (owner) and hot trading wallets (operator).

**Key security feature**: Operators can execute trades but can NEVER withdraw funds — this is enforced at the smart contract level.

## Features

### Wallet Management
- Create and manage cold (owner) and hot (operator) wallets
- Encrypted key storage with password protection (PBKDF2 + AES-256-GCM)
- Secure owner/operator separation enforced on-chain

### Trading Operations
- **Market orders** (IOC) — instant execution
- **Limit orders** — resting orders on the book
- **Position management** — reduce positions, add margin
- **Order management** — cancel, modify orders

### Portfolio Queries
- Available markets and prices
- Open positions with real-time PnL
- Account balance and margin usage
- Funding rates and countdown to next funding
- Trading fees (maker/taker)

### Trading Strategies
- Grid trading strategy
- Market making with position-based skew

## Installation

```bash
npm install
cp .env.example .env
# Configure your .env with RPC URL and wallet keys
```

## Quick Start

### CLI Usage

```bash
# Deploy a new delegated account
npm run dev -- deploy --implementation <addr> --operator <hot-wallet> --deposit 100

# Open a long position
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10

# Check account status
npm run dev -- manage status

# Withdraw funds (owner only)
npm run dev -- manage withdraw --amount 100
```

### SDK Usage

```typescript
import {
  KeyManager,
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
  perpId: 0n, // BTC
  lotLNS: lotToLNS(0.1),
  leverageHdths: leverageToHdths(10),
  maxPricePNS: priceToPNS(46000),
});

// Query positions
const portfolio = new Portfolio(exchange, publicClient, exchangeAddress);
portfolio.setAccountId(accountId);
const positions = await portfolio.getPositions();
```

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  Owner Wallet   │────▶│  DelegatedAccount   │────▶│   Exchange   │
│  (Cold Storage) │     │  (Smart Contract)   │     │   (Perpl)    │
└─────────────────┘     └─────────────────────┘     └──────────────┘
                               ▲
                               │ (trading only)
                        ┌──────┴────────┐
                        │ Operator Wallet│
                        │ (Hot Wallet)   │
                        └───────────────┘
```

- **Owner**: Full control — deploy, withdraw, add/remove operators
- **Operator**: Trading only — cannot withdraw funds
- **DelegatedAccount**: Proxy contract enforcing access control

## Perpetual Markets

| Market | Perp ID |
|--------|---------|
| BTC    | 0       |
| ETH    | 1       |
| SOL    | 2       |
| MON    | 3       |
| ZEC    | 4       |

## Configuration

Create a `.env` file:

```env
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143
EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027
OWNER_PRIVATE_KEY=your_owner_key
OPERATOR_PRIVATE_KEY=your_operator_key
DELEGATED_ACCOUNT_ADDRESS=your_deployed_address
```

## Development

```bash
# Type check
npm run typecheck

# Run tests (93 tests)
npm test

# Build
npm run build
```

## Related Projects

- [delegated-account](https://github.com/PerplFoundation/delegated-account) — Owner/operator smart contract
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk) — Perpl exchange SDK and ABIs

## License

MIT
