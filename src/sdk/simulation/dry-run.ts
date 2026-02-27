/**
 * Core dry-run simulation logic
 *
 * Hybrid approach:
 *   1. Always run simulateContract() (eth_call) for basic pass/fail + return value
 *   2. If Anvil is available, run full fork simulation for events + state diffs
 *   3. Degrade gracefully if Anvil is not installed or fork fails
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  decodeEventLog,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExchangeAbi } from "../contracts/abi.js";
import type { OrderDesc, AccountInfo, PositionInfo, PerpetualInfo } from "../contracts/Exchange.js";
import type { ChainConfig, EnvConfig } from "../config.js";
import { isAnvilInstalled, startAnvilFork, stopAnvil, type AnvilInstance } from "./anvil.js";

/** State snapshot of the account at a point in time */
export interface AccountSnapshot {
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  position: {
    positionType: number;
    lotLNS: bigint;
    pricePNS: bigint;
    depositCNS: bigint;
    pnlCNS: bigint;
  } | null;
  ethBalance: bigint;
}

/** Decoded event from transaction receipt */
export interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
}

/** Result from simulateContract (eth_call) — always available */
export interface SimulateResult {
  success: boolean;
  perpId: bigint;
  orderId: bigint;
  gasEstimate: bigint;
  revertReason?: string;
}

/** Full fork result — only when Anvil is available */
export interface ForkResult {
  txHash: Hash;
  receipt: TransactionReceipt;
  gasUsed: bigint;
  gasPrice: bigint;
  gasCostWei: bigint;
  preState: AccountSnapshot;
  postState: AccountSnapshot;
  events: DecodedEvent[];
  perpInfo?: PerpetualInfo;
}

/** Combined dry-run result */
export interface DryRunResult {
  /** Basic simulation (always present) */
  simulate: SimulateResult;
  /** Full fork simulation (present when Anvil available) */
  fork?: ForkResult;
}

/**
 * Take a snapshot of account state from the exchange contract
 */
export async function snapshotAccount(
  publicClient: PublicClient,
  exchangeAddress: Address,
  accountAddress: Address,
  perpId: bigint,
): Promise<AccountSnapshot> {
  // Get account info
  const accountInfo = (await publicClient.readContract({
    address: exchangeAddress,
    abi: ExchangeAbi,
    functionName: "getAccountByAddr",
    args: [accountAddress],
  })) as any;

  const accountId: bigint = accountInfo.accountId;

  // Get position if account exists
  let position: AccountSnapshot["position"] = null;
  if (accountId > 0n) {
    try {
      const [posInfo] = (await publicClient.readContract({
        address: exchangeAddress,
        abi: ExchangeAbi,
        functionName: "getPosition",
        args: [perpId, accountId],
      })) as [any, bigint, boolean];

      if (posInfo.lotLNS > 0n) {
        position = {
          positionType: Number(posInfo.positionType),
          lotLNS: posInfo.lotLNS,
          pricePNS: posInfo.pricePNS,
          depositCNS: posInfo.depositCNS,
          pnlCNS: posInfo.pnlCNS,
        };
      }
    } catch {
      // No position exists
    }
  }

  const ethBalance = await publicClient.getBalance({ address: accountAddress });

  return {
    balanceCNS: accountInfo.balanceCNS,
    lockedBalanceCNS: accountInfo.lockedBalanceCNS,
    position,
    ethBalance,
  };
}

/**
 * Try to decode logs against the ExchangeAbi.
 * Silently skips logs that don't match known events.
 */
export function decodeLogs(logs: Log[]): DecodedEvent[] {
  const decoded: DecodedEvent[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({
        abi: ExchangeAbi,
        data: log.data,
        topics: log.topics,
      });
      decoded.push({
        eventName: event.eventName,
        args: event.args as Record<string, unknown>,
      });
    } catch {
      // Log doesn't match any known event — skip
    }
  }
  return decoded;
}

/**
 * Run eth_call simulation (simulateContract).
 * This is fast, doesn't require Anvil, and works against the live RPC.
 */
async function runSimulate(
  publicClient: PublicClient,
  exchangeAddress: Address,
  callerAddress: Address,
  orderDesc: OrderDesc,
): Promise<SimulateResult> {
  try {
    const { result } = await publicClient.simulateContract({
      address: exchangeAddress,
      abi: ExchangeAbi,
      functionName: "execOrder",
      args: [orderDesc],
      account: callerAddress,
    });

    const sig = result as { perpId: bigint; orderId: bigint };

    // Estimate gas separately
    let gasEstimate = 0n;
    try {
      gasEstimate = await publicClient.estimateGas({
        account: callerAddress,
        to: exchangeAddress,
        data: (await import("viem")).encodeFunctionData({
          abi: ExchangeAbi,
          functionName: "execOrder",
          args: [orderDesc],
        }),
      });
    } catch {
      // Gas estimation can fail; non-critical
    }

    return {
      success: true,
      perpId: sig.perpId,
      orderId: sig.orderId,
      gasEstimate,
    };
  } catch (error: any) {
    const reason =
      error.shortMessage || error.message || "Unknown revert";
    return {
      success: false,
      perpId: 0n,
      orderId: 0n,
      gasEstimate: 0n,
      revertReason: reason,
    };
  }
}

/**
 * Run full fork simulation using Anvil.
 * Forks the chain, executes the trade, captures state diffs and events.
 */
async function runForkSimulation(
  config: EnvConfig,
  exchangeAddress: Address,
  orderDesc: OrderDesc,
): Promise<ForkResult> {
  const privateKey = config.privateKey!;
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = config.chain.rpcUrl;

  let anvil: AnvilInstance | undefined;
  try {
    anvil = await startAnvilFork(rpcUrl);

    const forkPublicClient = createPublicClient({
      chain: config.chain.chain,
      transport: http(anvil.rpcUrl),
    });

    const forkWalletClient = createWalletClient({
      account,
      chain: config.chain.chain,
      transport: http(anvil.rpcUrl),
    });

    // Snapshot pre-state
    const preState = await snapshotAccount(
      forkPublicClient,
      exchangeAddress,
      account.address,
      orderDesc.perpId,
    );

    // Execute trade on fork using writeContract to capture return value
    const txHash = await forkWalletClient.writeContract({
      address: exchangeAddress,
      abi: ExchangeAbi,
      functionName: "execOrder",
      args: [orderDesc],
      account,
      chain: config.chain.chain,
    });

    // Mine the block (Anvil is in no-mining mode)
    await forkPublicClient.request({
      method: "evm_mine" as any,
    });

    // Get receipt
    const receipt = await forkPublicClient.waitForTransactionReceipt({ hash: txHash });

    // Snapshot post-state
    const postState = await snapshotAccount(
      forkPublicClient,
      exchangeAddress,
      account.address,
      orderDesc.perpId,
    );

    // Decode events
    const events = decodeLogs(receipt.logs);

    // Fetch perpetual info (non-critical)
    let perpInfo: PerpetualInfo | undefined;
    try {
      const perpResult = (await forkPublicClient.readContract({
        address: exchangeAddress,
        abi: ExchangeAbi,
        functionName: "getPerpetualInfo",
        args: [orderDesc.perpId],
      })) as any;
      perpInfo = {
        name: perpResult.name,
        symbol: perpResult.symbol,
        priceDecimals: perpResult.priceDecimals,
        lotDecimals: perpResult.lotDecimals,
        markPNS: perpResult.markPNS,
        markTimestamp: perpResult.markTimestamp,
        oraclePNS: perpResult.oraclePNS,
        longOpenInterestLNS: perpResult.longOpenInterestLNS,
        shortOpenInterestLNS: perpResult.shortOpenInterestLNS,
        fundingStartBlock: perpResult.fundingStartBlock,
        fundingRatePct100k: perpResult.fundingRatePct100k,
        status: perpResult.status,
        paused: perpResult.status === 0,
        basePricePNS: perpResult.basePricePNS,
        maxBidPriceONS: perpResult.maxBidPriceONS,
        minBidPriceONS: perpResult.minBidPriceONS,
        maxAskPriceONS: perpResult.maxAskPriceONS,
        minAskPriceONS: perpResult.minAskPriceONS,
        numOrders: perpResult.numOrders,
      };
    } catch {
      // Non-critical — perpInfo stays undefined
    }

    const gasPrice = receipt.effectiveGasPrice ?? 0n;
    const gasCostWei = receipt.gasUsed * gasPrice;

    return {
      txHash,
      receipt,
      gasUsed: receipt.gasUsed,
      gasPrice,
      gasCostWei,
      preState,
      postState,
      events,
      perpInfo,
    };
  } finally {
    if (anvil) {
      stopAnvil(anvil);
    }
  }
}

/**
 * Execute a dry-run simulation of a trade.
 *
 * Hybrid approach:
 *   1. Always runs eth_call simulation for pass/fail + return value
 *   2. Attempts full Anvil fork for state diffs + events
 *   3. Returns whatever level of detail is available
 */
export async function simulateTrade(
  config: EnvConfig,
  orderDesc: OrderDesc,
): Promise<DryRunResult> {
  const exchangeAddress = config.chain.exchangeAddress;
  const account = privateKeyToAccount(config.privateKey!);

  // Create client pointing at live RPC for eth_call simulation
  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Step 1: Always run simulateContract
  const simulate = await runSimulate(
    publicClient,
    exchangeAddress,
    account.address,
    orderDesc,
  );

  // Step 2: Try full fork simulation if Anvil is available
  let fork: ForkResult | undefined;
  if (simulate.success && await isAnvilInstalled()) {
    try {
      fork = await runForkSimulation(config, exchangeAddress, orderDesc);
    } catch (error: any) {
      // Fork failed — degrade gracefully
      console.error(
        `Note: Anvil fork simulation failed (${error.message}). Showing eth_call results only.`
      );
    }
  }

  return { simulate, fork };
}
