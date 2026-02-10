/**
 * MCP Server factory — registers all 16 tools backed by sdk-bridge.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as bridge from "../chatbot/sdk-bridge.js";
import { htmlToText } from "./ansi-text.js";
import {
  getOpenOrdersSchema,
  getFundingInfoSchema,
  getLiquidationAnalysisSchema,
  getTradingFeesSchema,
  getOrderbookSchema,
  getRecentTradesSchema,
  debugTransactionSchema,
  simulateStrategySchema,
  dryRunTradeSchema,
  openPositionSchema,
  closePositionSchema,
  cancelOrderSchema,
  batchOpenPositionsSchema,
  setStopLossSchema,
  setTakeProfitSchema,
} from "./schemas.js";

/** Wrap a bridge call and return MCP content blocks. */
async function callBridge(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    // Extract _report if present
    let report: string | undefined;
    if (result && typeof result === "object" && "_report" in (result as Record<string, unknown>)) {
      const obj = result as Record<string, unknown>;
      report = htmlToText(obj._report as string);
      delete obj._report;
    }
    const content: Array<{ type: "text"; text: string }> = [
      { type: "text", text: JSON.stringify(result, null, 2) },
    ];
    if (report) {
      content.push({ type: "text", text: report });
    }
    return { content };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
      isError: true,
    };
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "perplbot",
    version: "0.1.0",
  });

  // ---- Read-only (no input) ----

  server.tool("get_account_summary", "Account balance, equity, margin, PnL", {},
    async () => callBridge(() => bridge.getAccountSummary()));

  server.tool("get_positions", "Open positions with PnL", {},
    async () => callBridge(() => bridge.getPositions()));

  server.tool("get_markets", "All markets: price, funding, OI", {},
    async () => callBridge(() => bridge.getMarkets()));

  // ---- Read-only (with input) ----

  server.tool("get_open_orders", "Resting orders, optionally by market",
    getOpenOrdersSchema,
    async ({ market }) => callBridge(() => bridge.getOpenOrders(market)));

  server.tool("get_funding_info", "Funding rate for market",
    getFundingInfoSchema,
    async ({ market }) => callBridge(() => bridge.getFundingInfo(market)));

  server.tool("get_liquidation_analysis", "Liquidation price, distance, risk",
    getLiquidationAnalysisSchema,
    async ({ market }) => callBridge(() => bridge.getLiquidationAnalysis(market)));

  server.tool("get_trading_fees", "Maker/taker fee %",
    getTradingFeesSchema,
    async ({ market }) => callBridge(() => bridge.getTradingFees(market)));

  server.tool("get_orderbook", "On-chain order book (bids/asks)",
    getOrderbookSchema,
    async ({ market, depth }) => callBridge(() => bridge.getOrderbook(market, depth)));

  server.tool("get_recent_trades", "Recent on-chain fills",
    getRecentTradesSchema,
    async ({ market, limit }) => callBridge(() => bridge.getRecentTrades(market, limit)));

  // ---- Analysis/Simulation ----

  server.tool("debug_transaction", "Replay tx: decode events, state changes. Needs Anvil.",
    debugTransactionSchema,
    async ({ tx_hash }) => callBridge(() => bridge.debugTransaction(tx_hash)));

  server.tool("simulate_strategy", "Dry-run grid/mm strategy on fork. Needs Anvil.",
    simulateStrategySchema,
    async ({ market, strategy, size, leverage, levels, spacing, center_price, spread_percent, max_position, post_only }) =>
      callBridge(() => bridge.simulateStrategy({
        market, strategy, size, leverage,
        levels, spacing,
        centerPrice: center_price,
        spreadPercent: spread_percent,
        maxPosition: max_position,
        postOnly: post_only,
      })));

  server.tool("dry_run_trade", "Simulate trade without executing",
    dryRunTradeSchema,
    async ({ market, side, size, price, leverage, is_market_order }) =>
      callBridge(() => bridge.dryRunTrade({ market, side, size, price, leverage, is_market_order })));

  // ---- Write (confirm first) ----

  server.tool("open_position", "Open position. Confirm with user first.",
    openPositionSchema,
    async ({ market, side, size, price, leverage, is_market_order }) =>
      callBridge(() => bridge.openPosition({ market, side, size, price, leverage, is_market_order })));

  server.tool("close_position", "Close position. Confirm with user first.",
    closePositionSchema,
    async ({ market, side, size, price, is_market_order }) =>
      callBridge(() => bridge.closePosition({ market, side, size, price, is_market_order })));

  server.tool("cancel_order", "Cancel resting order. Confirm with user first.",
    cancelOrderSchema,
    async ({ market, order_id }) =>
      callBridge(() => bridge.cancelOrder(market, order_id)));

  server.tool("batch_open_positions", "Place multiple orders. Confirm with user first.",
    batchOpenPositionsSchema,
    async ({ orders }) =>
      callBridge(() => bridge.batchOpenPositions(orders)));

  server.tool("set_stop_loss", "Set stop-loss trigger order. Waits for price, then closes.",
    setStopLossSchema,
    async ({ market, trigger_price, size }) =>
      callBridge(() => bridge.setStopLoss({ market, trigger_price, size })));

  server.tool("set_take_profit", "Set take-profit trigger order. Waits for price, then closes.",
    setTakeProfitSchema,
    async ({ market, trigger_price, size }) =>
      callBridge(() => bridge.setTakeProfit({ market, trigger_price, size })));

  return server;
}
