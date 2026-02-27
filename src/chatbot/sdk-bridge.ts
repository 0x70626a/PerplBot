/**
 * SDK Bridge — singleton SDK init + human-friendly wrapper methods
 * All methods return JSON-safe objects (no BigInt).
 *
 * Order routing (2-path):
 *   Taker (market/IOC) → WebSocket API + submitAndVerify()
 *   Maker (limit/resting) → on-chain exchange.execOrder()
 */

import { parseAbiItem, type Hash, type PublicClient } from "viem";
import {
  loadEnvConfig,
  validateConfig,
  type EnvConfig,
  TESTNET_MODE,
  Wallet,
  Portfolio,
  Exchange,
  PerplApiClient,
  PerplWebSocketClient,
  API_CONFIG,
  USE_API,
  PERPETUALS,
  getActivePerpIds,
  priceToPNS,
  pnsToPrice,
  lotToLNS,
  lnsToLot,
  leverageToHdths,
  amountToCNS,
  simulateLiquidation,
  printLiquidationReport,
  analyzeTransaction,
  forensicsResultToJson,
  printForensicsReport,
  simulateTrade,
  printDryRunReport,
  runStrategySimulation,
  strategySimResultToJson,
  printStrategySimReport,
  type StrategySimConfig,
} from "../sdk/index.js";
import { OrderType, PositionType, type OrderDesc } from "../sdk/contracts/Exchange.js";
import { OrderStatus, type Order } from "../sdk/api/types.js";
import { captureConsole, ansiToHtml } from "./ansi-html.js";

// Singleton state
let wallet: Wallet;
let exchange: Exchange;
let portfolio: Portfolio;
let publicClient: PublicClient;
let envConfig: EnvConfig;

// Last simulation's batch orders — used by "place orders" direct handler
let lastBatchOrders: Array<{ market: string; side: "long" | "short"; size: number; price: number; leverage: number }> | undefined;

// WebSocket client for trigger orders (SL/TP) — set during init
let wsClient: PerplWebSocketClient | undefined;
let wsAccountId: number | undefined;

/**
 * Submit via WS, then verify the fill.
 * 1. Listen for WS "orders" event matched by requestId (fast path, ~1-3s)
 * 2. Fall back to on-chain position polling after 3s if no WS event
 * Total timeout: 10s
 */
async function submitAndVerify(
  requestId: number,
  perpId: bigint,
  prePosition: { lotLNS: bigint; positionType: number },
  timeoutMs = 10_000,
): Promise<{ filled: boolean; fillPrice?: number; fillSize?: number; txHash?: string; status: string }> {
  if (!wsClient) throw new Error("WebSocket not connected");
  const ws = wsClient;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: { filled: boolean; fillPrice?: number; fillSize?: number; txHash?: string; status: string }) => {
      if (settled) return;
      settled = true;
      ws.off("orders", onOrders);
      clearTimeout(totalTimer);
      if (pollTimer) clearTimeout(pollTimer);
      resolve(result);
    };

    // 1. WS "orders" listener — fast path
    const onOrders = (orders: Order[]) => {
      const match = orders.find(o => o.rq === requestId);
      if (!match) return;

      if (match.st === OrderStatus.Filled) {
        console.log(`[ws] Order filled (requestId: ${requestId})`);
        settle({
          filled: true,
          fillPrice: match.fp,
          fillSize: match.fs,
          txHash: match.at?.txid,
          status: "filled",
        });
      } else if (match.st === OrderStatus.Rejected || match.st === OrderStatus.Cancelled) {
        console.log(`[ws] Order ${OrderStatus[match.st]} (requestId: ${requestId}, reason: ${match.sr})`);
        settle({ filled: false, status: OrderStatus[match.st].toLowerCase() });
      }
      // Open/PartiallyFilled — keep listening
    };
    ws.on("orders", onOrders);

    // 2. Fallback: on-chain polling after 3s (in case WS events don't arrive)
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    pollTimer = setTimeout(async () => {
      console.log(`[api] No WS event after 3s, falling back to on-chain polling...`);
      const accountSummary = await portfolio.getAccountSummary();
      const remaining = timeoutMs - 3000;
      const polls = Math.floor(remaining / 1000);
      for (let i = 0; i < polls && !settled; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const { position } = await exchange.getPosition(perpId, accountSummary.accountId);
          if (position.lotLNS !== prePosition.lotLNS || position.positionType !== prePosition.positionType) {
            console.log(`[api] Fill confirmed on-chain after ${i + 4}s`);
            settle({ filled: true, status: "filled" });
            return;
          }
        } catch { /* keep polling */ }
      }
    }, 3000);

    // 3. Total timeout
    const totalTimer = setTimeout(() => {
      console.log(`[api] No fill detected after ${timeoutMs / 1000}s`);
      settle({ filled: false, status: "timeout" });
    }, timeoutMs);
  });
}

const PERP_NAMES: Record<string, bigint> = TESTNET_MODE
  ? {
      BTC: PERPETUALS.BTC,
      ETH: PERPETUALS.ETH,
      SOL: PERPETUALS.SOL,
      MON: PERPETUALS.MON,
      ZEC: PERPETUALS.ZEC,
    }
  : {};

function resolvePerpId(market: string): bigint {
  const id = PERP_NAMES[market.toUpperCase()];
  if (id !== undefined) return id;
  // Allow numeric IDs (essential for mainnet where symbols are unknown at compile time)
  const parsed = parseInt(market, 10);
  if (!isNaN(parsed)) return BigInt(parsed);
  throw new Error(`Unknown market "${market}". Available: ${Object.keys(PERP_NAMES).join(", ") || "use numeric IDs (e.g. 1, 10)"}`);
}

/**
 * Initialize the SDK singletons from environment variables.
 */
export async function initSDK(): Promise<void> {
  const config = loadEnvConfig();
  validateConfig(config);
  envConfig = config;

  wallet = Wallet.fromPrivateKey(config.privateKey, config.chain);
  exchange = wallet.connect(config.chain.exchangeAddress);
  publicClient = wallet.publicClient;

  // Try API connect (non-fatal)
  try {
    await wallet.connectApi();
    wsClient = wallet.getWsClient();
    wsClient?.on("error", (err) => console.warn("[chatbot] WebSocket error:", err.message));
    console.log("[chatbot] API connected");
  } catch (err) {
    console.warn("[chatbot] API connect failed (contract-only):", (err as Error).message);
  }

  portfolio = new Portfolio(
    exchange,
    wallet.publicClient,
    config.chain.exchangeAddress,
    wallet.getApiClient(),
  );
  await portfolio.setAccountByAddress(wallet.address);

  // Get account ID for WebSocket trigger orders
  if (wsClient) {
    try {
      const summary = await portfolio.getAccountSummary();
      wsAccountId = Number(summary.accountId);
    } catch { /* non-fatal */ }
  }

  console.log("[chatbot] SDK initialized");
}

// ============ Read-only methods ============

export async function getAccountSummary() {
  const s = await portfolio.getAccountSummary();
  return {
    accountId: s.accountId.toString(),
    balance: s.balance,
    lockedBalance: s.lockedBalance,
    availableBalance: s.availableBalance,
    totalEquity: s.totalEquity,
    unrealizedPnl: s.unrealizedPnl,
    marginUsed: s.marginUsed,
    marginAvailable: s.marginAvailable,
  };
}

export async function getPositions() {
  // Use on-chain contract data (authoritative) — API can return stale sub-positions
  const accountSummary = await portfolio.getAccountSummary();
  const perpIds = getActivePerpIds() as unknown as bigint[];
  const results = [];

  for (const perpId of perpIds) {
    try {
      const { position, markPrice: markPricePNS } = await exchange.getPosition(perpId, accountSummary.accountId);
      if (position.lotLNS === 0n) continue;

      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = perpInfo.priceDecimals;
      const lotDecimals = perpInfo.lotDecimals;

      const size = Number(position.lotLNS) / Number(10n ** lotDecimals);
      const entryPrice = Number(position.pricePNS) / Number(10n ** priceDecimals);
      const markPrice = Number(markPricePNS) / Number(10n ** priceDecimals);
      const margin = Number(position.depositCNS) / 1e6;

      const isLong = position.positionType === PositionType.Long;
      const notional = entryPrice * size;
      const currentNotional = markPrice * size;
      const unrealizedPnl = isLong ? currentNotional - notional : notional - currentNotional;
      const unrealizedPnlPercent = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
      const leverage = margin > 0 ? notional / margin : 0;

      results.push({
        market: perpInfo.symbol,
        side: isLong ? "long" : "short",
        size,
        entryPrice,
        markPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
        margin,
        leverage,
      });
    } catch {
      // No position in this market
    }
  }

  return results;
}

export async function getMarkets() {
  const markets = await portfolio.getAvailableMarkets(getActivePerpIds() as unknown as bigint[]);
  return markets.map((m) => ({
    market: m.symbol,
    markPrice: m.markPrice,
    oraclePrice: m.oraclePrice,
    fundingRate: m.fundingRate,
    longOpenInterest: m.longOpenInterest,
    shortOpenInterest: m.shortOpenInterest,
    paused: m.paused,
  }));
}

export async function getOpenOrders(market?: string) {
  if (market) {
    const perpId = resolvePerpId(market);
    const orders = await portfolio.getOpenOrders(perpId);
    return orders.map(formatOrder);
  }
  const orders = await portfolio.getAllOpenOrders(getActivePerpIds() as unknown as bigint[]);
  return orders.map(formatOrder);
}

function formatOrder(o: { perpId: bigint; orderId: bigint; symbol: string; side: string; price: number; size: number; leverage: number }) {
  return {
    market: o.symbol,
    orderId: o.orderId.toString(),
    side: o.side,
    price: o.price,
    size: o.size,
    leverage: o.leverage,
  };
}

export async function getFundingInfo(market: string) {
  const perpId = resolvePerpId(market);
  const info = await portfolio.getFundingInfo(perpId);
  const timeStr = await portfolio.getTimeUntilFunding(perpId);
  return {
    market: info.symbol,
    currentRate: info.currentRate,
    nextFundingTime: info.nextFundingTime.toISOString(),
    timeUntilFunding: timeStr,
  };
}

// ============ Write methods ============

export async function openPosition(params: {
  market: string;
  side: "long" | "short";
  size: number;
  price: number;
  leverage: number;
  is_market_order?: boolean;
}) {
  const perpId = resolvePerpId(params.market);
  const perpInfo = await portfolio.getMarket(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotLNS = lotToLNS(params.size, BigInt(perpInfo.lotDecimals));
  const leverageH = leverageToHdths(params.leverage);
  const pricePNS = priceToPNS(params.price, priceDecimals);

  if (params.is_market_order && wsClient && wsAccountId !== undefined) {
    // ── Taker → WS API (market/IOC, takes liquidity) ──
    const accountSummary = await portfolio.getAccountSummary();
    const { position: prePos } = await exchange.getPosition(perpId, accountSummary.accountId);

    const lastBlock = Number(await publicClient.getBlockNumber()) + 1000;
    const orderType = params.side === "long" ? 1 : 2; // OpenLong : OpenShort
    const requestId = Date.now();

    wsClient.submitOrder({
      rq: requestId,
      mkt: Number(perpId),
      acc: wsAccountId,
      t: orderType as never,
      p: Number(pricePNS),
      s: Number(lotLNS),
      fl: 4 as never, // IOC
      lv: Number(leverageH),
      lb: lastBlock,
    });
    console.log(`[api] Order submitted (requestId: ${requestId}), verifying...`);

    const result = await submitAndVerify(requestId, perpId, {
      lotLNS: prePos.lotLNS,
      positionType: prePos.positionType,
    });

    return {
      success: result.filled,
      txHash: result.txHash,
      fillPrice: result.fillPrice,
      fillSize: result.fillSize,
      status: result.status,
      route: "api",
      market: params.market.toUpperCase(),
      side: params.side,
      size: params.size,
      price: params.price,
      leverage: params.leverage,
      type: "market",
    };
  } else {
    // ── Maker → on-chain SDK (limit/resting, adds liquidity) ──
    const orderType = params.side === "long" ? OrderType.OpenLong : OrderType.OpenShort;
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType,
      orderId: 0n,
      pricePNS,
      lotLNS,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: leverageH,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };
    const txHash = await exchange.execOrder(orderDesc);

    return {
      success: true,
      txHash,
      market: params.market.toUpperCase(),
      side: params.side,
      size: params.size,
      price: params.price,
      leverage: params.leverage,
      type: "limit",
    };
  }
}

export async function closePosition(params: {
  market: string;
  side: "long" | "short";
  size?: number;
  price?: number;
  is_market_order?: boolean;
}) {
  const perpId = resolvePerpId(params.market);
  const perpInfo = await portfolio.getMarket(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);

  // Read on-chain position (authoritative, not API sub-positions)
  const accountSummary = await portfolio.getAccountSummary();
  const { position, markPrice: markPricePNS } = await exchange.getPosition(perpId, accountSummary.accountId);

  if (position.lotLNS === 0n) {
    throw new Error(`No open position in ${params.market.toUpperCase()}`);
  }

  const rawLotLNS = params.size ? lotToLNS(params.size, lotDecimals) : position.lotLNS;

  // Use on-chain position type (authoritative)
  const isLong = position.positionType === PositionType.Long;
  let pricePNS: bigint;
  if (params.price) {
    pricePNS = priceToPNS(params.price, priceDecimals);
  } else {
    const currentPrice = Number(markPricePNS) / Number(10n ** priceDecimals);
    const slippagePrice = isLong ? currentPrice * 0.99 : currentPrice * 1.01;
    pricePNS = priceToPNS(slippagePrice, priceDecimals);
  }

  const isMarket = params.is_market_order !== false;

  if (isMarket && wsClient && wsAccountId !== undefined) {
    // ── Taker → WS API (market close, takes liquidity) ──
    const lastBlock = Number(await publicClient.getBlockNumber()) + 1000;
    const apiOrderType = isLong ? 3 : 4; // CloseLong : CloseShort
    const requestId = Date.now();

    wsClient.submitOrder({
      rq: requestId,
      mkt: Number(perpId),
      acc: wsAccountId,
      t: apiOrderType as never,
      p: Number(pricePNS),
      s: Number(rawLotLNS),
      fl: 4 as never, // IOC
      lv: 0,
      lb: lastBlock,
    });
    console.log(`[api] Close order submitted (requestId: ${requestId}), verifying...`);

    const result = await submitAndVerify(requestId, perpId, {
      lotLNS: position.lotLNS,
      positionType: position.positionType,
    });

    const closedSize = Number(rawLotLNS) / Number(10n ** lotDecimals);
    const closePrice = Number(pricePNS) / Number(10n ** priceDecimals);
    return {
      success: result.filled,
      txHash: result.txHash,
      fillPrice: result.fillPrice,
      fillSize: result.fillSize,
      status: result.status,
      route: "api",
      market: params.market.toUpperCase(),
      side: isLong ? "long" : "short",
      size: closedSize,
      price: closePrice,
      type: "market",
    };
  } else {
    // ── Maker → on-chain SDK (limit close, adds liquidity) ──
    const orderType = isLong ? OrderType.CloseLong : OrderType.CloseShort;
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType,
      orderId: 0n,
      pricePNS,
      lotLNS: rawLotLNS,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 100n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };
    const txHash = await exchange.execOrder(orderDesc);

    const closedSize = Number(rawLotLNS) / Number(10n ** lotDecimals);
    const closePrice = Number(pricePNS) / Number(10n ** priceDecimals);
    return {
      success: true,
      txHash,
      market: params.market.toUpperCase(),
      side: isLong ? "long" : "short",
      size: closedSize,
      price: closePrice,
      type: "limit",
    };
  }
}

export async function cancelOrder(market: string, orderId: string) {
  const perpId = resolvePerpId(market);

  const orderDesc: OrderDesc = {
    orderDescId: 0n,
    perpId,
    orderType: OrderType.Cancel,
    orderId: BigInt(orderId),
    pricePNS: 0n,
    lotLNS: 0n,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: false,
    maxMatches: 0n,
    leverageHdths: 0n,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxSlippageBps: 0n,
  };
  const txHash = await exchange.execOrder(orderDesc);

  return {
    success: true,
    txHash,
    market: market.toUpperCase(),
    orderId,
  };
}

export async function batchOpenPositions(orders: Array<{
  market: string;
  side: "long" | "short";
  size: number;
  price: number;
  leverage: number;
}>) {
  // Build all OrderDescs and submit as a single on-chain tx
  const orderDescs: OrderDesc[] = [];
  const orderMeta: Array<{ market: string; side: string; size: number; price: number; leverage: number }> = [];

  for (const order of orders) {
    const perpId = resolvePerpId(order.market);
    const perpInfo = await portfolio.getMarket(perpId);
    const priceDecimals = BigInt(perpInfo.priceDecimals);
    const lotDecimals = BigInt(perpInfo.lotDecimals);

    orderDescs.push({
      orderDescId: 0n,
      perpId,
      orderType: order.side === "long" ? OrderType.OpenLong : OrderType.OpenShort,
      orderId: 0n,
      pricePNS: priceToPNS(order.price, priceDecimals),
      lotLNS: lotToLNS(order.size, lotDecimals),
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: leverageToHdths(order.leverage),
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    });
    orderMeta.push({
      market: order.market.toUpperCase(),
      side: order.side,
      size: order.size,
      price: order.price,
      leverage: order.leverage,
    });
  }

  const txHash = await exchange.execOrders(orderDescs, false);

  return {
    totalOrders: orders.length,
    successful: orders.length,
    failed: 0,
    txHash,
    results: orderMeta.map((m) => ({ success: true, txHash, ...m })),
  };
}

// ============ Direct "place orders" support ============

export function getLastBatchOrders() { return lastBatchOrders; }
export function clearLastBatchOrders() { lastBatchOrders = undefined; }

// ============ Stop Loss / Take Profit (Trigger Orders via WebSocket) ============

export async function setStopLoss(params: { market: string; trigger_price: number; size?: number }) {
  return placeTriggerOrder({ ...params, type: "stop_loss" });
}

export async function setTakeProfit(params: { market: string; trigger_price: number; size?: number }) {
  return placeTriggerOrder({ ...params, type: "take_profit" });
}

async function placeTriggerOrder(params: {
  market: string;
  trigger_price: number;
  size?: number;
  type: "stop_loss" | "take_profit";
}) {
  if (!wsClient || wsAccountId === undefined) {
    throw new Error("WebSocket trading not connected. SL/TP orders require API connection.");
  }

  const perpId = resolvePerpId(params.market);
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);

  const accountSummary = await portfolio.getAccountSummary();
  const { position } = await exchange.getPosition(perpId, accountSummary.accountId);

  if (position.lotLNS === 0n) {
    throw new Error(`No open position in ${params.market.toUpperCase()}`);
  }

  const isLong = position.positionType === PositionType.Long;
  const lotLNS = params.size ? lotToLNS(params.size, lotDecimals) : position.lotLNS;
  const triggerPricePNS = priceToPNS(params.trigger_price, priceDecimals);

  // Long + SL: trigger when price <= SL (LTE=2), Long + TP: trigger when price >= TP (GTE=1)
  // Short + SL: trigger when price >= SL (GTE=1), Short + TP: trigger when price <= TP (LTE=2)
  const orderType = isLong ? 3 : 4; // CloseLong : CloseShort
  const tpc = (isLong && params.type === "stop_loss") || (!isLong && params.type === "take_profit") ? 2 : 1;

  const lastBlock = Number(await publicClient.getBlockNumber()) + 1000;

  const requestId = wsClient.submitOrder({
    rq: Date.now(),
    mkt: Number(perpId),
    acc: wsAccountId,
    t: orderType as never,
    p: 0, // Market execution when triggered
    s: Number(lotLNS),
    fl: 0 as never, // GTC — trigger persists until hit
    tp: Number(triggerPricePNS),
    tpc,
    lv: 0,
    lb: lastBlock,
  });

  return {
    success: true,
    requestId,
    type: params.type === "stop_loss" ? "Stop Loss" : "Take Profit",
    market: params.market.toUpperCase(),
    side: isLong ? "long" : "short",
    triggerPrice: params.trigger_price,
    size: Number(lotLNS) / Number(10n ** lotDecimals),
    triggerCondition: tpc === 1 ? "price >= trigger" : "price <= trigger",
  };
}

export async function addMargin(params: { market: string; amount: number }) {
  const perpId = resolvePerpId(params.market);
  const amountCNS = amountToCNS(params.amount);
  const txHash = await exchange.increasePositionCollateral(perpId, amountCNS);
  return { success: true, txHash, market: params.market.toUpperCase(), amount: params.amount };
}

export async function removeMargin(params: { market: string; amount: number }) {
  const perpId = resolvePerpId(params.market);
  const amountCNS = amountToCNS(params.amount);
  const txHash = await exchange.requestDecreasePositionCollateral(perpId, amountCNS, true);
  return {
    success: true,
    txHash,
    market: params.market.toUpperCase(),
    amount: params.amount,
    note: "Decrease request submitted. Finalization required after timelock.",
  };
}

export async function cancelAllOrders(market: string) {
  const perpId = resolvePerpId(market);
  const orders = await portfolio.getOpenOrders(perpId);

  let cancelled = 0;
  const errors: string[] = [];
  for (const order of orders) {
    try {
      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType: OrderType.Cancel,
        orderId: order.orderId,
        pricePNS: 0n,
        lotLNS: 0n,
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: false,
        maxMatches: 0n,
        leverageHdths: 0n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
        maxSlippageBps: 0n,
      };
      await exchange.execOrder(orderDesc);
      cancelled++;
    } catch (e: any) {
      errors.push(`Order ${order.orderId}: ${e.shortMessage || e.message}`);
    }
  }
  return { success: true, market: market.toUpperCase(), totalOrders: orders.length, cancelled, errors };
}

export async function depositCollateral(amount: number) {
  const amountCNS = amountToCNS(amount);
  const txHash = await exchange.depositCollateral(amountCNS);
  return {
    success: true,
    txHash,
    amount,
  };
}

export async function withdrawCollateral(amount: number) {
  const amountCNS = amountToCNS(amount);
  const txHash = await exchange.withdrawCollateral(amountCNS);
  return {
    success: true,
    txHash,
    amount,
  };
}

export async function getLiquidationAnalysis(market: string) {
  const perpId = resolvePerpId(market);
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const accountSummary = await portfolio.getAccountSummary();
  const { position } = await exchange.getPosition(perpId, accountSummary.accountId);

  if (position.lotLNS === 0n) {
    throw new Error(`No open position in ${market.toUpperCase()}`);
  }

  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);
  const result = simulateLiquidation(perpId, position, perpInfo, market.toUpperCase(), {}, priceDecimals, lotDecimals);
  const reportAnsi = captureConsole(() => printLiquidationReport(result));

  return {
    market: result.perpName,
    side: result.positionType,
    size: result.size,
    entryPrice: result.entryPrice,
    liquidationPrice: result.liquidationPrice,
    distancePct: result.distancePct,
    distanceUsd: result.distanceUsd,
    currentMarkPrice: result.currentMarkPrice,
    currentPnl: result.currentPnl,
    currentEquity: result.currentEquity,
    _report: ansiToHtml(reportAnsi),
  };
}

export async function getTradingFees(market: string) {
  const perpId = resolvePerpId(market);
  const fees = await portfolio.getTradingFees(perpId);
  return {
    market: market.toUpperCase(),
    takerFeePercent: fees.takerFeePercent,
    makerFeePercent: fees.makerFeePercent,
  };
}

// ============ Orderbook (extracted from CLI show.ts) ============

const makerFilledEvent = parseAbiItem(
  "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)",
);

export async function getOrderbook(market: string, depth = 10, level: 1 | 2 | 3 = 2) {
  const perpId = resolvePerpId(market);
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);
  const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);
  const basePNS = perpInfo.basePricePNS;
  const onsToPrice = (ons: bigint) => pnsToPrice(ons + basePNS, priceDecimals);

  // ── L1: Best bid/ask only (fast path, minimal RPC) ──
  if (level === 1) {
    const bestBidONS = perpInfo.maxBidPriceONS;
    const bestAskONS = perpInfo.minAskPriceONS;

    const [bidVol, askVol] = await Promise.all([
      bestBidONS > 0n ? exchange.getVolumeAtBookPrice(perpId, bestBidONS) : null,
      bestAskONS > 0n ? exchange.getVolumeAtBookPrice(perpId, bestAskONS) : null,
    ]);

    const bestBid = bidVol && bidVol.bids > 0n
      ? { price: onsToPrice(bestBidONS), size: lnsToLot(bidVol.bids, lotDecimals) }
      : null;
    const bestAsk = askVol && askVol.asks > 0n
      ? { price: onsToPrice(bestAskONS), size: lnsToLot(askVol.asks, lotDecimals) }
      : null;

    let spread: number | undefined;
    if (bestBid && bestAsk) {
      spread = bestAsk.price - bestBid.price;
    }

    return { market: market.toUpperCase(), markPrice, level: 1, bestBid, bestAsk, spread };
  }

  // ── L3: On-chain walk + individual orders per level ──
  if (level === 3) {
    // Walk bids
    const bidLevels: Array<{ price: number; size: number; ons: bigint }> = [];
    let currentONS = perpInfo.maxBidPriceONS;
    while (bidLevels.length < depth && currentONS > 0n) {
      const [volume, nextONS] = await Promise.all([
        exchange.getVolumeAtBookPrice(perpId, currentONS),
        exchange.getNextPriceBelowWithOrders(perpId, currentONS),
      ]);
      if (volume.bids > 0n) {
        bidLevels.push({ price: onsToPrice(currentONS), size: lnsToLot(volume.bids, lotDecimals), ons: currentONS });
      }
      currentONS = nextONS;
    }

    // Walk asks (worst to best, then trim)
    const allAsks: Array<{ price: number; size: number; ons: bigint }> = [];
    currentONS = perpInfo.maxAskPriceONS;
    let hops = 0;
    while (currentONS > 0n && hops < 200) {
      const [volume, nextONS] = await Promise.all([
        exchange.getVolumeAtBookPrice(perpId, currentONS),
        exchange.getNextPriceBelowWithOrders(perpId, currentONS),
      ]);
      if (volume.asks > 0n) {
        allAsks.push({ price: onsToPrice(currentONS), size: lnsToLot(volume.asks, lotDecimals), ons: currentONS });
      }
      currentONS = nextONS;
      hops++;
    }
    const askLevels = allAsks.slice(-depth).reverse();

    // Fetch individual orders per level
    const ORDER_TYPE_NAMES: Record<number, string> = { 0: "OpenLong", 1: "OpenShort", 2: "CloseLong", 3: "CloseShort" };

    async function getOrdersForLevel(lvl: { ons: bigint }, side: "bid" | "ask") {
      const { orders } = await exchange.getOrdersAtPriceLevel(perpId, lvl.ons);
      const filtered = side === "bid"
        ? orders.filter(o => o.lotLNS > 0n && (o.orderType === 0 || o.orderType === 2))
        : orders.filter(o => o.lotLNS > 0n && (o.orderType === 1 || o.orderType === 3));
      return filtered.map(o => ({
        orderId: o.orderId,
        accountId: o.accountId,
        size: lnsToLot(o.lotLNS, lotDecimals),
        leverage: o.leverageHdths / 100,
        type: ORDER_TYPE_NAMES[o.orderType] ?? String(o.orderType),
        expiryBlock: o.expiryBlock,
      }));
    }

    const bids = await Promise.all(bidLevels.map(async lvl => ({
      price: lvl.price,
      size: lvl.size,
      orders: await getOrdersForLevel(lvl, "bid"),
    })));

    const asks = await Promise.all(askLevels.map(async lvl => ({
      price: lvl.price,
      size: lvl.size,
      orders: await getOrdersForLevel(lvl, "ask"),
    })));

    return { market: market.toUpperCase(), markPrice, level: 3, bids, asks };
  }

  // ── L2: On-chain walk (aggregated price levels) ──
  // Walk bids downward from best bid
  const bidLevels: Array<{ price: number; size: number }> = [];
  let currentONS = perpInfo.maxBidPriceONS;
  while (bidLevels.length < depth && currentONS > 0n) {
    const [volume, nextONS] = await Promise.all([
      exchange.getVolumeAtBookPrice(perpId, currentONS),
      exchange.getNextPriceBelowWithOrders(perpId, currentONS),
    ]);
    if (volume.bids > 0n) {
      bidLevels.push({ price: onsToPrice(currentONS), size: lnsToLot(volume.bids, lotDecimals) });
    }
    currentONS = nextONS;
  }

  // Walk asks downward from worst ask, collect all, take closest to spread
  const allAsks: Array<{ price: number; size: number }> = [];
  currentONS = perpInfo.maxAskPriceONS;
  let hops = 0;
  while (currentONS > 0n && hops < 200) {
    const [volume, nextONS] = await Promise.all([
      exchange.getVolumeAtBookPrice(perpId, currentONS),
      exchange.getNextPriceBelowWithOrders(perpId, currentONS),
    ]);
    if (volume.asks > 0n) {
      allAsks.push({ price: onsToPrice(currentONS), size: lnsToLot(volume.asks, lotDecimals) });
    }
    currentONS = nextONS;
    hops++;
  }
  const askLevels = allAsks.slice(-depth).reverse();

  return {
    market: market.toUpperCase(),
    markPrice,
    level: 2,
    bids: bidLevels,
    asks: askLevels,
    totalOrders: Number(perpInfo.numOrders),
  };
}

// ============ Recent Trades (extracted from CLI show.ts) ============

export async function getRecentTrades(market: string, limit = 20) {
  const perpId = resolvePerpId(market);
  const exchangeAddr = envConfig.chain.exchangeAddress;
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);

  const currentBlock = await publicClient.getBlockNumber();
  const blocksToScan = 2000n;
  const startBlock = currentBlock - blocksToScan;
  const BATCH_SIZE = 100n;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trades: any[] = [];

  for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
    const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

    const fillBatch = await publicClient.getLogs({
      address: exchangeAddr,
      event: makerFilledEvent,
      fromBlock,
      toBlock,
    });

    for (const log of fillBatch) {
      if (log.args.perpId === perpId) {
        trades.push({
          blockNumber: log.blockNumber!.toString(),
          txHash: log.transactionHash,
          price: pnsToPrice(log.args.pricePNS!, priceDecimals),
          size: lnsToLot(log.args.lotLNS!, lotDecimals),
          makerAccountId: log.args.accountId!.toString(),
          orderId: log.args.orderId!.toString(),
        });
      }
    }
  }

  trades.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));

  return {
    market: market.toUpperCase(),
    trades: trades.slice(0, limit),
    totalFound: trades.length,
    blocksScanned: Number(blocksToScan),
  };
}

// ============ Transaction Forensics ============

export async function debugTransaction(txHash: string) {
  const result = await analyzeTransaction(
    envConfig.chain.rpcUrl,
    envConfig.chain.exchangeAddress,
    txHash as Hash,
    envConfig.chain,
  );
  const reportAnsi = captureConsole(() => printForensicsReport(result));
  return {
    ...forensicsResultToJson(result),
    _report: ansiToHtml(reportAnsi),
  };
}

// ============ Strategy Simulation ============

export async function simulateStrategy(params: {
  market: string;
  strategy: "grid" | "mm";
  size: number;
  leverage: number;
  levels?: number;
  spacing?: number;
  centerPrice?: number;
  spreadPercent?: number;
  maxPosition?: number;
  postOnly?: boolean;
}) {
  const perpId = resolvePerpId(params.market);

  const simConfig: StrategySimConfig = {
    strategyType: params.strategy,
    perpId,
    grid: params.strategy === "grid" ? {
      centerPrice: params.centerPrice,
      gridLevels: params.levels ?? 5,
      gridSpacing: params.spacing ?? 100,
      orderSize: params.size,
      leverage: params.leverage,
      postOnly: params.postOnly,
    } : undefined,
    mm: params.strategy === "mm" ? {
      orderSize: params.size,
      spreadPercent: params.spreadPercent ?? 0.001,
      leverage: params.leverage,
      maxPosition: params.maxPosition ?? 1,
      postOnly: params.postOnly,
    } : undefined,
  };

  const result = await runStrategySimulation(envConfig, simConfig);
  const reportAnsi = captureConsole(() => printStrategySimReport(result));
  const priceDecimals = result.priceDecimals;
  const lotDecimals = result.lotDecimals;
  const perpName = params.market.toUpperCase();

  // Build compact orders list for batch_open_positions (human-readable)
  const batchOrders = result.orderDescs.map((od, i) => ({
    market: perpName,
    side: od.orderType === OrderType.OpenLong ? "long" as const : "short" as const,
    size: lnsToLot(od.lotLNS, lotDecimals),
    price: pnsToPrice(od.pricePNS, priceDecimals),
    leverage: Number(od.leverageHdths) / 100,
    status: result.orderResults[i]?.status ?? "unknown",
  }));

  // Store for direct "place orders" execution (bypasses Claude)
  lastBatchOrders = batchOrders.map(({ market, side, size, price, leverage }) => ({ market, side, size, price, leverage }));

  return {
    ...strategySimResultToJson(result),
    _batchOrders: batchOrders,
    _report: ansiToHtml(reportAnsi),
  };
}

// ============ Dry-Run Trade ============

export async function dryRunTrade(params: {
  market: string;
  side: "long" | "short";
  size: number;
  price: number;
  leverage: number;
  is_market_order?: boolean;
}) {
  const perpId = resolvePerpId(params.market);
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);
  const perpName = params.market.toUpperCase();

  const orderType = params.side === "long" ? OrderType.OpenLong : OrderType.OpenShort;
  const orderDesc: OrderDesc = {
    orderDescId: 0n,
    perpId,
    orderType,
    orderId: 0n,
    pricePNS: priceToPNS(params.price, priceDecimals),
    lotLNS: lotToLNS(params.size, lotDecimals),
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: params.is_market_order ?? false,
    maxMatches: 0n,
    leverageHdths: leverageToHdths(params.leverage),
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    maxSlippageBps: 0n,
  };

  const result = await simulateTrade(envConfig, orderDesc);
  const reportAnsi = captureConsole(() =>
    printDryRunReport(result, orderDesc, perpName, priceDecimals, lotDecimals),
  );
  const data = JSON.parse(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v));
  data._report = ansiToHtml(reportAnsi);
  return data;
}
