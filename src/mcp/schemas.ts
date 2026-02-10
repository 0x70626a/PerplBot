/**
 * Zod input schemas for MCP tool registrations.
 * Mirrors the Anthropic JSON schemas in chatbot/tools.ts.
 */

import { z } from "zod";

const market = z.string().describe("BTC/ETH/SOL/MON/ZEC");

// ---- Read-only ----

export const getOpenOrdersSchema = {
  market: market.optional(),
};

export const getFundingInfoSchema = {
  market,
};

export const getLiquidationAnalysisSchema = {
  market,
};

export const getTradingFeesSchema = {
  market,
};

export const getOrderbookSchema = {
  market,
  depth: z.number().optional().describe("Levels per side (default 10)"),
};

export const getRecentTradesSchema = {
  market,
  limit: z.number().optional().describe("Max trades (default 20)"),
};

// ---- Analysis/Simulation ----

export const debugTransactionSchema = {
  tx_hash: z.string().describe("0x..."),
};

export const simulateStrategySchema = {
  market,
  strategy: z.enum(["grid", "mm"]),
  size: z.number().describe("Size per level"),
  leverage: z.number(),
  levels: z.number().optional().describe("Grid levels (default 5)"),
  spacing: z.number().optional().describe("Grid $ spacing (default 100)"),
  center_price: z.number().optional().describe("Grid center (default mark)"),
  spread_percent: z.number().optional().describe("MM spread decimal (default 0.001)"),
  max_position: z.number().optional().describe("MM max pos (default 1)"),
  post_only: z.boolean().optional(),
};

export const dryRunTradeSchema = {
  market,
  side: z.enum(["long", "short"]),
  size: z.number(),
  price: z.number(),
  leverage: z.number(),
  is_market_order: z.boolean().optional().describe("IOC (default false)"),
};

// ---- Write ----

export const openPositionSchema = {
  market,
  side: z.enum(["long", "short"]),
  size: z.number(),
  price: z.number(),
  leverage: z.number(),
  is_market_order: z.boolean().optional().describe("IOC (default false)"),
};

export const closePositionSchema = {
  market,
  side: z.enum(["long", "short"]),
  size: z.number().optional().describe("Omit to close all"),
  price: z.number().optional().describe("Omit for market close"),
  is_market_order: z.boolean().optional().describe("Default true for close"),
};

export const cancelOrderSchema = {
  market,
  order_id: z.string(),
};

const orderSchema = z.object({
  market,
  side: z.enum(["long", "short"]),
  size: z.number(),
  price: z.number(),
  leverage: z.number(),
});

export const batchOpenPositionsSchema = {
  orders: z.array(orderSchema).describe("Array of orders"),
};

export const setStopLossSchema = {
  market,
  trigger_price: z.number().describe("Price level to trigger close"),
  size: z.number().optional().describe("Omit to close full position"),
};

export const setTakeProfitSchema = {
  market,
  trigger_price: z.number().describe("Price level to trigger close"),
  size: z.number().optional().describe("Omit to close full position"),
};
