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

## Prerequisites

- **Node.js 18+** — for running the SDK and CLI
- **Foundry** (optional) — for deploying contracts. Install from [book.getfoundry.sh](https://book.getfoundry.sh/getting-started/installation)

## Installation

```bash
npm install
```

## Getting Started

### Option 1: Automated Setup (Recommended)

Run the setup script to install dependencies and generate wallets:

```bash
npm run setup
```

Or just generate wallets:

```bash
npm run generate-wallets
```

### Option 2: Manual Setup

#### Step 1: Generate Wallets

You need two wallets:
- **Owner (Cold) Wallet**: For deployment, deposits, withdrawals
- **Operator (Hot) Wallet**: For trading only (cannot withdraw)

Generate wallets using one of these methods:

**Using the built-in script:**
```bash
npx tsx scripts/generate-wallets.ts
```

**Using Node.js directly:**
```bash
npx tsx -e "
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
console.log('Address:', account.address);
console.log('Private Key:', pk);
"
```

Run twice — once for owner, once for operator.

**Using Foundry:**
```bash
cast wallet new
```

#### Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your wallet private keys:

```env
# Monad Testnet Configuration
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143

# Contract Addresses (Monad Testnet)
EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027

# Wallet Private Keys
OWNER_PRIVATE_KEY=0x...your_owner_private_key...
OPERATOR_PRIVATE_KEY=0x...your_operator_private_key...

# Set after deploying DelegatedAccount
DELEGATED_ACCOUNT_ADDRESS=
```

#### Step 3: Fund Your Wallets

1. **Get testnet MON** (for gas) from the Monad faucet
   - Fund the owner wallet address

2. **Get testnet USD stable** (for trading collateral)
   - You'll need USD stable tokens in the owner wallet to deposit

#### Step 4: Deploy DelegatedAccount

**Option A: One-command deployment (Recommended)**

Deploy everything in one command (requires [Foundry](https://book.getfoundry.sh/getting-started/installation)):

```bash
npm run deploy:all -- 100
```

This will:
1. Deploy the DelegatedAccount implementation contract
2. Deploy a proxy pointing to the implementation
3. Register your operator wallet
4. Deposit 100 USD stable as trading collateral

**Option B: Step-by-step deployment**

First, deploy the implementation contract:

```bash
npm run deploy:implementation
```

This outputs an implementation address. Then deploy your proxy:

```bash
npm run dev -- deploy \
  --implementation <IMPLEMENTATION_ADDRESS> \
  --operator <YOUR_OPERATOR_ADDRESS> \
  --deposit 100
```

**Option C: Use existing implementation**

If an implementation is already deployed on the network, you can skip to deploying the proxy:

```bash
npm run dev -- deploy \
  --implementation 0x<EXISTING_IMPL_ADDRESS> \
  --operator <YOUR_OPERATOR_ADDRESS> \
  --deposit 100
```

After deployment, add the proxy contract address to your `.env`:

```env
DELEGATED_ACCOUNT_ADDRESS=0x...deployed_proxy_address...
```

#### Step 5: Start Trading

Check your account status:

```bash
npm run dev -- manage status
```

Open a position:

```bash
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10
```

## Quick Start

### CLI Usage

```bash
# Deploy a new delegated account
npm run dev -- deploy --implementation <addr> --operator <hot-wallet> --deposit 100

# View available markets with prices and funding rates
npm run dev -- manage markets

# Open a long position
npm run dev -- trade open --perp btc --side long --size 0.1 --price 45000 --leverage 10

# Check account status
npm run dev -- manage status

# Cancel an order
npm run dev -- trade cancel --perp btc --order-id 123

# Cancel all orders on a market
npm run dev -- trade cancel-all --perp btc

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
                        ┌──────┴──────────┐
                        │ Operator Wallet │
                        │  (Hot Wallet)   │
                        └─────────────────┘
```

- **Owner**: Full control — deploy, withdraw, add/remove operators
- **Operator**: Trading only — cannot withdraw funds
- **DelegatedAccount**: Proxy contract enforcing access control

## Perpetual Markets

Perpetual IDs from [dex-sdk testnet config](https://github.com/PerplFoundation/dex-sdk/blob/main/crates/sdk/src/lib.rs):

| Market | Perp ID |
|--------|---------|
| BTC    | 16      |
| ETH    | 32      |
| SOL    | 48      |
| MON    | 64      |
| ZEC    | 256     |

View live market data with:

```bash
npm run dev -- manage markets
```

Output:
```
Symbol  Mark Price    Oracle Price  Funding/8h  Long OI     Short OI    Status
--------------------------------------------------------------------------------
BTC     $77,746.50    $77,745.50    +0.0150%    35.3789     35.3789     Active
ETH     $2,304.16     $2,303.45     +0.0240%    656.571     656.571     Active
SOL     $102.90       $102.89       -0.0130%    4374.687    4374.687    Active
MON     $0.02         $0.02         -0.0500%    22240799    22240799    Active
ZEC     $298.26       $298.42       +0.0500%    594.275     594.275     Active
```

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

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Full setup: install deps + generate wallets |
| `npm run generate-wallets` | Generate owner and operator wallets |
| `npm run deploy:implementation` | Deploy DelegatedAccount implementation (requires Foundry) |
| `npm run deploy:all -- <deposit>` | Deploy implementation + proxy in one command |
| `npm run dev -- <cmd>` | Run CLI commands in development mode |
| `npm run build` | Build TypeScript to dist/ |
| `npm run typecheck` | Type check without emitting |
| `npm test` | Run unit tests (local, no network) |
| `npm run test:unit` | Run unit tests only |
| `npm run test:testnet` | Run integration tests against Monad testnet |
| `npm run test:all` | Run all tests (unit + testnet) |

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
