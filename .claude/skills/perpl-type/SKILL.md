---
name: perpl-type
description: Natural language Perpl commands - trades, queries, and account management
user-invocable: true
model: haiku
allowed-tools: Bash(npm run dev:*), AskUserQuestion
argument-hint: <describe what you want to do>
---

# Perpl Natural Language Interface

Convert natural language into PerplBot CLI commands.

## Usage

```
/perpl-type <describe what you want to do>
```

## Supported Commands

### Account & Portfolio
| Input | Command |
|-------|---------|
| "show me my account" | `manage status` |
| "what's my balance" | `manage status` |
| "show my positions" | `manage status` |
| "account info" | `manage status` |

### Market Data
| Input | Command |
|-------|---------|
| "show markets" | `manage markets` |
| "what are the prices" | `manage markets` |
| "show funding rates" | `manage markets` |
| "btc order book" | `show book --perp btc` |
| "show eth depth" | `show book --perp eth` |
| "recent btc trades" | `show trades --perp btc` |
| "my btc orders" | `show orders --perp btc` |
| "open eth orders" | `show orders --perp eth` |

### Account Management
| Input | Command |
|-------|---------|
| "deposit 100" | `manage deposit --amount 100` |
| "withdraw 50" | `manage withdraw --amount 50` |

### Order Management
| Input | Command |
|-------|---------|
| "cancel all btc orders" | `trade cancel-all --perp btc` |
| "cancel btc order 123" | `trade cancel --perp btc --order-id 123` |

### Trading (requires confirmation)
| Input | Command |
|-------|---------|
| "long 0.01 btc at 78000 5x" | `trade open --perp btc --side long ...` |
| "short 1 eth at market 10x" | `trade open --perp eth --side short ... --ioc` |
| "long btc $100 at market 3x" | `trade open` (USD converted to size) |
| "close my btc long 0.01 at 80000" | `trade close --perp btc --side long ...` |
| "close position btc" | Close entire position at market |
| "close all" | Cancel all orders + close all positions |

## Execution Flow

1. Parse the user's natural language input from `$ARGUMENTS`
2. Determine command type (query, account management, or trade)
3. For trades only: Use AskUserQuestion to confirm before executing
4. Execute the appropriate CLI command
5. Summarize the result in 2 sentences

## Trade Parameter Mapping

| Input phrases | Parameter |
|---------------|-----------|
| "buy", "long", "go long" | --side long |
| "sell", "short", "go short" | --side short |
| "btc", "bitcoin" | --perp btc |
| "eth", "ethereum" | --perp eth |
| "sol", "solana" | --perp sol |
| "mon", "monad" | --perp mon |
| "zec", "zcash" | --perp zec |
| "at market", "market order" | --ioc |
| "maker only", "post only" | --post-only |
| "close", "exit" | trade close |

## Examples

### Queries (execute immediately)
```
/perpl-type show me my account
/perpl-type what are the current prices
/perpl-type show btc order book
/perpl-type recent eth trades
```

### Account Management (execute immediately)
```
/perpl-type deposit 100
/perpl-type withdraw 50
/perpl-type cancel all btc orders
```

### Trades (confirm first)
```
/perpl-type long 0.01 btc at 78000 with 5x leverage
/perpl-type short 1 eth at market 10x
/perpl-type close my btc long 0.001 at 80000
```

## Confirmation Format (trades only)

Before executing a trade, ask user to confirm with AskUserQuestion:

```
Trade: OPEN LONG 0.01 BTC @ $78,000 (5x leverage)
Command: npm run dev -- trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5
```

Options: "Execute trade" or "Cancel"

## Response Format

After execution, summarize in 2 sentences maximum.

## Parser Module

The parsing logic is implemented in `src/cli/tradeParser.ts` with full test coverage in `test/tradeParser.test.ts`. The module exports:
- `parseCommand(input: string)` - Parse any natural language input
- `parseTrade(input: string)` - Parse trade-specific input
- `buildCommand(trade: ParsedTrade)` - Build CLI command string
- `formatTrade(trade: ParsedTrade)` - Format trade for display
