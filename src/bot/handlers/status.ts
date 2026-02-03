/**
 * Status handler - /status command
 * Shows account balance and positions
 */

import type { Context } from "telegraf";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  Exchange,
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

/**
 * Fetch account status data
 */
export async function fetchAccountStatus(): Promise<{
  account: AccountStatus | null;
  positions: PositionData[];
}> {
  const config = loadEnvConfig();
  validateOwnerConfig(config);

  const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

  const exchange = new Exchange(
    config.chain.exchangeAddress,
    owner.publicClient,
    owner.walletClient
  );

  // Try to get account
  let accountInfo;
  try {
    accountInfo = await exchange.getAccountByAddress(owner.address);
  } catch {
    // No account found
    const ownerEthBalance = await owner.getEthBalance();
    const ownerTokenBalance = await owner.getTokenBalance(config.chain.collateralToken);

    return {
      account: {
        address: owner.address,
        accountId: 0n,
        balance: 0,
        locked: 0,
        available: 0,
        walletEth: Number(ownerEthBalance) / 1e18,
        walletUsdc: Number(ownerTokenBalance) / 1e6,
      },
      positions: [],
    };
  }

  if (accountInfo.accountId === 0n) {
    const ownerEthBalance = await owner.getEthBalance();
    const ownerTokenBalance = await owner.getTokenBalance(config.chain.collateralToken);

    return {
      account: null,
      positions: [],
    };
  }

  // Fetch positions
  const positions: PositionData[] = [];

  for (const [name, perpId] of Object.entries(PERPETUALS)) {
    const { position, markPrice } = await exchange.getPosition(
      perpId,
      accountInfo.accountId
    );

    if (position.lotLNS > 0n) {
      const perpInfo = await exchange.getPerpetualInfo(perpId);
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
  const ownerEthBalance = await owner.getEthBalance();
  const ownerTokenBalance = await owner.getTokenBalance(config.chain.collateralToken);

  return {
    account: {
      address: owner.address,
      accountId: accountInfo.accountId,
      balance: Number(accountInfo.balanceCNS) / 1e6,
      locked: Number(accountInfo.lockedBalanceCNS) / 1e6,
      available: Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6,
      walletEth: Number(ownerEthBalance) / 1e18,
      walletUsdc: Number(ownerTokenBalance) / 1e6,
    },
    positions,
  };
}

/**
 * Handle /status command
 */
export async function handleStatus(ctx: Context): Promise<void> {
  try {
    await ctx.reply("Fetching account status...");

    const { account, positions } = await fetchAccountStatus();
    const message = formatStatus(account, positions);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error occurred";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
