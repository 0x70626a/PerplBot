/**
 * Telegram bot configuration
 */

import type { Context, MiddlewareFn } from "telegraf";
import { privateKeyToAddress } from "viem/accounts";

/**
 * Bot configuration from environment
 */
export interface BotConfig {
  token: string;
  /** Single allowed user ID (legacy mode, optional) */
  allowedUserId?: number;
  /** Multi-user mode enabled */
  multiUser: boolean;
  /** Bot operator private key (for trading on users' accounts) */
  operatorPrivateKey?: `0x${string}`;
  /** Bot operator address (derived from private key) */
  operatorAddress?: `0x${string}`;
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

  // Multi-user mode - requires BOT_OPERATOR_PRIVATE_KEY
  let operatorPrivateKey: `0x${string}` | undefined;
  let operatorAddress: `0x${string}` | undefined;

  if (multiUser) {
    const opKey = process.env.BOT_OPERATOR_PRIVATE_KEY;
    if (!opKey) {
      throw new Error(
        "BOT_OPERATOR_PRIVATE_KEY is required for multi-user mode"
      );
    }

    operatorPrivateKey = opKey.startsWith("0x")
      ? (opKey as `0x${string}`)
      : (`0x${opKey}` as `0x${string}`);

    operatorAddress = privateKeyToAddress(operatorPrivateKey);

    // Also set BOT_OPERATOR_ADDRESS for convenience
    process.env.BOT_OPERATOR_ADDRESS = operatorAddress;

    console.log(`[CONFIG] Multi-user mode enabled`);
    console.log(`[CONFIG] Bot operator address: ${operatorAddress}`);
  }

  return {
    token,
    allowedUserId,
    multiUser,
    operatorPrivateKey,
    operatorAddress,
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
