/**
 * PerplBot Telegram Bot
 * Entry point - initializes bot, registers handlers, starts polling
 */

import "dotenv/config";
import { Telegraf } from "telegraf";
import { loadBotConfig, authMiddleware } from "./config.js";
import {
  multiUserAuthMiddleware,
  rateLimitMiddleware,
} from "./middleware/auth.js";
import { handleStatus } from "./handlers/status.js";
import { handleMarkets } from "./handlers/markets.js";
import { handleTradeConfirm, handleTradeCancel } from "./handlers/trade.js";
import { handleMessage } from "./handlers/message.js";
import { handleLink, handleVerify } from "./handlers/link.js";
import { handleSetAccount, handleWhoami, handleUnlink } from "./handlers/account.js";
import { handleDeploy, handleContracts } from "./handlers/deploy.js";
import { formatWelcome, formatHelp } from "./formatters/telegram.js";
import { initDatabase, cleanupExpiredRequests } from "./db/index.js";
import type { BotContext } from "./types.js";

async function main() {
  console.log("Starting PerplBot...");

  // Load configuration
  const config = loadBotConfig();

  // Initialize database if in multi-user mode
  if (config.multiUser) {
    console.log("[BOT] Initializing database...");
    initDatabase();
    const cleaned = cleanupExpiredRequests();
    if (cleaned > 0) {
      console.log(`[BOT] Cleaned up ${cleaned} expired link requests`);
    }
  }

  // Initialize bot with extended context
  const bot = new Telegraf<BotContext>(config.token);

  // Add auth middleware based on mode
  if (config.multiUser) {
    console.log("[BOT] Multi-user mode");
    bot.use(rateLimitMiddleware());
    bot.use(multiUserAuthMiddleware());
  } else if (config.allowedUserId) {
    console.log(`[BOT] Single-user mode, authorized user: ${config.allowedUserId}`);
    bot.use(authMiddleware(config.allowedUserId));
  }

  // Register command handlers
  bot.command("start", async (ctx) => {
    await ctx.reply(formatWelcome(), { parse_mode: "MarkdownV2" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(formatHelp(), { parse_mode: "MarkdownV2" });
  });

  // Multi-user commands (wallet linking)
  bot.command("link", handleLink);
  bot.command("verify", handleVerify);

  // Account management commands
  bot.command("setaccount", handleSetAccount);
  bot.command("whoami", handleWhoami);
  bot.command("unlink", handleUnlink);

  // Deployment commands
  bot.command("deploy", handleDeploy);
  bot.command("contracts", handleContracts);

  // Trading commands
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
