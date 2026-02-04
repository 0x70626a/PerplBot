/**
 * Message handler - Natural language processing
 * Catches all non-command messages and routes through parseCommand()
 */

import type { BotContext } from "../types.js";
import { parseCommand } from "../../cli/tradeParser.js";
import { handleStatus } from "./status.js";
import { handleMarkets } from "./markets.js";
import { showTradeConfirmation } from "./trade.js";
import { handleOrderBook, handleRecentTrades } from "./show.js";
import { handleCancelOrder, handleCancelAll, handleOpenOrders } from "./cancel.js";
import { handleClosePosition, handleCloseAll } from "./close.js";
import { formatError, formatHelp } from "../formatters/telegram.js";

/**
 * Handle natural language messages
 */
export async function handleMessage(ctx: BotContext): Promise<void> {
  const message = ctx.message;
  if (!message || !("text" in message)) return;

  const text = message.text;

  // Skip if it looks like a command
  if (text.startsWith("/")) return;

  console.log(`[MSG] "${text}"`);

  const result = parseCommand(text);

  if (!result.success) {
    // If parsing failed, send error message
    const errorMsg = result.error || "Could not understand that command";
    console.log(`[FAIL] ${errorMsg}`);
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
    return;
  }

  console.log(`[OK] type=${result.parsed?.type || "trade"}, command=${result.command}`);

  // Route based on command type
  if (result.parsed) {
    switch (result.parsed.type) {
      case "status":
        await handleStatus(ctx);
        break;

      case "markets":
        await handleMarkets(ctx);
        break;

      case "book":
        if (result.parsed.market) {
          await handleOrderBook(ctx, result.parsed.market);
        }
        break;

      case "trades":
        if (result.parsed.market) {
          await handleRecentTrades(ctx, result.parsed.market);
        }
        break;

      case "deposit":
        await ctx.reply(
          "Deposits require CLI for safety\\.\nUse: `manage deposit \\-\\-amount " +
            result.parsed.amount +
            "`",
          { parse_mode: "MarkdownV2" }
        );
        break;

      case "withdraw":
        await ctx.reply(
          "Withdrawals require CLI for safety\\.\nUse: `manage withdraw \\-\\-amount " +
            result.parsed.amount +
            "`",
          { parse_mode: "MarkdownV2" }
        );
        break;

      case "cancel":
        if (result.parsed.market && result.parsed.orderId) {
          await handleCancelOrder(ctx, result.parsed.market, result.parsed.orderId);
        }
        break;

      case "cancel-all":
        if (result.parsed.market) {
          await handleCancelAll(ctx, result.parsed.market);
        }
        break;

      case "close-position":
        if (result.parsed.market) {
          await handleClosePosition(ctx, result.parsed.market);
        }
        break;

      case "close-all":
        await handleCloseAll(ctx, result.parsed.market);
        break;

      case "orders":
        if (result.parsed.market) {
          await handleOpenOrders(ctx, result.parsed.market);
        }
        break;

      case "help":
        await ctx.reply(formatHelp(), { parse_mode: "MarkdownV2" });
        break;

      case "trade":
        // Trade command - show confirmation
        if (result.trade) {
          await showTradeConfirmation(ctx, result.trade);
        }
        break;

      default:
        await ctx.reply(formatError("Unknown command type"), {
          parse_mode: "MarkdownV2",
        });
    }
  } else if (result.trade) {
    // Direct trade from parseTrade
    await showTradeConfirmation(ctx, result.trade);
  }
}
