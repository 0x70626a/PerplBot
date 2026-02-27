/**
 * Bot type definitions for multi-user support
 */

import type { Context, NarrowedContext } from "telegraf";
import type { CallbackQuery, Message, Update } from "telegraf/types";
import type { User } from "./db/schema.js";

/**
 * Extended bot context with user data attached by auth middleware
 */
export interface BotContext extends Context {
  /**
   * User data from database (attached by auth middleware for protected commands)
   * Undefined for open commands like /start, /link, /help
   */
  user?: User;
}

/**
 * Context for text message handlers
 */
export type TextContext = NarrowedContext<
  BotContext,
  Update.MessageUpdate<Message.TextMessage>
>;

/**
 * Context for callback query handlers (button clicks)
 */
export type CallbackContext = NarrowedContext<
  BotContext,
  Update.CallbackQueryUpdate<CallbackQuery>
>;

