/**
 * Account handlers - Wallet management
 * /whoami - Show linked wallet and account status
 * /unlink - Remove wallet link
 */

import type { TextContext, BotContext } from "../types.js";
import {
  getUser,
  deleteUser,
  deleteLinkRequest,
} from "../db/index.js";
import { escapeMarkdown } from "../formatters/telegram.js";

/**
 * Handle /whoami command
 * Shows linked wallet and account status
 */
export async function handleWhoami(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = getUser(telegramId);

  if (!user) {
    await ctx.reply(
      "No wallet linked.\n\n" +
        "Use /link <wallet_address> to get started."
    );
    return;
  }

  const lines: string[] = [];
  lines.push("*Your PerplBot Account*");
  lines.push("");
  lines.push(`Telegram ID: \`${telegramId}\``);
  lines.push(`Wallet: \`${escapeMarkdown(user.walletAddress)}\``);
  lines.push("");
  lines.push(`Linked: ${escapeMarkdown(user.linkedAt.toISOString().split("T")[0])}`);
  lines.push(`Status: ${user.isActive ? "Active" : "Inactive"}`);

  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
}

/**
 * Handle /unlink command
 * Removes wallet link (requires confirmation)
 */
export async function handleUnlink(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = getUser(telegramId);

  if (!user) {
    await ctx.reply("No wallet is currently linked.");
    return;
  }

  // Check if user typed "/unlink confirm"
  const text = "text" in (ctx.message || {})
    ? (ctx.message as { text: string }).text
    : "";
  const parts = text.split(/\s+/);

  if (parts[1] !== "confirm") {
    const escapedWallet = escapeMarkdown(user.walletAddress);

    await ctx.reply(
      `*Warning: This will unlink your wallet*\n\n` +
        `Wallet: \`${escapedWallet}\`\n\n` +
        `You will need to re\\-link and verify ownership to use the bot again\\.\n\n` +
        `To confirm, type: /unlink confirm`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // Delete link request if any
  deleteLinkRequest(telegramId);

  // Delete user
  deleteUser(telegramId);

  await ctx.reply(
    "Wallet unlinked successfully.\n\n" +
      "Use /link <wallet_address> to link a new wallet."
  );
}
