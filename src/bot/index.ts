/**
 * PerplBot Telegram Bot
 * Entry point - initializes bot, registers handlers, starts polling
 */

import "dotenv/config";
import { Telegraf } from "telegraf";
import { loadBotConfig, authMiddleware } from "./config.js";
import { handleStatus } from "./handlers/status.js";
import { handleMarkets } from "./handlers/markets.js";
import { handleTradeConfirm, handleTradeCancel } from "./handlers/trade.js";
import { handleMessage } from "./handlers/message.js";
import { formatWelcome, formatHelp } from "./formatters/telegram.js";

async function main() {
  console.log("Starting PerplBot...");

  // Load configuration
  const config = loadBotConfig();
  console.log(`Authorized user ID: ${config.allowedUserId}`);

  // Initialize bot
  const bot = new Telegraf(config.token);

  // Add auth middleware - rejects messages from unauthorized users
  bot.use(authMiddleware(config.allowedUserId));

  // Register command handlers
  bot.command("start", async (ctx) => {
    await ctx.reply(formatWelcome(), { parse_mode: "MarkdownV2" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(formatHelp(), { parse_mode: "MarkdownV2" });
  });

  bot.command("status", handleStatus);
  bot.command("markets", handleMarkets);

  // Register callback query handlers for trade confirmation
  bot.action("trade_confirm", handleTradeConfirm);
  bot.action("trade_cancel", handleTradeCancel);

  // Register message handler for natural language (must be last)
  bot.on("text", handleMessage);

  // Error handling
  bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
  });

  // Start bot
  console.log("Bot starting...");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  await bot.launch();
  console.log("PerplBot is running!");
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
