/**
 * Account handlers - DelegatedAccount setup and management
 * /setaccount - Set DelegatedAccount address
 * /whoami - Show linked wallet and account status
 * /unlink - Remove wallet link
 */

import type { TextContext, BotContext } from "../types.js";
import { validateAddress } from "../crypto.js";
import {
  getUser,
  updateUser,
  deleteUser,
  deleteLinkRequest,
} from "../db/index.js";
import { verifyOperatorStatus } from "../client.js";
import { escapeMarkdown } from "../formatters/telegram.js";

/**
 * Handle /setaccount <delegated_account_address> command
 * Sets the DelegatedAccount address for trading
 */
export async function handleSetAccount(ctx: TextContext): Promise<void> {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;

  // Parse address from command
  const parts = text.split(/\s+/);
  const addressInput = parts[1];

  if (!addressInput) {
    await ctx.reply(
      "Usage: /setaccount <delegated_account_address>\n\n" +
        "This sets your DelegatedAccount for trading.\n" +
        "The bot operator must be added as an operator on this account."
    );
    return;
  }

  // Validate address format
  const delegatedAccount = validateAddress(addressInput);
  if (!delegatedAccount) {
    await ctx.reply(
      "Invalid address format.\n\n" +
        "Please provide a valid Ethereum address starting with 0x."
    );
    return;
  }

  // Check if user exists
  const user = getUser(telegramId);
  if (!user) {
    await ctx.reply(
      "Please link your wallet first.\n\n" +
        "Use: /link <your_wallet_address>"
    );
    return;
  }

  // Verify bot is operator on this account
  const isOperator = await verifyOperatorStatus(delegatedAccount);
  const operatorAddr = process.env.BOT_OPERATOR_ADDRESS || "unknown";

  if (!isOperator) {
    const escapedOperator = escapeMarkdown(operatorAddr);
    const escapedAccount = escapeMarkdown(delegatedAccount);

    await ctx.reply(
      `Bot is not authorized on this account\\.\n\n` +
        `DelegatedAccount: \`${escapedAccount}\`\n\n` +
        `Please add the bot operator:\n` +
        `\`${escapedOperator}\`\n\n` +
        `Then run /setaccount again\\.`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // Update user with delegated account
  updateUser(telegramId, { delegatedAccount });

  const escapedAccount = escapeMarkdown(delegatedAccount);

  await ctx.reply(
    `DelegatedAccount set successfully\\!\n\n` +
      `Account: \`${escapedAccount}\`\n\n` +
      `You can now trade using natural language or /status to check your positions\\.`,
    { parse_mode: "MarkdownV2" }
  );
}

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

  if (user.delegatedAccount) {
    lines.push(`DelegatedAccount: \`${escapeMarkdown(user.delegatedAccount)}\``);

    // Check operator status
    const isOperator = await verifyOperatorStatus(user.delegatedAccount);
    lines.push(`Bot authorized: ${isOperator ? "Yes" : "No"}`);
  } else {
    lines.push("");
    lines.push("_No DelegatedAccount set\\._");
    lines.push("Use /setaccount to complete setup\\.");
  }

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
