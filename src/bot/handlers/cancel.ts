/**
 * Cancel handlers - Cancel single order or all orders
 */

import type { BotContext } from "../types.js";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  PERPETUALS,
} from "../../sdk/index.js";
import { OrderType, type OrderDesc } from "../../sdk/contracts/Exchange.js";
import type { Market } from "../../cli/tradeParser.js";
import {
  formatCancelResult,
  formatCancelAllResult,
  formatOpenOrders,
  formatError,
  type OpenOrder,
} from "../formatters/telegram.js";
import { createHybridClient } from "../client.js";

// Market name to ID mapping
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
};

const ORDER_TYPE_NAMES: Record<number, string> = {
  0: "Open Long",
  1: "Open Short",
  2: "Close Long",
  3: "Close Short",
};

/**
 * Fetch open orders for a market
 */
export async function fetchOpenOrders(market: Market): Promise<OpenOrder[]> {
  const config = loadEnvConfig();
  validateOwnerConfig(config);

  const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

  console.log("[CANCEL] Creating HybridClient...");
  const client = await createHybridClient({ withWalletClient: true });

  const perpId = PERP_NAMES[market];

  // Get account
  const accountInfo = await client.getAccountByAddress(owner.address);
  if (accountInfo.accountId === 0n) {
    return [];
  }

  // Get perpetual info for decimals
  const perpInfo = await client.getPerpetualInfo(perpId);
  const priceDecimals = Number(perpInfo.priceDecimals);
  const lotDecimals = Number(perpInfo.lotDecimals);

  // Get open orders
  const orders = await client.getOpenOrders(perpId, accountInfo.accountId);

  return orders.map((order) => ({
    orderId: order.orderId,
    orderType: ORDER_TYPE_NAMES[order.orderType] || `Type ${order.orderType}`,
    price: order.priceONS / Math.pow(10, priceDecimals - 9), // ONS to price
    size: Number(order.lotLNS) / Math.pow(10, lotDecimals + 9), // LNS to lot
    leverage: order.leverageHdths / 100,
  }));
}

/**
 * Handle showing open orders
 */
export async function handleOpenOrders(ctx: BotContext, market: Market): Promise<void> {
  try {
    await ctx.reply(`Fetching ${market.toUpperCase()} open orders...`);

    const orders = await fetchOpenOrders(market);
    const message = formatOpenOrders(market.toUpperCase(), orders);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}

/**
 * Cancel a single order
 */
export async function cancelOrder(
  market: Market,
  orderId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    console.log(`[CANCEL] Cancelling order ${orderId} on ${market}...`);
    const client = await createHybridClient({ withWalletClient: true });

    const perpId = PERP_NAMES[market];

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType: OrderType.Cancel,
      orderId: BigInt(orderId),
      pricePNS: 0n,
      lotLNS: 0n,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 0n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    const txHash = await client.execOrder(orderDesc);
    return { success: true, txHash };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle cancel single order
 */
export async function handleCancelOrder(
  ctx: BotContext,
  market: Market,
  orderId: string
): Promise<void> {
  try {
    await ctx.reply(`Cancelling ${market.toUpperCase()} order #${orderId}...`);

    const result = await cancelOrder(market, orderId);
    const message = formatCancelResult(result.success, orderId, result.txHash, result.error);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}

/**
 * Cancel all orders for a market
 */
export async function cancelAllOrders(market: Market): Promise<{
  cancelled: number;
  total: number;
}> {
  const config = loadEnvConfig();
  validateOwnerConfig(config);

  const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

  console.log(`[CANCEL] Cancelling all ${market} orders...`);
  const client = await createHybridClient({ withWalletClient: true });

  const perpId = PERP_NAMES[market];

  // Get account
  const accountInfo = await client.getAccountByAddress(owner.address);
  if (accountInfo.accountId === 0n) {
    return { cancelled: 0, total: 0 };
  }

  // Get open orders
  const orders = await client.getOpenOrders(perpId, accountInfo.accountId);
  console.log(`[CANCEL] Found ${orders.length} open orders for ${market}`);

  if (orders.length === 0) {
    return { cancelled: 0, total: 0 };
  }

  let cancelled = 0;
  for (const order of orders) {
    console.log(`[CANCEL] Cancelling order ${order.orderId}...`);
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType: OrderType.Cancel,
      orderId: order.orderId,
      pricePNS: 0n,
      lotLNS: 0n,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 0n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    try {
      const txHash = await client.execOrder(orderDesc);
      console.log(`[CANCEL] Order ${order.orderId} cancelled: ${txHash}`);
      cancelled++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[CANCEL] Failed to cancel order ${order.orderId}: ${errorMsg}`);
    }
  }

  return { cancelled, total: orders.length };
}

/**
 * Handle cancel all orders
 */
export async function handleCancelAll(ctx: BotContext, market: Market): Promise<void> {
  try {
    await ctx.reply(`Cancelling all ${market.toUpperCase()} orders...`);

    const { cancelled, total } = await cancelAllOrders(market);
    const message = formatCancelAllResult(cancelled, total, market.toUpperCase());

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
