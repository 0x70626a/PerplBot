/**
 * Contract info handler
 * Shows relevant contract addresses
 */

import type { TextContext } from "../types.js";
import { escapeMarkdown } from "../formatters/telegram.js";
import { getChainConfig } from "../../sdk/config.js";

/**
 * Handle /contracts command
 * Shows all relevant contract addresses
 */
export async function handleContracts(ctx: TextContext): Promise<void> {
  const chainConfig = getChainConfig();

  const escapedExchange = escapeMarkdown(chainConfig.exchangeAddress);
  const escapedCollateral = escapeMarkdown(chainConfig.collateralToken);

  const lines: string[] = [];
  lines.push("*Contract Addresses \\(Monad Testnet\\)*");
  lines.push("");
  lines.push("Exchange: \\`" + escapedExchange + "\\`");
  lines.push("Collateral \\(USD\\): \\`" + escapedCollateral + "\\`");
  lines.push("");
  lines.push("Chain ID: 10143");

  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
}
