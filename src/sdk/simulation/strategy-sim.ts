/**
 * Strategy dry-run simulation
 *
 * Forks the live chain, generates orders from a strategy (grid or MM),
 * batch-executes them on the fork against real liquidity, and collects
 * fill/resting/failure results with account state diffs.
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExchangeAbi } from "../contracts/abi.js";
import type { OrderDesc, PerpetualInfo } from "../contracts/Exchange.js";
import { OrderType } from "../contracts/Exchange.js";
import type { EnvConfig } from "../config.js";
import { isAnvilInstalled, startAnvilFork, stopAnvil, type AnvilInstance } from "./anvil.js";
import { snapshotAccount, decodeLogs, type AccountSnapshot, type DecodedEvent } from "./dry-run.js";
import { extractMatches, computeAvgFillPrice, type MatchInfo } from "./forensics.js";
import { createGridOrders, calculateGridMetrics, type GridConfig, type GridMetrics } from "../trading/strategies/grid.js";
import { MarketMakerStrategy, type MarketMakerConfig, type MarketState } from "../trading/strategies/marketMaker.js";
import { pnsToPrice, lnsToLot } from "../trading/orders.js";

// ============ Types ============

export type StrategyType = "grid" | "mm";

export interface GridSimConfig {
  centerPrice?: number;
  gridLevels: number;
  gridSpacing: number;
  orderSize: number;
  leverage: number;
  postOnly?: boolean;
}

export interface MMSimConfig {
  orderSize: number;
  spreadPercent: number;
  leverage: number;
  maxPosition: number;
  postOnly?: boolean;
}

export interface StrategySimConfig {
  strategyType: StrategyType;
  perpId: bigint;
  grid?: GridSimConfig;
  mm?: MMSimConfig;
}

/** Status of an individual order after execution */
export type SimOrderStatus = "filled" | "resting" | "failed";

/** Per-order result */
export interface OrderResult {
  index: number;
  orderType: OrderType;
  pricePNS: bigint;
  lotLNS: bigint;
  status: SimOrderStatus;
  matches: MatchInfo[];
  avgFillPrice: number | null;
  totalFeesCNS: bigint;
  orderId: bigint | null;
}

/** Aggregated simulation result */
export interface StrategySimResult {
  strategyType: StrategyType;
  perpId: bigint;
  perpName: string | null;
  perpInfo: PerpetualInfo;
  priceDecimals: bigint;
  lotDecimals: bigint;
  midPrice: number;

  // Config echo
  gridConfig?: GridSimConfig;
  mmConfig?: MMSimConfig;

  // Orders
  orderDescs: OrderDesc[];
  orderResults: OrderResult[];

  // Aggregates
  totalOrders: number;
  filledOrders: number;
  restingOrders: number;
  failedOrders: number;
  totalFilledLots: number;
  totalFeesCNS: bigint;

  // Account state
  preState: AccountSnapshot;
  postState: AccountSnapshot;

  // Gas
  gasUsed: bigint;
  gasPrice: bigint;
  gasCostWei: bigint;

  // Events
  events: DecodedEvent[];

  // Grid-specific metrics
  gridMetrics?: GridMetrics;

  // Fee rates
  takerFeePer100K: number;
  makerFeePer100K: number;
}

// ============ Perp ID → Name ============

const PERP_IDS_TO_NAMES: Record<string, string> = {
  "16": "BTC",
  "32": "ETH",
  "48": "SOL",
  "64": "MON",
  "256": "ZEC",
};

// ============ Helpers ============

/**
 * Map decoded events to per-order results.
 *
 * Events come in groups: each order produces an OrderRequest event
 * followed by zero or more MakerOrderFilled events (if it matched),
 * then an OrderPlaced (resting) or other terminal event.
 */
export function mapEventsToOrderResults(
  events: DecodedEvent[],
  orderDescs: OrderDesc[],
  priceDecimals: bigint,
  lotDecimals: bigint,
): OrderResult[] {
  const results: OrderResult[] = [];

  // Walk through events, grouping by OrderRequest boundaries
  let currentOrderIdx = -1;
  let currentMatches: MatchInfo[] = [];
  let currentOrderId: bigint | null = null;
  let isResting = false;

  const flushOrder = () => {
    if (currentOrderIdx < 0 || currentOrderIdx >= orderDescs.length) return;
    const od = orderDescs[currentOrderIdx];
    const avgFillPrice = computeAvgFillPrice(currentMatches, priceDecimals);
    const totalFees = currentMatches.reduce((sum, m) => sum + m.feeCNS, 0n);
    const hasFills = currentMatches.length > 0;

    let status: SimOrderStatus;
    if (isResting) {
      status = "resting";
    } else if (hasFills) {
      status = "filled";
    } else {
      status = "failed";
    }

    results.push({
      index: currentOrderIdx,
      orderType: od.orderType,
      pricePNS: od.pricePNS,
      lotLNS: od.lotLNS,
      status,
      matches: currentMatches,
      avgFillPrice,
      totalFeesCNS: totalFees,
      orderId: currentOrderId,
    });
  };

  for (const event of events) {
    if (event.eventName === "OrderRequest") {
      // Flush previous order
      flushOrder();
      currentOrderIdx++;
      currentMatches = [];
      currentOrderId = null;
      isResting = false;
    } else if (event.eventName === "MakerOrderFilled") {
      currentMatches.push({
        makerAccountId: BigInt(event.args.accountId as any),
        makerOrderId: BigInt(event.args.orderId as any),
        pricePNS: BigInt(event.args.pricePNS as any),
        lotLNS: BigInt(event.args.lotLNS as any),
        feeCNS: BigInt(event.args.feeCNS as any),
      });
    } else if (event.eventName === "OrderPlaced") {
      isResting = true;
      currentOrderId = BigInt(event.args.orderId as any);
    }
  }

  // Flush the last order
  flushOrder();

  return results;
}

// ============ Main Simulation ============

/**
 * Run a strategy simulation on a forked chain.
 *
 * 1. Fork the live chain
 * 2. Read market state + account state
 * 3. Generate orders from strategy config
 * 4. Batch execute on fork via execOrders
 * 5. Collect events, state diffs, fill results
 */
export async function runStrategySimulation(
  envConfig: EnvConfig,
  simConfig: StrategySimConfig,
): Promise<StrategySimResult> {
  // Validate
  if (!envConfig.privateKey) {
    throw new Error("PRIVATE_KEY is required for strategy simulation");
  }
  if (simConfig.strategyType === "grid" && !simConfig.grid) {
    throw new Error("Grid config is required for grid strategy");
  }
  if (simConfig.strategyType === "mm" && !simConfig.mm) {
    throw new Error("MM config is required for market maker strategy");
  }

  const account = privateKeyToAccount(envConfig.privateKey!);
  const exchangeAddress = envConfig.chain.exchangeAddress;
  const rpcUrl = envConfig.chain.rpcUrl;

  const callAddress: Address = exchangeAddress;
  const accountAddress: Address = account.address;

  // Check Anvil
  if (!(await isAnvilInstalled())) {
    throw new Error(
      "Anvil is required for strategy simulation. Install Foundry: https://getfoundry.sh",
    );
  }

  let anvil: AnvilInstance | undefined;
  try {
    anvil = await startAnvilFork(rpcUrl);

    const forkPublicClient = createPublicClient({
      chain: envConfig.chain.chain,
      transport: http(anvil.rpcUrl),
    });

    const forkWalletClient = createWalletClient({
      account,
      chain: envConfig.chain.chain,
      transport: http(anvil.rpcUrl),
    });

    // Read perpetual info
    const perpResult = (await forkPublicClient.readContract({
      address: exchangeAddress,
      abi: ExchangeAbi,
      functionName: "getPerpetualInfo",
      args: [simConfig.perpId],
    })) as any;

    const perpInfo: PerpetualInfo = {
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

    const priceDecimals = perpInfo.priceDecimals;
    const lotDecimals = perpInfo.lotDecimals;
    const midPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

    // Read fees
    const [takerFee, makerFee] = await Promise.all([
      forkPublicClient.readContract({
        address: exchangeAddress,
        abi: ExchangeAbi,
        functionName: "getTakerFee",
        args: [simConfig.perpId],
      }) as Promise<bigint>,
      forkPublicClient.readContract({
        address: exchangeAddress,
        abi: ExchangeAbi,
        functionName: "getMakerFee",
        args: [simConfig.perpId],
      }) as Promise<bigint>,
    ]);

    const takerFeePer100K = Number(takerFee);
    const makerFeePer100K = Number(makerFee);

    // Snapshot pre-state (use accountAddress which is DelegatedAccount if configured)
    let preState: AccountSnapshot;
    try {
      preState = await snapshotAccount(
        forkPublicClient,
        exchangeAddress,
        accountAddress,
        simConfig.perpId,
      );
    } catch {
      preState = { balanceCNS: 0n, lockedBalanceCNS: 0n, position: null, ethBalance: 0n };
    }

    // Generate orders from strategy
    let orderDescs: OrderDesc[];
    let gridMetrics: GridMetrics | undefined;

    if (simConfig.strategyType === "grid") {
      const g = simConfig.grid!;
      const gridConfig: GridConfig = {
        perpId: simConfig.perpId,
        centerPrice: g.centerPrice ?? midPrice,
        gridLevels: g.gridLevels,
        gridSpacing: g.gridSpacing,
        orderSize: g.orderSize,
        leverage: g.leverage,
        postOnly: g.postOnly,
        priceDecimals,
        lotDecimals,
      };
      orderDescs = createGridOrders(gridConfig);
      gridMetrics = calculateGridMetrics(gridConfig, takerFeePer100K, makerFeePer100K);
    } else {
      // MM strategy
      const m = simConfig.mm!;
      const mmConfig: MarketMakerConfig = {
        perpId: simConfig.perpId,
        orderSize: m.orderSize,
        spreadPercent: m.spreadPercent,
        leverage: m.leverage,
        maxPosition: m.maxPosition,
        postOnly: m.postOnly,
        priceDecimals,
        lotDecimals,
      };

      // Derive market state from perpInfo
      const basePNS = perpInfo.basePricePNS;
      const bestBid = perpInfo.maxBidPriceONS > 0n
        ? pnsToPrice(perpInfo.maxBidPriceONS + basePNS, priceDecimals)
        : midPrice * (1 - m.spreadPercent);
      const bestAsk = perpInfo.minAskPriceONS > 0n
        ? pnsToPrice(perpInfo.minAskPriceONS + basePNS, priceDecimals)
        : midPrice * (1 + m.spreadPercent);

      const marketState: MarketState = {
        bestBid,
        bestAsk,
        midPrice,
      };

      const mm = new MarketMakerStrategy(mmConfig);
      const quotes = mm.calculateQuotes(marketState, { size: 0 });
      const { bidOrder, askOrder } = mm.generateOrders(quotes);

      orderDescs = [];
      if (bidOrder) orderDescs.push(bidOrder);
      if (askOrder) orderDescs.push(askOrder);
    }

    if (orderDescs.length === 0) {
      throw new Error("Strategy generated no orders");
    }

    // Execute batch on fork (revertOnFail=false for partial fills)
    // On Anvil with --auto-impersonate we can send from any address.
    // When a DelegatedAccount is configured the Exchange account lives at
    // that address, so we impersonate it and call the Exchange directly —
    // bypassing the proxy (whose permission checks may differ on a fork).

    // Fund the impersonated address with ETH for gas (it's a contract, has no ETH)
    await forkPublicClient.request({
      method: "anvil_setBalance" as any,
      params: [accountAddress, "0x56BC75E2D63100000"] as any,  // 100 ETH
    });

    const execData = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrders",
      args: [orderDescs, false],
    });
    const txHash = await forkWalletClient.sendTransaction({
      account: accountAddress,   // impersonate DelegatedAccount (or EOA if no DA)
      to: exchangeAddress,       // call Exchange directly
      data: execData,
      chain: envConfig.chain.chain,
    });

    // Mine the block
    await forkPublicClient.request({ method: "evm_mine" as any });

    // Get receipt
    const receipt = await forkPublicClient.waitForTransactionReceipt({ hash: txHash });

    // Decode events
    const events = decodeLogs(receipt.logs as unknown as Log[]);

    // Snapshot post-state
    let postState: AccountSnapshot;
    try {
      postState = await snapshotAccount(
        forkPublicClient,
        exchangeAddress,
        accountAddress,
        simConfig.perpId,
      );
    } catch {
      postState = preState;
    }

    // Map events to per-order results
    const orderResults = mapEventsToOrderResults(events, orderDescs, priceDecimals, lotDecimals);

    // Compute aggregates
    const filledOrders = orderResults.filter((r) => r.status === "filled").length;
    const restingOrders = orderResults.filter((r) => r.status === "resting").length;
    const failedOrders = orderResults.filter((r) => r.status === "failed").length;
    const totalFilledLots = orderResults.reduce(
      (sum, r) => sum + r.matches.reduce((s, m) => s + Number(m.lotLNS), 0),
      0,
    ) / Number(10n ** lotDecimals);
    const totalFeesCNS = orderResults.reduce((sum, r) => sum + r.totalFeesCNS, 0n);

    const gasPrice = receipt.effectiveGasPrice ?? 0n;
    const gasCostWei = receipt.gasUsed * gasPrice;

    const perpName = PERP_IDS_TO_NAMES[simConfig.perpId.toString()] ?? perpInfo.symbol ?? null;

    return {
      strategyType: simConfig.strategyType,
      perpId: simConfig.perpId,
      perpName,
      perpInfo,
      priceDecimals,
      lotDecimals,
      midPrice,
      gridConfig: simConfig.grid,
      mmConfig: simConfig.mm,
      orderDescs,
      orderResults,
      totalOrders: orderDescs.length,
      filledOrders,
      restingOrders,
      failedOrders,
      totalFilledLots,
      totalFeesCNS,
      preState,
      postState,
      gasUsed: receipt.gasUsed,
      gasPrice,
      gasCostWei,
      events,
      gridMetrics,
      takerFeePer100K,
      makerFeePer100K,
    };
  } finally {
    if (anvil) {
      stopAnvil(anvil);
    }
  }
}
