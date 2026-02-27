/**
 * Telegram bot configuration
 */

import type { Context, MiddlewareFn } from "telegraf";

/**
 * Bot configuration from environment
 */
export interface BotConfig {
  token: string;
  /** Single allowed user ID (legacy mode, optional) */
  allowedUserId?: number;
  /** Multi-user mode enabled */
  multiUser: boolean;
}

/**
 * Load bot configuration from environment variables
 * Supports both single-user (legacy) and multi-user modes
 */
export function loadBotConfig(): BotConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  // Check for multi-user mode
  const multiUser = process.env.MULTI_USER_MODE === "true";

  // Single-user mode (legacy) - requires TELEGRAM_USER_ID
  const userIdStr = process.env.TELEGRAM_USER_ID;
  let allowedUserId: number | undefined;

  if (userIdStr) {
    allowedUserId = parseInt(userIdStr, 10);
    if (isNaN(allowedUserId)) {
      throw new Error("TELEGRAM_USER_ID must be a valid number");
    }
  } else if (!multiUser) {
    throw new Error(
      "Either TELEGRAM_USER_ID (single-user) or MULTI_USER_MODE=true (multi-user) is required"
    );
  }

  if (multiUser) {
    console.log(`[CONFIG] Multi-user mode enabled`);
  }

  return {
    token,
    allowedUserId,
    multiUser,
  };
}

/**
 * Legacy single-user auth middleware
 * Rejects messages from users other than the configured allowedUserId
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
