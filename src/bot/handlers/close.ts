/**
 * Close handlers - Close positions and cancel orders
 * "close position" - closes a specific market position
 * "close all" - cancels all orders and closes all positions
 */

import type { Context } from "telegraf";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  PERPETUALS,
  ALL_PERP_IDS,
  priceToPNS,
  pnsToPrice,
} from "../../sdk/index.js";
import { OrderType, type OrderDesc } from "../../sdk/contracts/Exchange.js";
import type { Market } from "../../cli/tradeParser.js";
import { formatError } from "../formatters/telegram.js";
import { createHybridClient } from "../client.js";

// Market name to ID mapping
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
};

const PERP_IDS_TO_NAMES: Record<string, string> = {
  "16": "BTC",
  "32": "ETH",
  "48": "SOL",
  "64": "MON",
  "256": "ZEC",
};

/**
 * Escape special markdown characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

/**
 * Close a position on a specific market
 */
async function closePosition(market: Market): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  noPosition?: boolean;
}> {
  try {
    console.log(`[CLOSE] Closing ${market} position...`);
    const client = await createHybridClient({ withWalletClient: true });

    const config = loadEnvConfig();
    validateOwnerConfig(config);
    const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

    const perpId = PERP_NAMES[market];

    // Get account
    const accountInfo = await client.getAccountByAddress(owner.address);
    if (accountInfo.accountId === 0n) {
      return { success: false, error: "No exchange account found" };
    }

    // Get position
    const { position, markPrice } = await client.getPosition(perpId, accountInfo.accountId);

    if (position.lotLNS === 0n) {
      return { success: true, noPosition: true };
    }

    // Get perpetual info for decimals
    const perpInfo = await client.getPerpetualInfo(perpId);
    const priceDecimals = BigInt(perpInfo.priceDecimals);
    const lotDecimals = BigInt(perpInfo.lotDecimals);

    // Determine close order type based on position type
    // positionType: 0 = Long, 1 = Short
    const isLong = Number(position.positionType) === 0;
    const orderType = isLong ? OrderType.CloseLong : OrderType.CloseShort;

    // Use mark price with slippage for IOC order
    const currentPrice = pnsToPrice(markPrice, priceDecimals);
    const slippagePrice = isLong ? currentPrice * 0.99 : currentPrice * 1.01;

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType,
      orderId: 0n,
      pricePNS: priceToPNS(slippagePrice, priceDecimals),
      lotLNS: position.lotLNS,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: true, // Market order
      maxMatches: 0n,
      leverageHdths: 100n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    const txHash = await client.execOrder(orderDesc);
    console.log(`[CLOSE] Position closed: ${txHash}`);
    return { success: true, txHash };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[CLOSE] Error closing position: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle close position request
 */
export async function handleClosePosition(ctx: Context, market: Market): Promise<void> {
  try {
    await ctx.reply(`Closing ${market.toUpperCase()} position...`);

    const result = await closePosition(market);

    if (result.noPosition) {
      await ctx.reply(`No ${market.toUpperCase()} position to close\\.`, { parse_mode: "MarkdownV2" });
    } else if (result.success && result.txHash) {
      await ctx.reply(
        `*${market.toUpperCase()} Position Closed*\n\nTx: \`${result.txHash}\``,
        { parse_mode: "MarkdownV2" }
      );
    } else {
      await ctx.reply(formatError(result.error || "Unknown error"), { parse_mode: "MarkdownV2" });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}

/**
 * Close all positions and cancel all orders
 */
async function closeAll(specificMarket?: Market): Promise<{
  ordersCancelled: number;
  positionsClosed: number;
  errors: string[];
}> {
  const config = loadEnvConfig();
  validateOwnerConfig(config);

  const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

  console.log(`[CLOSE] Closing all ${specificMarket || "positions"}...`);
  const client = await createHybridClient({ withWalletClient: true });

  // Get account
  const accountInfo = await client.getAccountByAddress(owner.address);
  if (accountInfo.accountId === 0n) {
    return { ordersCancelled: 0, positionsClosed: 0, errors: ["No exchange account found"] };
  }

  const errors: string[] = [];
  let ordersCancelled = 0;
  let positionsClosed = 0;

  // Determine which markets to process
  const marketsToProcess = specificMarket
    ? [PERP_NAMES[specificMarket]]
    : ALL_PERP_IDS;

  for (const perpId of marketsToProcess) {
    const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || perpId.toString();

    try {
      // Cancel all open orders for this market
      const orders = await client.getOpenOrders(perpId, accountInfo.accountId);
      console.log(`[CLOSE] Found ${orders.length} open orders for ${perpName}`);

      for (const order of orders) {
        try {
          console.log(`[CLOSE] Cancelling order ${order.orderId} on ${perpName}...`);
          const cancelDesc: OrderDesc = {
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
          const txHash = await client.execOrder(cancelDesc);
          console.log(`[CLOSE] Order ${order.orderId} cancelled: ${txHash}`);
          ordersCancelled++;
        } catch (e: any) {
          console.error(`[CLOSE] Failed to cancel order ${order.orderId}: ${e.message}`);
          errors.push(`Failed to cancel ${perpName} order #${order.orderId}: ${e.message}`);
        }
      }

      // Close position if exists
      const { position, markPrice } = await client.getPosition(perpId, accountInfo.accountId);

      if (position.lotLNS > 0n) {
        try {
          const perpInfo = await client.getPerpetualInfo(perpId);
          const priceDecimals = BigInt(perpInfo.priceDecimals);

          const isLong = Number(position.positionType) === 0;
          const orderType = isLong ? OrderType.CloseLong : OrderType.CloseShort;

          const currentPrice = pnsToPrice(markPrice, priceDecimals);
          const slippagePrice = isLong ? currentPrice * 0.99 : currentPrice * 1.01;

          const closeDesc: OrderDesc = {
            orderDescId: 0n,
            perpId,
            orderType,
            orderId: 0n,
            pricePNS: priceToPNS(slippagePrice, priceDecimals),
            lotLNS: position.lotLNS,
            expiryBlock: 0n,
            postOnly: false,
            fillOrKill: false,
            immediateOrCancel: true,
            maxMatches: 0n,
            leverageHdths: 100n,
            lastExecutionBlock: 0n,
            amountCNS: 0n,
          };

          await client.execOrder(closeDesc);
          positionsClosed++;
        } catch (e: any) {
          errors.push(`Failed to close ${perpName} position: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Failed to process ${perpName}: ${e.message}`);
    }
  }

  return { ordersCancelled, positionsClosed, errors };
}

/**
 * Handle close all request
 */
export async function handleCloseAll(ctx: Context, market?: Market): Promise<void> {
  try {
    const scope = market ? `${market.toUpperCase()}` : "all markets";
    await ctx.reply(`Closing everything on ${scope}...`);

    const result = await closeAll(market);

    const lines: string[] = [];
    lines.push("*Close All Complete*");
    lines.push("");
    lines.push(`Orders cancelled: ${result.ordersCancelled}`);
    lines.push(`Positions closed: ${result.positionsClosed}`);

    if (result.errors.length > 0) {
      lines.push("");
      lines.push("*Errors:*");
      for (const err of result.errors.slice(0, 5)) {
        lines.push(`\\- ${escapeMarkdown(err)}`);
      }
      if (result.errors.length > 5) {
        lines.push(`\\.\\.\\. and ${result.errors.length - 5} more`);
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
