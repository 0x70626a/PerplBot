/**
 * Claude tool definitions and executor
 * Maps tool calls to sdk-bridge functions
 */

import type Anthropic from "@anthropic-ai/sdk";
import * as bridge from "./sdk-bridge.js";

// Concise tool definitions — descriptions kept minimal to reduce token cost.
// "M" = market param shorthand used in descriptions.
const M = { type: "string" as const, description: "BTC/ETH/SOL/MON/ZEC" };

export const tools: Anthropic.Tool[] = [
  // ---- Read-only ----
  { name: "get_account_summary", description: "Account balance, equity, margin, PnL",
    input_schema: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_positions", description: "Open positions with PnL",
    input_schema: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_markets", description: "All markets: price, funding, OI",
    input_schema: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_open_orders", description: "Resting orders, optionally by market",
    input_schema: { type: "object" as const, properties: { market: M }, required: [] } },
  { name: "get_funding_info", description: "Funding rate for market",
    input_schema: { type: "object" as const, properties: { market: M }, required: ["market"] } },
  { name: "get_liquidation_analysis", description: "Liquidation price, distance, risk. Use for liquidation/risk queries.",
    input_schema: { type: "object" as const, properties: { market: M }, required: ["market"] } },
  { name: "get_trading_fees", description: "Maker/taker fee %",
    input_schema: { type: "object" as const, properties: { market: M }, required: ["market"] } },
  { name: "get_orderbook", description: "On-chain order book (bids/asks)",
    input_schema: { type: "object" as const, properties: { market: M,
      depth: { type: "number" as const, description: "Levels per side (default 10)" } }, required: ["market"] } },
  { name: "get_recent_trades", description: "Recent on-chain fills",
    input_schema: { type: "object" as const, properties: { market: M,
      limit: { type: "number" as const, description: "Max trades (default 20)" } }, required: ["market"] } },
  // ---- Analysis/Simulation ----
  { name: "debug_transaction", description: "Replay tx: decode events, state changes. Needs Anvil.",
    input_schema: { type: "object" as const, properties: {
      tx_hash: { type: "string" as const, description: "0x..." } }, required: ["tx_hash"] } },
  { name: "simulate_strategy", description: "Dry-run grid/mm strategy on fork. Needs Anvil.",
    input_schema: { type: "object" as const, properties: {
      market: M,
      strategy: { type: "string" as const, enum: ["grid", "mm"] },
      size: { type: "number" as const, description: "Size per level" },
      leverage: { type: "number" as const },
      levels: { type: "number" as const, description: "Grid levels (default 5)" },
      spacing: { type: "number" as const, description: "Grid $ spacing (default 100)" },
      center_price: { type: "number" as const, description: "Grid center (default mark)" },
      spread_percent: { type: "number" as const, description: "MM spread decimal (default 0.001)" },
      max_position: { type: "number" as const, description: "MM max pos (default 1)" },
      post_only: { type: "boolean" as const },
    }, required: ["market", "strategy", "size", "leverage"] } },
  { name: "dry_run_trade", description: "Simulate trade without executing",
    input_schema: { type: "object" as const, properties: {
      market: M,
      side: { type: "string" as const, enum: ["long", "short"] },
      size: { type: "number" as const },
      price: { type: "number" as const },
      leverage: { type: "number" as const },
      is_market_order: { type: "boolean" as const, description: "IOC (default false)" },
    }, required: ["market", "side", "size", "price", "leverage"] } },
  // ---- Write (confirm first) ----
  { name: "open_position", description: "Open position. Confirm with user first.",
    input_schema: { type: "object" as const, properties: {
      market: M,
      side: { type: "string" as const, enum: ["long", "short"] },
      size: { type: "number" as const },
      price: { type: "number" as const },
      leverage: { type: "number" as const },
      is_market_order: { type: "boolean" as const, description: "IOC (default false)" },
    }, required: ["market", "side", "size", "price", "leverage"] } },
  { name: "close_position", description: "Close position. Confirm with user first.",
    input_schema: { type: "object" as const, properties: {
      market: M,
      side: { type: "string" as const, enum: ["long", "short"] },
      size: { type: "number" as const, description: "Omit to close all" },
      price: { type: "number" as const, description: "Omit for market close" },
      is_market_order: { type: "boolean" as const, description: "Default true for close" },
    }, required: ["market", "side"] } },
  { name: "cancel_order", description: "Cancel resting order. Confirm with user first.",
    input_schema: { type: "object" as const, properties: {
      market: M,
      order_id: { type: "string" as const },
    }, required: ["market", "order_id"] } },
  { name: "batch_open_positions", description: "Place multiple orders. Use after strategy sim. Confirm with user first.",
    input_schema: { type: "object" as const, properties: {
      orders: { type: "array" as const, description: "Array of orders", items: { type: "object" as const, properties: {
        market: M,
        side: { type: "string" as const, enum: ["long", "short"] },
        size: { type: "number" as const },
        price: { type: "number" as const },
        leverage: { type: "number" as const },
      }, required: ["market", "side", "size", "price", "leverage"] } },
    }, required: ["orders"] } },
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
      case "batch_open_positions":
        result = await bridge.batchOpenPositions(
          input.orders as Array<{ market: string; side: "long" | "short"; size: number; price: number; leverage: number }>,
        );
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
