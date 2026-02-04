/**
 * Status handler - /status command
 * Shows account balance and positions
 *
 * Supports both single-user (owner wallet) and multi-user (delegated account) modes.
 */

import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import type { BotContext, TextContext } from "../types.js";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
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
import { createHybridClient, createHybridClientForUser } from "../client.js";

/**
 * Fetch account status data for owner (single-user mode)
 */
export async function fetchAccountStatus(): Promise<{
  account: AccountStatus | null;
  positions: PositionData[];
}> {
  const config = loadEnvConfig();
  validateOwnerConfig(config);

  const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);

  console.log("[STATUS] Creating HybridClient...");
  const client = await createHybridClient({ withWalletClient: true });

  // Try to get account
  let accountInfo;
  try {
    accountInfo = await client.getAccountByAddress(owner.address);
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
 * Fetch account status for a specific user (multi-user mode)
 */
export async function fetchUserAccountStatus(
  delegatedAccountAddress: string
): Promise<{
  account: AccountStatus | null;
  positions: PositionData[];
}> {
  const config = loadEnvConfig();

  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Create client for reading (doesn't need wallet client for reads)
  const client = await createHybridClient({ withWalletClient: false });

  // Try to get account by delegated account address
  let accountInfo;
  try {
    accountInfo = await client.getAccountByAddress(delegatedAccountAddress as Address);
  } catch {
    return {
      account: {
        address: delegatedAccountAddress,
        accountId: 0n,
        balance: 0,
        locked: 0,
        available: 0,
        walletEth: 0,
        walletUsdc: 0,
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

  // Get wallet balances (for delegated account, this is the contract balance)
  const tokenBalance = await publicClient.readContract({
    address: config.chain.collateralToken as Address,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [delegatedAccountAddress as Address],
  });

  return {
    account: {
      address: delegatedAccountAddress,
      accountId: accountInfo.accountId,
      balance: Number(accountInfo.balanceCNS) / 1e6,
      locked: Number(accountInfo.lockedBalanceCNS) / 1e6,
      available: Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6,
      walletEth: 0, // Delegated accounts don't hold ETH
      walletUsdc: Number(tokenBalance) / 1e6,
    },
    positions,
  };
}

/**
 * Handle /status command
 * Supports both single-user and multi-user modes
 */
export async function handleStatus(ctx: BotContext): Promise<void> {
  try {
    await ctx.reply("Fetching account status...");

    let account: AccountStatus | null;
    let positions: PositionData[];

    // Check if we're in multi-user mode (user attached by middleware)
    if (ctx.user?.delegatedAccount) {
      console.log(`[STATUS] Multi-user mode for user ${ctx.user.telegramId}`);
      const result = await fetchUserAccountStatus(ctx.user.delegatedAccount);
      account = result.account;
      positions = result.positions;
    } else {
      // Single-user mode (owner wallet)
      console.log("[STATUS] Single-user mode");
      const result = await fetchAccountStatus();
      account = result.account;
      positions = result.positions;
    }

    const message = formatStatus(account, positions);
    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error occurred";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
