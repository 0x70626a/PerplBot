/**
 * Deploy command handler
 * Provides instructions for users to deploy their DelegatedAccount
 */

import type { TextContext } from "../types.js";
import { getUser } from "../db/index.js";
import { escapeMarkdown } from "../formatters/telegram.js";
import { getChainConfig } from "../../sdk/config.js";

/**
 * Get implementation address from environment
 */
function getImplementationAddress(): string | null {
  return process.env.IMPLEMENTATION_ADDRESS || null;
}

/**
 * Get bot operator address from environment
 */
function getBotOperatorAddress(): string | null {
  return process.env.BOT_OPERATOR_ADDRESS || null;
}

/**
 * Handle /deploy command
 * Shows users how to deploy their DelegatedAccount
 */
export async function handleDeploy(ctx: TextContext): Promise<void> {
  const telegramId = ctx.from.id;

  // Check if user has linked wallet
  const user = getUser(telegramId);
  if (!user) {
    await ctx.reply(
      "You need to link your wallet first.\n\n" +
        "Use /link <wallet_address> to get started."
    );
    return;
  }

  // Check if user already has a delegated account set
  if (user.delegatedAccount) {
    const escapedAccount = escapeMarkdown(user.delegatedAccount);
    await ctx.reply(
      "You already have a DelegatedAccount configured:\\n\\n" +
        "\\`" + escapedAccount + "\\`\\n\\n" +
        "Use /whoami to see your account details\\.",
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  const implAddress = getImplementationAddress();
  const operatorAddress = getBotOperatorAddress();
  const chainConfig = getChainConfig();

  const escapedWallet = escapeMarkdown(user.walletAddress);
  const escapedExchange = escapeMarkdown(chainConfig.exchangeAddress);
  const escapedCollateral = escapeMarkdown(chainConfig.collateralToken);

  // Build deployment instructions
  const lines: string[] = [];
  lines.push("*Deploy Your DelegatedAccount*");
  lines.push("");
  lines.push("Your linked wallet: \\`" + escapedWallet + "\\`");
  lines.push("");
  lines.push("*Option 1: Web UI \\(Recommended\\)*");
  lines.push("Deploy at [perpl\\.xyz](https://perpl.xyz) using your wallet\\.");
  lines.push("");
  lines.push("*Option 2: CLI*");
  lines.push("Run this command with your owner private key:");
  lines.push("");
  lines.push("```bash");

  if (implAddress) {
    lines.push("OWNER_PRIVATE_KEY=<your_key> \\\\");
    lines.push("npx perplbot deploy \\\\");
    lines.push("  --implementation " + implAddress + (operatorAddress ? " \\\\" : ""));
    if (operatorAddress) {
      lines.push("  --operator " + operatorAddress);
    }
  } else {
    lines.push("OWNER_PRIVATE_KEY=<your_key> \\\\");
    lines.push("npx perplbot deploy \\\\");
    lines.push("  --implementation <IMPL_ADDRESS>" + (operatorAddress ? " \\\\" : ""));
    if (operatorAddress) {
      lines.push("  --operator " + operatorAddress);
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("*After Deployment:*");
  lines.push("1\\. Copy your DelegatedAccount address");

  if (operatorAddress) {
    const escapedOperator = escapeMarkdown(operatorAddress);
    lines.push("2\\. Ensure bot operator is added: \\`" + escapedOperator + "\\`");
  } else {
    lines.push("2\\. Add the bot as an operator");
  }

  lines.push("3\\. Run: \\`/setaccount <delegated\\_account\\_address>\\`");
  lines.push("");
  lines.push("*Contract Addresses \\(Monad Testnet\\):*");
  lines.push("• Exchange: \\`" + escapedExchange + "\\`");
  lines.push("• Collateral: \\`" + escapedCollateral + "\\`");

  if (implAddress) {
    const escapedImpl = escapeMarkdown(implAddress);
    lines.push("• Implementation: \\`" + escapedImpl + "\\`");
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Handle /contracts command
 * Shows all relevant contract addresses
 */
export async function handleContracts(ctx: TextContext): Promise<void> {
  const chainConfig = getChainConfig();
  const implAddress = getImplementationAddress();
  const operatorAddress = getBotOperatorAddress();

  const escapedExchange = escapeMarkdown(chainConfig.exchangeAddress);
  const escapedCollateral = escapeMarkdown(chainConfig.collateralToken);

  const lines: string[] = [];
  lines.push("*Contract Addresses \\(Monad Testnet\\)*");
  lines.push("");
  lines.push("Exchange: \\`" + escapedExchange + "\\`");
  lines.push("Collateral \\(USD\\): \\`" + escapedCollateral + "\\`");

  if (implAddress) {
    const escapedImpl = escapeMarkdown(implAddress);
    lines.push("DelegatedAccount Impl: \\`" + escapedImpl + "\\`");
  }

  if (operatorAddress) {
    const escapedOperator = escapeMarkdown(operatorAddress);
    lines.push("Bot Operator: \\`" + escapedOperator + "\\`");
  }

  lines.push("");
  lines.push("Chain ID: 10143");

  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
}
