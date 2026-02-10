/**
 * Claude tool definitions and executor
 * Maps tool calls to sdk-bridge functions
 */

import type Anthropic from "@anthropic-ai/sdk";
import * as bridge from "./sdk-bridge.js";

export const tools: Anthropic.Tool[] = [
  // ============ Read-only tools ============
  {
    name: "get_account_summary",
    description: "Get the trading account summary including balance, equity, margin, available balance, and unrealized PnL.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_positions",
    description: "Get all open positions with market, side, size, entry price, mark price, unrealized PnL, margin, and leverage.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_markets",
    description: "Get all available markets with mark price, oracle price, funding rate, and open interest. Available markets: BTC, ETH, SOL, MON, ZEC.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_open_orders",
    description: "Get open (resting) orders. Optionally filter by market.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC). If omitted, returns orders for all markets.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_funding_info",
    description: "Get funding rate information for a specific market.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "get_liquidation_analysis",
    description: "Get detailed liquidation analysis for a position: liquidation price, distance to liquidation (% and USD), margin ratio, funding rate impact over time. Use this whenever a user asks about liquidation, risk, or how safe their position is.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "get_trading_fees",
    description: "Get maker and taker trading fee percentages for a specific market.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
      },
      required: ["market"],
    },
  },

  {
    name: "get_orderbook",
    description: "Get the on-chain order book for a market, showing bid and ask levels with sizes. Scans recent blocks for resting orders.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        depth: {
          type: "number",
          description: "Number of price levels per side (default 10).",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "get_recent_trades",
    description: "Get recent trades for a market from on-chain fill events.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        limit: {
          type: "number",
          description: "Max trades to return (default 20).",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "debug_transaction",
    description: "Replay and analyze any transaction: decode calldata, events, pre/post state, match details, failure analysis. Requires Anvil (fork-based).",
    input_schema: {
      type: "object" as const,
      properties: {
        tx_hash: {
          type: "string",
          description: "Transaction hash (0x...).",
        },
      },
      required: ["tx_hash"],
    },
  },
  {
    name: "simulate_strategy",
    description: "Dry-run a trading strategy (grid or market-maker) on a fork. Shows fills, PnL, gas, resting orders. Requires Anvil.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        strategy: {
          type: "string",
          enum: ["grid", "mm"],
          description: "Strategy type: 'grid' for grid trading, 'mm' for market making.",
        },
        size: {
          type: "number",
          description: "Order size per level/side in base asset units.",
        },
        leverage: {
          type: "number",
          description: "Leverage multiplier.",
        },
        levels: {
          type: "number",
          description: "Grid: number of levels above+below center (default 5).",
        },
        spacing: {
          type: "number",
          description: "Grid: $ between levels (default 100).",
        },
        center_price: {
          type: "number",
          description: "Grid: center price (defaults to mark price).",
        },
        spread_percent: {
          type: "number",
          description: "MM: spread as decimal e.g. 0.001 for 0.1% (default 0.001).",
        },
        max_position: {
          type: "number",
          description: "MM: max position in base asset (default 1).",
        },
        post_only: {
          type: "boolean",
          description: "Maker-only orders (default false).",
        },
      },
      required: ["market", "strategy", "size", "leverage"],
    },
  },
  {
    name: "dry_run_trade",
    description: "Simulate a trade without executing. Shows if it would succeed, gas estimate, and (if Anvil available) fill details and state changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        side: {
          type: "string",
          enum: ["long", "short"],
          description: "Position side.",
        },
        size: {
          type: "number",
          description: "Size in base asset units.",
        },
        price: {
          type: "number",
          description: "Limit price.",
        },
        leverage: {
          type: "number",
          description: "Leverage multiplier.",
        },
        is_market_order: {
          type: "boolean",
          description: "If true, IOC order (default false).",
        },
      },
      required: ["market", "side", "size", "price", "leverage"],
    },
  },

  // ============ Write tools ============
  {
    name: "open_position",
    description: "Open a new perpetual position. IMPORTANT: Always confirm with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        side: {
          type: "string",
          enum: ["long", "short"],
          description: "Position side.",
        },
        size: {
          type: "number",
          description: "Position size in base asset units (e.g., 0.01 for 0.01 BTC).",
        },
        price: {
          type: "number",
          description: "Limit price. For market orders, use a price with slippage tolerance.",
        },
        leverage: {
          type: "number",
          description: "Leverage multiplier (e.g., 5 for 5x).",
        },
        is_market_order: {
          type: "boolean",
          description: "If true, submit as immediate-or-cancel (market) order. Default false (limit).",
        },
      },
      required: ["market", "side", "size", "price", "leverage"],
    },
  },
  {
    name: "close_position",
    description: "Close an existing perpetual position. IMPORTANT: Always confirm with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        side: {
          type: "string",
          enum: ["long", "short"],
          description: "Side of the position to close.",
        },
        size: {
          type: "number",
          description: "Size to close. If omitted, closes entire position.",
        },
        price: {
          type: "number",
          description: "Price for limit close. If omitted, uses mark price with 5% slippage for market close.",
        },
        is_market_order: {
          type: "boolean",
          description: "If true, submit as market close. Default true for close operations.",
        },
      },
      required: ["market", "side"],
    },
  },
  {
    name: "cancel_order",
    description: "Cancel a resting order. IMPORTANT: Always confirm with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        market: {
          type: "string",
          description: "Market symbol (BTC, ETH, SOL, MON, ZEC).",
        },
        order_id: {
          type: "string",
          description: "The order ID to cancel.",
        },
      },
      required: ["market", "order_id"],
    },
  },
];

export interface ToolExecResult {
  data: string;
  report?: string;
}

/**
 * Execute a tool call and return the JSON result string + optional HTML report.
 */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecResult> {
  const start = Date.now();
  console.log(`[tool] ${name} called`, JSON.stringify(input));

  try {
    let result: unknown;

    switch (name) {
      case "get_account_summary":
        result = await bridge.getAccountSummary();
        break;
      case "get_positions":
        result = await bridge.getPositions();
        break;
      case "get_markets":
        result = await bridge.getMarkets();
        break;
      case "get_open_orders":
        result = await bridge.getOpenOrders(input.market as string | undefined);
        break;
      case "get_funding_info":
        result = await bridge.getFundingInfo(input.market as string);
        break;
      case "get_liquidation_analysis":
        result = await bridge.getLiquidationAnalysis(input.market as string);
        break;
      case "get_trading_fees":
        result = await bridge.getTradingFees(input.market as string);
        break;
      case "get_orderbook":
        result = await bridge.getOrderbook(input.market as string, input.depth as number | undefined);
        break;
      case "get_recent_trades":
        result = await bridge.getRecentTrades(input.market as string, input.limit as number | undefined);
        break;
      case "debug_transaction":
        result = await bridge.debugTransaction(input.tx_hash as string);
        break;
      case "simulate_strategy":
        result = await bridge.simulateStrategy({
          market: input.market as string,
          strategy: input.strategy as "grid" | "mm",
          size: input.size as number,
          leverage: input.leverage as number,
          levels: input.levels as number | undefined,
          spacing: input.spacing as number | undefined,
          centerPrice: input.center_price as number | undefined,
          spreadPercent: input.spread_percent as number | undefined,
          maxPosition: input.max_position as number | undefined,
          postOnly: input.post_only as boolean | undefined,
        });
        break;
      case "dry_run_trade":
        result = await bridge.dryRunTrade({
          market: input.market as string,
          side: input.side as "long" | "short",
          size: input.size as number,
          price: input.price as number,
          leverage: input.leverage as number,
          is_market_order: input.is_market_order as boolean | undefined,
        });
        break;
      case "open_position":
        result = await bridge.openPosition({
          market: input.market as string,
          side: input.side as "long" | "short",
          size: input.size as number,
          price: input.price as number,
          leverage: input.leverage as number,
          is_market_order: input.is_market_order as boolean | undefined,
        });
        break;
      case "close_position":
        result = await bridge.closePosition({
          market: input.market as string,
          side: input.side as "long" | "short",
          size: input.size as number | undefined,
          price: input.price as number | undefined,
          is_market_order: input.is_market_order as boolean | undefined,
        });
        break;
      case "cancel_order":
        result = await bridge.cancelOrder(input.market as string, input.order_id as string);
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }

    // Extract _report before serializing for Claude
    let report: string | undefined;
    if (result && typeof result === "object" && "_report" in (result as Record<string, unknown>)) {
      const obj = result as Record<string, unknown>;
      report = obj._report as string;
      delete obj._report;
    }

    const elapsed = Date.now() - start;
    console.log(`[tool] ${name} OK (${elapsed}ms)`, report ? "[+report]" : "", JSON.stringify(result).slice(0, 200));
    return { data: JSON.stringify(result), report };
  } catch (err) {
    const elapsed = Date.now() - start;
    const error = err as Error;
    console.error(`[tool] ${name} FAILED (${elapsed}ms):`, error.message);
    if (error.stack) console.error(error.stack);
    return { data: JSON.stringify({ error: error.message }) };
  }
}
