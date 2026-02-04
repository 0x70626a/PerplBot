/**
 * Trade handler - Trade execution with confirmation
 * Shows preview with inline keyboard, executes on confirm
 */

import type { Context } from "telegraf";
import { Markup } from "telegraf";
import type { ParsedTrade } from "../../cli/tradeParser.js";
import {
  loadEnvConfig,
  validateOwnerConfig,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
  pnsToPrice,
} from "../../sdk/index.js";
import { OrderType, type OrderDesc } from "../../sdk/contracts/Exchange.js";
import {
  formatTradePreview,
  formatTradeResult,
  formatError,
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

// Store pending trades by chat ID (simple in-memory store)
const pendingTrades: Map<number, ParsedTrade> = new Map();

/**
 * Get current market price for a perpetual
 */
async function getMarketPrice(perpId: bigint): Promise<number> {
  console.log("[TRADE] Getting market price...");
  const client = await createHybridClient({ authenticate: false });

  const perpInfo = await client.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  return pnsToPrice(perpInfo.markPNS, priceDecimals);
}

/**
 * Show trade confirmation with inline keyboard
 */
export async function showTradeConfirmation(
  ctx: Context,
  trade: ParsedTrade
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const perpId = PERP_NAMES[trade.market];
  if (perpId === undefined) {
    await ctx.reply(formatError(`Unknown market: ${trade.market}`), { parse_mode: "MarkdownV2" });
    return;
  }

  // Get market price for USD conversion or market orders
  const marketPrice = await getMarketPrice(perpId);

  // If size is in USD, convert to native units
  if (trade.sizeIsUsd) {
    const sizeInNative = trade.size / marketPrice;
    trade = { ...trade, size: sizeInNative, sizeIsUsd: false };
  }

  // If market order, set price with slippage buffer
  if (trade.price === "market") {
    const slippage = trade.side === "long" ? 1.005 : 0.995;
    trade = { ...trade, price: marketPrice * slippage };
  }

  // Store pending trade
  pendingTrades.set(chatId, trade);

  const preview = formatTradePreview(trade);

  await ctx.reply(preview, {
    parse_mode: "MarkdownV2",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("Confirm", "trade_confirm"),
        Markup.button.callback("Cancel", "trade_cancel"),
      ],
    ]),
  });
}

/**
 * Execute a parsed trade
 */
async function executeTrade(trade: ParsedTrade): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    console.log(`[TRADE] Executing: ${trade.action} ${trade.side} ${trade.size} ${trade.market}`);

    const client = await createHybridClient({ withWalletClient: true });

    const perpId = PERP_NAMES[trade.market];
    if (perpId === undefined) {
      return { success: false, error: `Unknown market: ${trade.market}` };
    }

    // Get perpetual info for decimals
    const perpInfo = await client.getPerpetualInfo(perpId);
    const priceDecimals = BigInt(perpInfo.priceDecimals);
    const lotDecimals = BigInt(perpInfo.lotDecimals);

    // Determine order type
    let orderType: OrderType;
    if (trade.action === "open") {
      orderType = trade.side === "long" ? OrderType.OpenLong : OrderType.OpenShort;
    } else {
      orderType = trade.side === "long" ? OrderType.CloseLong : OrderType.CloseShort;
    }

    const price = trade.price === "market" ? 0 : trade.price;

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType,
      orderId: 0n,
      pricePNS: priceToPNS(price, priceDecimals),
      lotLNS: lotToLNS(trade.size, lotDecimals),
      expiryBlock: 0n,
      postOnly: trade.options.postOnly,
      fillOrKill: false,
      immediateOrCancel: trade.options.ioc,
      maxMatches: 0n,
      leverageHdths: leverageToHdths(trade.leverage ?? 1),
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    const txHash = await client.execOrder(orderDesc);
    console.log(`[TRADE] Success: ${txHash}`);
    return { success: true, txHash };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[TRADE] Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle trade confirmation callback
 */
export async function handleTradeConfirm(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const trade = pendingTrades.get(chatId);
  if (!trade) {
    await ctx.answerCbQuery("No pending trade found");
    return;
  }

  // Clear pending trade
  pendingTrades.delete(chatId);

  await ctx.answerCbQuery("Executing trade...");

  // Remove inline keyboard
  await ctx.editMessageReplyMarkup(undefined);

  const result = await executeTrade(trade);
  const message = formatTradeResult(result);

  await ctx.reply(message, { parse_mode: "MarkdownV2" });
}

/**
 * Handle trade cancellation callback
 */
export async function handleTradeCancel(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Clear pending trade
  pendingTrades.delete(chatId);

  await ctx.answerCbQuery("Trade cancelled");

  // Remove inline keyboard
  await ctx.editMessageReplyMarkup(undefined);

  await ctx.reply("Trade cancelled\\.", { parse_mode: "MarkdownV2" });
}
