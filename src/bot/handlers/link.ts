/**
 * Wallet linking handlers
 * Implements /link and /verify commands for connecting Telegram users to wallets
 */

import type { TextContext } from "../types.js";
import {
  generateNonce,
  formatLinkMessage,
  verifyWalletSignature,
  validateAddress,
  LINK_EXPIRY_MS,
} from "../crypto.js";
import {
  createLinkRequest,
  getLinkRequest,
  deleteLinkRequest,
  createUser,
  getUser,
  getUserByWallet,
} from "../db/index.js";
import { escapeMarkdown } from "../formatters/telegram.js";

/**
 * Get bot operator address from environment
 */
function getBotOperatorAddress(): string {
  const address = process.env.BOT_OPERATOR_ADDRESS;
  if (!address) {
    throw new Error("BOT_OPERATOR_ADDRESS not configured");
  }
  return address;
}

/**
 * Handle /link <wallet_address> command
 * Starts the wallet linking flow by generating a nonce and message to sign
 */
export async function handleLink(ctx: TextContext): Promise<void> {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;

  // Parse wallet address from command
  const parts = text.split(/\s+/);
  const walletInput = parts[1];

  if (!walletInput) {
    await ctx.reply(
      "Usage: /link <wallet_address>\n\n" +
        "Example: /link 0x1234...abcd\n\n" +
        "This will link your Telegram account to your Ethereum wallet."
    );
    return;
  }

  // Validate address format
  const walletAddress = validateAddress(walletInput);
  if (!walletAddress) {
    await ctx.reply(
      "Invalid wallet address format.\n\n" +
        "Please provide a valid Ethereum address starting with 0x."
    );
    return;
  }

  // Check if user already has a linked wallet
  const existingUser = getUser(telegramId);
  if (existingUser) {
    await ctx.reply(
      `You already have a linked wallet: \`${existingUser.walletAddress}\`\n\n` +
        "Use /unlink to remove it first, then /link to add a new one.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Check if wallet is already linked to another user
  const walletOwner = getUserByWallet(walletAddress);
  if (walletOwner) {
    await ctx.reply(
      "This wallet is already linked to another Telegram account.\n\n" +
        "Each wallet can only be linked to one account."
    );
    return;
  }

  // Generate nonce and create link request
  const nonce = generateNonce();
  const timestamp = new Date().toISOString();
  const message = formatLinkMessage(telegramId, nonce, timestamp);
  const expiresAt = new Date(Date.now() + LINK_EXPIRY_MS);

  createLinkRequest({
    telegramId,
    nonce,
    walletAddress,
    timestamp,
    expiresAt,
  });

  // Send signing instructions
  const escapedMessage = escapeMarkdown(message);
  const escapedAddress = escapeMarkdown(walletAddress);

  await ctx.reply(
    `To link wallet \`${escapedAddress}\`, sign this message:\n\n` +
      "```\n" +
      escapedMessage +
      "\n```\n\n" +
      "Then reply with: `/verify <signature>`\n\n" +
      "_This request expires in 30 minutes\\._",
    { parse_mode: "MarkdownV2" }
  );
}

/**
 * Handle /verify <signature> command
 * Completes wallet linking by verifying the signature
 */
export async function handleVerify(ctx: TextContext): Promise<void> {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;

  // Parse signature from command
  const parts = text.split(/\s+/);
  const signature = parts[1];

  if (!signature) {
    await ctx.reply(
      "Usage: /verify <signature>\n\n" +
        "Paste the signature you got from signing the message in your wallet."
    );
    return;
  }

  // Get pending link request
  const request = getLinkRequest(telegramId);
  if (!request) {
    await ctx.reply(
      "No pending link request found.\n\n" +
        "Use /link <wallet_address> to start the linking process."
    );
    return;
  }

  // Check if request has expired
  if (request.expiresAt < new Date()) {
    deleteLinkRequest(telegramId);
    await ctx.reply(
      "Link request has expired.\n\n" +
        "Please use /link <wallet_address> to start again."
    );
    return;
  }

  // Reconstruct the message and verify signature (using stored timestamp)
  const message = formatLinkMessage(telegramId, request.nonce, request.timestamp);
  const result = await verifyWalletSignature(
    message,
    signature,
    request.walletAddress
  );

  if (!result.valid) {
    await ctx.reply(
      "Signature verification failed.\n\n" +
        `Error: ${result.error}\n\n` +
        "Please make sure you signed the exact message shown and try again."
    );
    return;
  }

  // Clean up link request
  deleteLinkRequest(telegramId);

  // Create user record
  createUser({
    telegramId,
    walletAddress: request.walletAddress,
    isActive: true,
    isBanned: false,
  });

  // Get bot operator address for instructions
  let operatorAddress: string;
  try {
    operatorAddress = getBotOperatorAddress();
  } catch {
    operatorAddress = "<BOT_OPERATOR_ADDRESS not configured>";
  }

  const escapedWallet = escapeMarkdown(request.walletAddress);
  const escapedOperator = escapeMarkdown(operatorAddress);

  await ctx.reply(
    `Wallet linked successfully\\!\n\n` +
      `Wallet: \`${escapedWallet}\`\n\n` +
      "*Next steps:*\n" +
      "1\\. Deploy a DelegatedAccount at perpl\\.xyz\n" +
      `2\\. Add bot operator: \`${escapedOperator}\`\n` +
      "3\\. Run: `/setaccount <delegated_account_address>`\n\n" +
      "_The bot operator can trade on your behalf but cannot withdraw funds\\._",
    { parse_mode: "MarkdownV2" }
  );
}
