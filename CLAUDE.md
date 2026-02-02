# PerplBot

AI agent toolkit for automated trading on Perpl (perpetual DEX on Monad).

## Build and Test

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Run CLI in development
npm run dev -- <command>

# Run tests (93 tests)
npm test

# Run tests in watch mode
npm run test:watch
```

## Overview

PerplBot is a TypeScript SDK and CLI for building trading bots on Perpl. It implements the **owner/operator wallet pattern** using the `delegated-account` smart contract, allowing secure separation between cold storage (owner) and hot trading wallets (operator).

**Key security feature**: Operators can NEVER withdraw funds - this is enforced at the smart contract level.

## Project Structure

```
PerplBot/
├── src/
│   ├── sdk/                    # Core TypeScript SDK
│   │   ├── contracts/          # Contract ABIs & wrappers
│   │   │   ├── abi.ts          # All contract ABIs
│   │   │   ├── DelegatedAccount.ts
│   │   │   └── Exchange.ts
│   │   ├── wallet/             # Wallet management
│   │   │   ├── owner.ts        # Owner (cold) wallet
│   │   │   ├── operator.ts     # Operator (hot) wallet
│   │   │   └── keyManager.ts   # Secure key storage
│   │   ├── trading/            # Trading utilities
│   │   │   ├── orders.ts       # Order construction
│   │   │   ├── positions.ts    # Position management
│   │   │   ├── portfolio.ts    # Portfolio queries
│   │   │   └── strategies/     # Trading strategies
│   │   ├── state/              # State management
│   │   │   └── exchange.ts     # Exchange state tracking
│   │   ├── config.ts           # Environment config
│   │   └── index.ts            # SDK exports
│   ├── cli/                    # CLI commands
│   │   ├── deploy.ts           # Deploy DelegatedAccount
│   │   ├── trade.ts            # Execute trades
│   │   ├── manage.ts           # Account management
│   │   └── index.ts            # CLI entry point
│   └── index.ts                # Main entry point
├── test/                       # Test files
│   ├── orders.test.ts          # Order construction tests
│   ├── positions.test.ts       # Position calculation tests
│   ├── keyManager.test.ts      # Key management tests
│   └── strategies.test.ts      # Trading strategy tests
├── skills/                     # Claude Code skills
│   └── perplbot.md             # Trading skill definition
├── package.json
└── tsconfig.json
```

## Supported Operations

### Wallet Management
- Create cold (owner) wallet
- Create hot (operator) wallet
- Encrypted key storage with password

### Trading (Operator)
- Market open long/short (IOC)
- Limit open long/short
- Market close long/short
- Limit close long/short
- Reduce position (partial close)
- Add margin to position
- Cancel orders

### Account Management (Owner)
- Deploy DelegatedAccount
- Add/remove operators
- Deposit/withdraw collateral

### Portfolio Queries
- Get available markets
- Get positions
- Get account summary
- Get funding info
- Get trading fees

## Key Concepts

### Owner/Operator Pattern
- **Owner**: Cold wallet that owns the DelegatedAccount. Can withdraw funds, add/remove operators.
- **Operator**: Hot wallet for trading. Can only call allowlisted Exchange functions. CANNOT WITHDRAW.
- **DelegatedAccount**: Smart contract that enforces access control and forwards calls to Exchange.

### Contract Addresses (Monad Testnet)
- Exchange: `0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7`
- Collateral (USD stable): `0xdF5B718d8FcC173335185a2a1513eE8151e3c027`

### Perpetual IDs
- BTC: 0
- ETH: 1
- SOL: 2
- MON: 3
- ZEC: 4

## CLI Commands

### Deploy New Account
```bash
npm run dev -- deploy --implementation <addr> --operator <hot-wallet> --deposit 100
```

### Execute Trade
```bash
# Limit order
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10

# Market order (IOC)
npm run dev -- trade open --perp btc --side long --size 0.1 --price 46000 --leverage 10 --ioc
```

### Check Status
```bash
npm run dev -- manage status
```

## SDK Usage

```typescript
import {
  KeyManager,
  OwnerWallet,
  OperatorWallet,
  Portfolio,
  getChainConfig,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
} from "perplbot";

// Secure key management
const keyManager = new KeyManager("./.perplbot/keys");
const { address } = keyManager.createHotWallet("password");

// Setup operator
const config = getChainConfig();
const operator = OperatorWallet.fromPrivateKey(key, config);
operator.connect(exchangeAddr, delegatedAccountAddr);

// Market order
await operator.marketOpenLong({
  perpId: 0n,
  lotLNS: lotToLNS(0.1),
  leverageHdths: leverageToHdths(10),
  maxPricePNS: priceToPNS(46000),
});

// Portfolio queries
const portfolio = new Portfolio(exchange, publicClient, exchangeAddr);
portfolio.setAccountId(accountId);
const positions = await portfolio.getPositions();
```

## Code Style

- TypeScript with strict mode
- Use viem for blockchain interactions
- Prefer async/await over callbacks
- Export types alongside implementations

## Workflow

- Create feature branches from `main`
- Write clear commit messages
- Run `npm run typecheck` before committing
- Run `npm test` to verify changes

## References

- [delegated-account](https://github.com/PerplFoundation/delegated-account) — Owner/operator smart contract
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk) — Perpl exchange SDK and ABIs
