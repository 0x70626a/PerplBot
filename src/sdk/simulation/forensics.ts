/**
 * Transaction forensics — replay and analyze any Perpl transaction
 *
 * Forks chain at the transaction's block, replays the tx,
 * decodes everything, and produces a structured result.
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type Log,
  createPublicClient,
  createWalletClient,
  http,
  decodeFunctionData,
} from "viem";
import { ExchangeAbi, DelegatedAccountAbi } from "../contracts/abi.js";
import type { OrderDesc, PerpetualInfo } from "../contracts/Exchange.js";
import type { ChainConfig } from "../config.js";
import { startAnvilFork, stopAnvil, type AnvilInstance } from "./anvil.js";
import { snapshotAccount, decodeLogs, type AccountSnapshot, type DecodedEvent } from "./dry-run.js";

// ============ Interfaces ============

export interface DecodedTxInput {
  functionName: string;
  args: Record<string, unknown>;
  orderDesc?: OrderDesc;
  orderDescs?: OrderDesc[];
}

export interface MatchInfo {
  makerAccountId: bigint;
  makerOrderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  feeCNS: bigint;
}

export interface FailureAnalysis {
  rawReason: string;
  explanation: string;
  suggestion?: string;
  isMatchingFailure: boolean;
}

export interface ForensicsResult {
  // Transaction metadata
  txHash: Hash;
  blockNumber: bigint;
  from: Address;
  to: Address;
  isDelegated: boolean;
  accountAddress: Address;

  // Decoded input
  decodedInput: DecodedTxInput | null;

  // Original outcome (from live receipt)
  originalSuccess: boolean;
  originalEvents: DecodedEvent[];
  originalGasUsed: bigint;

  // Replay results (from fork)
  replaySuccess: boolean;
  replayEvents: DecodedEvent[];

  // State diffs
  preState: AccountSnapshot;
  postState: AccountSnapshot;

  // Market context
  perpId: bigint | null;
  perpName: string | null;
  perpInfo: PerpetualInfo | null;

  // Match analysis (from MakerOrderFilled events)
  matches: MatchInfo[];
  fillPrice: number | null;
  totalFilledLots: number | null;

  // Failure analysis (if reverted)
  failure: FailureAnalysis | null;
}

// ============ Perp ID → Name mapping ============

const PERP_IDS_TO_NAMES: Record<string, string> = {
  "16": "BTC",
  "32": "ETH",
  "48": "SOL",
  "64": "MON",
  "256": "ZEC",
};

// ============ Calldata Decoding ============

/**
 * Decode Exchange calldata into a structured result.
 * Returns null if the data doesn't match any known Exchange function.
 */
export function decodeExchangeCalldata(data: `0x${string}`): DecodedTxInput | null {
  try {
    const decoded = decodeFunctionData({
      abi: ExchangeAbi,
      data,
    });

    const result: DecodedTxInput = {
      functionName: decoded.functionName,
      args: decoded.args as unknown as Record<string, unknown>,
    };

    if (decoded.functionName === "execOrder" && decoded.args) {
      result.orderDesc = decoded.args[0] as unknown as OrderDesc;
    } else if (decoded.functionName === "execOrders" && decoded.args) {
      result.orderDescs = decoded.args[0] as unknown as OrderDesc[];
    }

    return result;
  } catch {
    return null;
  }
}

// ============ Revert Reason Mapping ============

const REVERT_REASONS: Array<{
  pattern: RegExp;
  explanation: string;
  suggestion?: string;
  isMatchingFailure: boolean;
}> = [
  {
    pattern: /InsufficientBalance/i,
    explanation: "Not enough collateral for this trade",
    suggestion: "Deposit more collateral before trading",
    isMatchingFailure: false,
  },
  {
    pattern: /PostOnlyFailed/i,
    explanation: "Post-only order would have matched immediately",
    suggestion: "Remove the post-only flag or adjust your limit price",
    isMatchingFailure: true,
  },
  {
    pattern: /FillOrKillFailed/i,
    explanation: "Order couldn't be completely filled",
    suggestion: "Use IOC instead, or increase your limit price for buys / decrease for sells",
    isMatchingFailure: true,
  },
  {
    pattern: /OrderExpired/i,
    explanation: "Order expired before it could be executed",
    suggestion: "Set a later expiry block or use 0 for no expiry",
    isMatchingFailure: false,
  },
  {
    pattern: /InvalidOrder/i,
    explanation: "The order parameters are invalid",
    isMatchingFailure: false,
  },
  {
    pattern: /Paused/i,
    explanation: "The perpetual market is currently paused",
    suggestion: "Wait for the market to be unpaused",
    isMatchingFailure: false,
  },
];

/**
 * Map a revert reason string to a human-readable explanation.
 */
export function mapRevertReason(reason: string): FailureAnalysis {
  for (const entry of REVERT_REASONS) {
    if (entry.pattern.test(reason)) {
      return {
        rawReason: reason,
        explanation: entry.explanation,
        suggestion: entry.suggestion,
        isMatchingFailure: entry.isMatchingFailure,
      };
    }
  }
  return {
    rawReason: reason,
    explanation: `Transaction reverted with: ${reason}`,
    isMatchingFailure: false,
  };
}

// ============ Match Extraction ============

/**
 * Extract match info from MakerOrderFilled events.
 */
export function extractMatches(events: DecodedEvent[]): MatchInfo[] {
  return events
    .filter((e) => e.eventName === "MakerOrderFilled")
    .map((e) => ({
      makerAccountId: BigInt(e.args.accountId as any),
      makerOrderId: BigInt(e.args.orderId as any),
      pricePNS: BigInt(e.args.pricePNS as any),
      lotLNS: BigInt(e.args.lotLNS as any),
      feeCNS: BigInt(e.args.feeCNS as any),
    }));
}

/**
 * Compute the volume-weighted average fill price from matches.
 * Returns null if no matches.
 */
export function computeAvgFillPrice(
  matches: MatchInfo[],
  priceDecimals: bigint,
): number | null {
  if (matches.length === 0) return null;

  let totalValue = 0n;
  let totalLots = 0n;
  for (const m of matches) {
    totalValue += m.pricePNS * m.lotLNS;
    totalLots += m.lotLNS;
  }

  if (totalLots === 0n) return null;

  // Weighted avg in PNS
  const avgPNS = totalValue / totalLots;
  return Number(avgPNS) / Number(10n ** priceDecimals);
}

// ============ DelegatedAccount Detection ============

async function isDelegatedAccount(
  publicClient: PublicClient,
  address: Address,
): Promise<boolean> {
  try {
    await publicClient.readContract({
      address,
      abi: DelegatedAccountAbi,
      functionName: "exchange",
    });
    return true;
  } catch {
    return false;
  }
}

// ============ Main Analysis ============

/**
 * Analyze a transaction by replaying it on a forked chain.
 *
 * @param rpcUrl     - Live RPC URL to fetch tx from and fork
 * @param exchangeAddress - Exchange contract address
 * @param txHash     - Transaction hash to analyze
 * @param chain      - Chain config (for viem chain definition)
 */
export async function analyzeTransaction(
  rpcUrl: string,
  exchangeAddress: Address,
  txHash: Hash,
  chain: ChainConfig,
): Promise<ForensicsResult> {
  const liveClient = createPublicClient({
    chain: chain.chain,
    transport: http(rpcUrl),
  });

  // 1. Fetch transaction + receipt from live chain
  const [tx, receipt] = await Promise.all([
    liveClient.getTransaction({ hash: txHash }),
    liveClient.getTransactionReceipt({ hash: txHash }),
  ]);

  const toAddress = tx.to as Address;
  const fromAddress = tx.from as Address;

  // 2. Determine if this is a Perpl tx (direct to exchange or via DelegatedAccount)
  const isDirect = toAddress.toLowerCase() === exchangeAddress.toLowerCase();
  const isDelegated = !isDirect && await isDelegatedAccount(liveClient, toAddress);
  const accountAddress = isDelegated ? toAddress : fromAddress;

  // 3. Decode calldata
  const decodedInput = decodeExchangeCalldata(tx.input);

  // 4. Extract perpId
  let perpId: bigint | null = null;
  if (decodedInput?.orderDesc) {
    perpId = decodedInput.orderDesc.perpId;
  } else if (decodedInput?.orderDescs && decodedInput.orderDescs.length > 0) {
    perpId = decodedInput.orderDescs[0].perpId;
  }

  // Fallback: try to get perpId from events
  if (perpId === null) {
    const originalEvents = decodeLogs(receipt.logs as unknown as Log[]);
    const orderReq = originalEvents.find((e) => e.eventName === "OrderRequest");
    if (orderReq?.args.perpId !== undefined) {
      perpId = BigInt(orderReq.args.perpId as any);
    }
  }

  // 5. Decode original receipt events
  const originalEvents = decodeLogs(receipt.logs as unknown as Log[]);
  const originalSuccess = receipt.status === "success";

  // 6. Fork at blockNumber - 1 and replay
  let anvil: AnvilInstance | undefined;
  try {
    anvil = await startAnvilFork(rpcUrl, {
      blockNumber: tx.blockNumber - 1n,
    });

    const forkClient = createPublicClient({
      chain: chain.chain,
      transport: http(anvil.rpcUrl),
    });

    const forkWallet = createWalletClient({
      chain: chain.chain,
      transport: http(anvil.rpcUrl),
    });

    // 7. Snapshot pre-state (gracefully handle accounts that don't exist)
    let preState: AccountSnapshot;
    try {
      preState = await snapshotAccount(
        forkClient,
        exchangeAddress,
        accountAddress,
        perpId ?? 0n,
      );
    } catch {
      preState = { balanceCNS: 0n, lockedBalanceCNS: 0n, position: null, ethBalance: 0n };
    }

    // 8. Read perpInfo on fork
    let perpInfo: PerpetualInfo | null = null;
    if (perpId !== null) {
      try {
        const result = (await forkClient.readContract({
          address: exchangeAddress,
          abi: ExchangeAbi,
          functionName: "getPerpetualInfo",
          args: [perpId],
        })) as any;

        perpInfo = {
          name: result.name,
          symbol: result.symbol,
          priceDecimals: result.priceDecimals,
          lotDecimals: result.lotDecimals,
          markPNS: result.markPNS,
          markTimestamp: result.markTimestamp,
          oraclePNS: result.oraclePNS,
          longOpenInterestLNS: result.longOpenInterestLNS,
          shortOpenInterestLNS: result.shortOpenInterestLNS,
          fundingStartBlock: result.fundingStartBlock,
          fundingRatePct100k: result.fundingRatePct100k,
          synthPerpPricePNS: result.synthPerpPricePNS,
          paused: result.paused,
          basePricePNS: result.basePricePNS,
          maxBidPriceONS: result.maxBidPriceONS,
          minBidPriceONS: result.minBidPriceONS,
          maxAskPriceONS: result.maxAskPriceONS,
          minAskPriceONS: result.minAskPriceONS,
          numOrders: result.numOrders,
        };
      } catch {
        // Non-critical
      }
    }

    // 9. Replay tx using auto-impersonation
    let replaySuccess = false;
    let replayEvents: DecodedEvent[] = [];
    let postState = preState; // default to pre if replay fails
    let matches: MatchInfo[] = [];

    try {
      const replayHash = await forkWallet.sendTransaction({
        to: tx.to!,
        data: tx.input,
        value: tx.value,
        account: tx.from,
        chain: chain.chain,
      });

      // Mine the block
      await forkClient.request({ method: "evm_mine" as any });

      const replayReceipt = await forkClient.waitForTransactionReceipt({
        hash: replayHash,
      });

      replaySuccess = replayReceipt.status === "success";
      replayEvents = decodeLogs(replayReceipt.logs as unknown as Log[]);
      matches = extractMatches(replayEvents);

      // 10. Snapshot post-state
      try {
        postState = await snapshotAccount(
          forkClient,
          exchangeAddress,
          accountAddress,
          perpId ?? 0n,
        );
      } catch {
        // Account may not exist post-replay either
      }
    } catch (err: any) {
      // Replay reverted — capture failure info
      replaySuccess = false;
    }

    // 11. Compute fill price from matches
    const priceDecimals = perpInfo?.priceDecimals ?? 1n;
    const lotDecimals = perpInfo?.lotDecimals ?? 5n;
    const fillPrice = computeAvgFillPrice(matches, priceDecimals);
    const totalFilledLots =
      matches.length > 0
        ? Number(matches.reduce((sum, m) => sum + m.lotLNS, 0n)) /
          Number(10n ** lotDecimals)
        : null;

    // 12. Failure analysis
    let failure: FailureAnalysis | null = null;
    if (!originalSuccess) {
      // Try to extract revert reason from original receipt
      // viem doesn't directly give revert reason in receipt, but we can
      // check the events or use a heuristic
      const reason = "Unknown revert";
      failure = mapRevertReason(reason);
    }

    const perpName = perpId !== null
      ? (PERP_IDS_TO_NAMES[perpId.toString()] ?? perpInfo?.symbol ?? null)
      : null;

    return {
      txHash,
      blockNumber: tx.blockNumber,
      from: fromAddress,
      to: toAddress,
      isDelegated,
      accountAddress,
      decodedInput,
      originalSuccess,
      originalEvents,
      originalGasUsed: receipt.gasUsed,
      replaySuccess,
      replayEvents,
      preState,
      postState,
      perpId,
      perpName,
      perpInfo,
      matches,
      fillPrice,
      totalFilledLots,
      failure,
    };
  } finally {
    if (anvil) {
      stopAnvil(anvil);
    }
  }
}
