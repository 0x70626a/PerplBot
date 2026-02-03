/**
 * Telegram bot configuration
 */

import type { Context, MiddlewareFn } from "telegraf";

/**
 * Bot configuration from environment
 */
export interface BotConfig {
  token: string;
  allowedUserId: number;
}

/**
 * Load bot configuration from environment variables
 * Throws if required variables are missing
 */
export function loadBotConfig(): BotConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  const userIdStr = process.env.TELEGRAM_USER_ID;
  if (!userIdStr) {
    throw new Error("TELEGRAM_USER_ID environment variable is required");
  }

  const allowedUserId = parseInt(userIdStr, 10);
  if (isNaN(allowedUserId)) {
    throw new Error("TELEGRAM_USER_ID must be a valid number");
  }

  return { token, allowedUserId };
}

/**
 * Middleware to reject messages from unauthorized users
 */
export function authMiddleware(allowedUserId: number): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId) {
      console.log("Rejected message with no user ID");
      return;
    }

    if (userId !== allowedUserId) {
      console.log(`Rejected message from unauthorized user: ${userId}`);
      await ctx.reply("Unauthorized. This bot is private.");
      return;
    }

    return next();
  };
}
