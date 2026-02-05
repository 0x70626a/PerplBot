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

# Run tests (332 tests)
npm test

# Run tests in watch mode
npm run test:watch
```

## Overview

PerplBot is a TypeScript SDK and CLI for building trading bots on Perpl. It implements the **owner/operator wallet pattern** using the `delegated-account` smart contract, allowing secure separation between cold storage (owner) and hot trading wallets (operator).

**Key security feature**: Operators can NEVER withdraw funds - this is enforced at the smart contract level.

## Bot Modes

### Single-User Mode (Legacy)
Set `TELEGRAM_USER_ID` to restrict bot to one user. Uses `OWNER_PRIVATE_KEY` for all operations.

### Multi-User Mode
Set `MULTI_USER_MODE=true` to enable multi-user support:
- Users link wallets via `/link` and signature verification
- Users set their DelegatedAccount via `/setaccount`
- Bot operator key (`BOT_OPERATOR_PRIVATE_KEY`) must be added as operator on each user's DelegatedAccount
- Bot can trade on behalf of users but CANNOT withdraw (enforced by smart contract)

**Environment Variables for Multi-User:**
```bash
MULTI_USER_MODE=true
BOT_OPERATOR_PRIVATE_KEY=0x...  # Bot's operator wallet (added to users' accounts)
DATABASE_PATH=./data/perpl.db  # SQLite database for user storage
IMPLEMENTATION_ADDRESS=0x...  # Optional: DelegatedAccount implementation address (for /deploy)
```

### Testnet Configuration
All contract addresses and RPC URLs default to Monad Testnet. Override with environment variables:

```bash
TESTNET_MODE=true  # Defaults to true (testnet only supported currently)
TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
TESTNET_EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
TESTNET_COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027
TESTNET_CHAIN_ID=10143
TESTNET_API_URL=https://testnet.perpl.xyz/api
TESTNET_WS_URL=wss://testnet.perpl.xyz
```

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
│   ├── api/                    # API client tests
│   │   ├── client.test.ts      # REST API client tests
│   │   └── websocket.test.ts   # WebSocket client tests
│   ├── orders.test.ts          # Order construction tests
│   ├── positions.test.ts       # Position calculation tests
│   ├── keyManager.test.ts      # Key management tests
│   └── strategies.test.ts      # Trading strategy tests
├── skills/                     # Claude Code skills
│   └── perpl.md             # Trading skill definition
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

### Perpetual IDs (from dex-sdk testnet config)
- BTC: 16
- ETH: 32
- SOL: 48
- MON: 64
- ZEC: 256

Use `npx tsx scripts/check-markets.ts` to check market status.

### API Authentication vs Smart Contract Account

**Important**: These are separate concepts that are often confused.

| Concept | What It Means | How to Check |
|---------|---------------|--------------|
| **API Auth** | Wallet is whitelisted to use REST/WS API | `/auth` endpoint succeeds |
| **Exchange Account** | On-chain account exists with collateral | `manage status` shows account ID |

- The API `/auth` endpoint accepts any whitelisted wallet address
- Successful API authentication does NOT create an exchange account
- An exchange account must be created on-chain via `createAccount()` with initial deposit
- Trading requires BOTH: API auth (for API mode) AND exchange account (for on-chain execution)

```bash
# Check if account exists
npm run dev -- manage status

# Create account if needed (deposits collateral and creates account)
npm run dev -- manage deposit --amount 100
```

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
} from "perpl";

// Secure key management
const keyManager = new KeyManager("./.perpl/keys");
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

## Workflow Orchestration
### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons-md*
with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- For new features: run BOTH unit tests AND integration tests (actually execute the commands)
- **Always write a test plan** for non-trivial features (save to `tasks/<feature>-test-plan.md`)

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to 'tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. *Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to 'tasks/todo.md*
6. **Capture Lessons**: Update 'tasks/lessons.md after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Document Features**: When adding new features, update all relevant docs (README.md, CLAUDE.md, skill files, /perpl help).

## Claude Code Skills

### Available Skills

| Skill | Description | Usage |
|-------|-------------|-------|
| `/perpl` | Execute CLI commands directly | `/perpl manage status` |
| `/perpl-type` | Natural language trading | `/perpl-type long 0.01 btc at 78000 5x` |
| `/reviewer` | Code review expert | `/reviewer` or `/reviewer <file>` |

### Reviewer Skill

The `/reviewer` skill performs comprehensive code review with a senior engineer perspective:

**Review Dimensions:**
1. SOLID principles violations
2. Security vulnerabilities (XSS, injection, SSRF, etc.)
3. Performance issues (N+1 queries, missing caching)
4. Error handling gaps
5. Boundary condition bugs
6. Dead code detection

**Severity Levels:**
- **P0**: Security/data loss - block merge
- **P1**: Runtime bugs - must fix
- **P2**: Quality issues - should fix
- **P3**: Style/preference - optional

**Usage:**
```bash
/reviewer              # Review uncommitted changes
/reviewer --staged     # Review staged changes only
/reviewer <file>       # Review specific file
/reviewer --pr 123     # Review PR #123
```

**Verification Gate:**
- `npm run typecheck` passes
- `npm test` passes (332 tests)
- No P0 or P1 issues remain
- "Would a staff engineer approve this?"

## References

- [api-docs](https://github.com/PerplFoundation/api-docs) — Perpl REST & WebSocket API documentation
- [delegated-account](https://github.com/PerplFoundation/delegated-account) — Owner/operator smart contract
- [dex-sdk](https://github.com/PerplFoundation/dex-sdk) — Perpl exchange SDK and ABIs
