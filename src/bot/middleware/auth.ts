/**
 * Authentication middleware for multi-user bot
 *
 * Handles authorization and attaches user data to context.
 */

import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../types.js";
import { getUser, isUserBanned, initDatabase } from "../db/index.js";

/**
 * Commands that don't require a linked wallet
 */
const OPEN_COMMANDS = ["/start", "/link", "/verify", "/help"];

/**
 * Commands that require a linked wallet but not a delegated account
 */
const LINKED_COMMANDS = ["/whoami", "/unlink", "/setaccount"];

/**
 * Commands that require both linked wallet AND delegated account
 */
const ACCOUNT_COMMANDS = [
  "/status",
  "/markets",
  "/trade",
  "/cancel",
  "/close",
];

/**
 * Check if a message is an open command (no auth required)
 */
function isOpenCommand(text: string | undefined): boolean {
  if (!text) return false;
  return OPEN_COMMANDS.some((cmd) => text.startsWith(cmd));
}

/**
 * Check if a message is a linked-only command (requires wallet but not account)
 */
function isLinkedCommand(text: string | undefined): boolean {
  if (!text) return false;
  return LINKED_COMMANDS.some((cmd) => text.startsWith(cmd));
}

/**
 * Multi-user authentication middleware
 *
 * Flow:
 * 1. Open commands (/start, /link, /verify, /help) - allow anyone
 * 2. Linked commands (/whoami, /setaccount) - require linked wallet
 * 3. Account commands (/status, /trade, etc.) - require wallet + delegated account
 * 4. Natural language - require wallet + delegated account
 */
export function multiUserAuthMiddleware(): MiddlewareFn<BotContext> {
  // Initialize database on first use
  initDatabase();

  return async (ctx, next) => {
    const userId = ctx.from?.id;

    // No user ID - reject silently
    if (!userId) {
      console.log("[AUTH] Rejected message with no user ID");
      return;
    }

    // Check if user is banned
    if (isUserBanned(userId)) {
      console.log(`[AUTH] Banned user attempted access: ${userId}`);
      await ctx.reply("Your account has been suspended.");
      return;
    }

    // Get message text (for commands)
    const messageText =
      "text" in (ctx.message || {})
        ? (ctx.message as { text: string }).text
        : undefined;

    // Open commands - allow anyone
    if (isOpenCommand(messageText)) {
      return next();
    }

    // All other commands require a linked wallet
    const user = getUser(userId);

    if (!user) {
      await ctx.reply(
        "Please link your wallet first.\n\n" +
          "Use: /link <your_wallet_address>"
      );
      return;
    }

    if (!user.isActive) {
      await ctx.reply(
        "Your account is deactivated.\n\n" +
          "Use /link to set up a new wallet."
      );
      return;
    }

    // Attach user to context
    ctx.user = user;

    // Linked-only commands - allow with wallet
    if (isLinkedCommand(messageText)) {
      return next();
    }

    // Account commands and natural language require delegated account
    if (!user.delegatedAccount) {
      await ctx.reply(
        "Please set your DelegatedAccount first.\n\n" +
          "Use: /setaccount <delegated_account_address>\n\n" +
          "Need to deploy one? Visit perpl.xyz"
      );
      return;
    }

    return next();
  };
}

/**
 * Rate limiting state per user
 */
interface RateLimitState {
  trades: number[];
  queries: number[];
}

const rateLimitMap = new Map<number, RateLimitState>();

/**
 * Rate limits
 */
const TRADE_LIMIT = 10; // trades per minute
const QUERY_LIMIT = 60; // queries per minute
const WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Rate limiting middleware
 * Limits trades and queries per user per minute
 */
export function rateLimitMiddleware(): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    let state = rateLimitMap.get(userId);

    if (!state) {
      state = { trades: [], queries: [] };
      rateLimitMap.set(userId, state);
    }

    // Clean old entries
    state.trades = state.trades.filter((t) => now - t < WINDOW_MS);
    state.queries = state.queries.filter((t) => now - t < WINDOW_MS);

    // Check rate limits (trades are checked in trade handler)
    if (state.queries.length >= QUERY_LIMIT) {
      await ctx.reply(
        "Rate limit exceeded. Please wait a minute before trying again."
      );
      return;
    }

    // Record query
    state.queries.push(now);

    return next();
  };
}

/**
 * Check if user can make a trade (rate limited)
 * Call this before executing trades
 */
export function canMakeTrade(userId: number): boolean {
  const now = Date.now();
  let state = rateLimitMap.get(userId);

  if (!state) {
    state = { trades: [], queries: [] };
    rateLimitMap.set(userId, state);
  }

  // Clean old entries
  state.trades = state.trades.filter((t) => now - t < WINDOW_MS);

  return state.trades.length < TRADE_LIMIT;
}

/**
 * Record a trade for rate limiting
 */
export function recordTrade(userId: number): void {
  const now = Date.now();
  let state = rateLimitMap.get(userId);

  if (!state) {
    state = { trades: [], queries: [] };
    rateLimitMap.set(userId, state);
  }

  state.trades.push(now);
}
