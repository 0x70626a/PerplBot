/**
 * Status handler - /status command
 * Shows account balance and positions
 */

import type { BotContext, TextContext } from "../types.js";
import {
  loadEnvConfig,
  validateConfig,
  Wallet,
  PERPETUALS,
  pnsToPrice,
  lnsToLot,
} from "../../sdk/index.js";
import {
  formatStatus,
  formatError,
  type AccountStatus,
  type PositionData,
} from "../formatters/telegram.js";
import { createHybridClient } from "../client.js";

/**
 * Fetch account status data
 */
export async function fetchAccountStatus(): Promise<{
  account: AccountStatus | null;
  positions: PositionData[];
}> {
  const config = loadEnvConfig();
  validateConfig(config);

  const wallet = Wallet.fromPrivateKey(config.privateKey, config.chain);

  console.log("[STATUS] Creating HybridClient...");
  const client = await createHybridClient({ withWalletClient: true });

  // Try to get account
  let accountInfo;
  try {
    accountInfo = await client.getAccountByAddress(wallet.address);
  } catch {
    // No account found
    const ethBalance = await wallet.getEthBalance();
    const tokenBalance = await wallet.getTokenBalance(config.chain.collateralToken);

    return {
      account: {
        address: wallet.address,
        accountId: 0n,
        balance: 0,
        locked: 0,
        available: 0,
        walletEth: Number(ethBalance) / 1e18,
        walletUsdc: Number(tokenBalance) / 1e6,
      },
      positions: [],
    };
  }

  if (accountInfo.accountId === 0n) {
    return {
      account: null,
      positions: [],
    };
  }

  // Fetch positions
  const positions: PositionData[] = [];

  for (const [name, perpId] of Object.entries(PERPETUALS)) {
    const { position, markPrice } = await client.getPosition(
      perpId,
      accountInfo.accountId
    );

    if (position.lotLNS > 0n) {
      const perpInfo = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      const size = lnsToLot(position.lotLNS, lotDecimals);
      const entryPrice = pnsToPrice(position.pricePNS, priceDecimals);
      const currentPrice = pnsToPrice(markPrice, priceDecimals);
      const pnl = Number(position.pnlCNS) / 1e6;

      const posType = Number(position.positionType) === 0 ? "LONG" : "SHORT";

      positions.push({
        symbol: name,
        type: posType,
        size,
        entryPrice,
        markPrice: currentPrice,
        pnl,
      });
    }
  }

  // Get wallet balances
  const ethBalance = await wallet.getEthBalance();
  const tokenBalance = await wallet.getTokenBalance(config.chain.collateralToken);

  return {
    account: {
      address: wallet.address,
      accountId: accountInfo.accountId,
      balance: Number(accountInfo.balanceCNS) / 1e6,
      locked: Number(accountInfo.lockedBalanceCNS) / 1e6,
      available: Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6,
      walletEth: Number(ethBalance) / 1e18,
      walletUsdc: Number(tokenBalance) / 1e6,
    },
    positions,
  };
}

/**
 * Handle /status command
 */
export async function handleStatus(ctx: BotContext): Promise<void> {
  try {
    await ctx.reply("Fetching account status...");

    const result = await fetchAccountStatus();
    const message = formatStatus(result.account, result.positions);
    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error occurred";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
