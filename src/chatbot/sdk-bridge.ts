/**
 * SDK Bridge — singleton SDK init + human-friendly wrapper methods
 * All methods return JSON-safe objects (no BigInt).
 *
 * Supports two modes:
 * 1. Operator mode: OPERATOR_PRIVATE_KEY + DELEGATED_ACCOUNT_ADDRESS set
 * 2. Owner mode: OWNER_PRIVATE_KEY set (direct Exchange access, like CLI trade.ts)
 */

import { type Address, type Hash, createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import {
  loadEnvConfig,
  type EnvConfig,
  OperatorWallet,
  Portfolio,
  OwnerWallet,
  Exchange,
  HybridClient,
  PerplApiClient,
  PerplWebSocketClient,
  API_CONFIG,
  USE_API,
  PERPETUALS,
  ALL_PERP_IDS,
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
import { captureConsole, ansiToHtml } from "./ansi-html.js";

// Singleton state
let exchange: Exchange;
let portfolio: Portfolio;
let publicClient: PublicClient;
let envConfig: EnvConfig;
let mode: "operator" | "owner";

// Last simulation's batch orders — used by "place orders" direct handler
let lastBatchOrders: Array<{ market: string; side: "long" | "short"; size: number; price: number; leverage: number }> | undefined;

// Only set in operator mode
let operatorWallet: OperatorWallet | undefined;

// WebSocket client for trigger orders (SL/TP) — set during init
let wsClient: PerplWebSocketClient | undefined;
let wsAccountId: number | undefined;

const PERP_NAMES: Record<string, bigint> = {
  BTC: PERPETUALS.BTC,
  ETH: PERPETUALS.ETH,
  SOL: PERPETUALS.SOL,
  MON: PERPETUALS.MON,
  ZEC: PERPETUALS.ZEC,
};

function resolvePerpId(market: string): bigint {
  const id = PERP_NAMES[market.toUpperCase()];
  if (id === undefined) {
    throw new Error(`Unknown market "${market}". Available: ${Object.keys(PERP_NAMES).join(", ")}`);
  }
  return id;
}

/**
 * Initialize the SDK singletons from environment variables.
 * Detects whether to use operator mode or owner-direct mode.
 */
export async function initSDK(): Promise<void> {
  const config = loadEnvConfig();
  envConfig = config;

  if (config.operatorPrivateKey && config.delegatedAccountAddress) {
    // ── Operator mode ──
    mode = "operator";
    operatorWallet = OperatorWallet.fromPrivateKey(config.operatorPrivateKey, config.chain);
    exchange = operatorWallet.connect(config.chain.exchangeAddress, config.delegatedAccountAddress);
    publicClient = operatorWallet.publicClient;

    // Try API connect (non-fatal)
    try {
      await operatorWallet.connectApi();
      wsClient = operatorWallet.getWsClient();
      wsClient?.on("error", (err) => console.warn("[chatbot] WebSocket error:", err.message));
      console.log("[chatbot] API connected (operator mode)");
    } catch (err) {
      console.warn("[chatbot] API connect failed (contract-only):", (err as Error).message);
    }

    portfolio = new Portfolio(
      exchange,
      operatorWallet.publicClient,
      config.chain.exchangeAddress,
      operatorWallet.getApiClient(),
    );
    await portfolio.setAccountByAddress(config.delegatedAccountAddress);

    // Get account ID for WebSocket trigger orders
    if (wsClient) {
      try {
        const summary = await portfolio.getAccountSummary();
        wsAccountId = Number(summary.accountId);
      } catch { /* non-fatal */ }
    }

    console.log("[chatbot] SDK initialized (operator mode)");
  } else if (config.ownerPrivateKey) {
    // ── Owner-direct mode (like CLI trade.ts) ──
    mode = "owner";
    const owner = OwnerWallet.fromPrivateKey(config.ownerPrivateKey, config.chain);
    publicClient = owner.publicClient;

    // Optionally authenticate API
    let apiClient: PerplApiClient | undefined;
    if (USE_API) {
      try {
        apiClient = new PerplApiClient(API_CONFIG);
        const signMessage = async (message: string) => {
          return owner.walletClient.signMessage({
            account: owner.walletClient.account!,
            message,
          });
        };
        await apiClient.authenticate(owner.address, signMessage);
        console.log("[chatbot] API authenticated (owner mode)");
      } catch (err) {
        console.warn("[chatbot] API auth failed (contract-only):", (err as Error).message);
        apiClient = undefined;
      }
    }

    exchange = new Exchange(
      config.chain.exchangeAddress,
      owner.publicClient,
      owner.walletClient,
      undefined,
      apiClient,
    );

    portfolio = new Portfolio(
      exchange,
      owner.publicClient,
      config.chain.exchangeAddress,
      apiClient,
    );
    await portfolio.setAccountByAddress(owner.address);

    // WebSocket for trigger orders (SL/TP)
    if (apiClient) {
      try {
        const authNonce = apiClient.getAuthNonce();
        const authCookies = apiClient.getAuthCookies();
        if (authNonce) {
          wsClient = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);
          wsClient.on("error", (err) => console.warn("[chatbot] WebSocket error:", err.message));
          await wsClient.connectTrading(authNonce, authCookies || undefined);
          const summary = await portfolio.getAccountSummary();
          wsAccountId = Number(summary.accountId);
          console.log("[chatbot] WebSocket connected (owner mode)");
        }
      } catch (err) {
        console.warn("[chatbot] WebSocket connect failed:", (err as Error).message);
      }
    }

    console.log("[chatbot] SDK initialized (owner mode)");
  } else {
    throw new Error(
      "Either OPERATOR_PRIVATE_KEY + DELEGATED_ACCOUNT_ADDRESS, or OWNER_PRIVATE_KEY must be set",
    );
  }
}

// ============ Helpers for executing orders ============

async function execOrder(orderDesc: OrderDesc, nonce?: number): Promise<Hash> {
  return exchange.execOrder(orderDesc, nonce);
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
  const perpIds = ALL_PERP_IDS as unknown as bigint[];
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
  const markets = await portfolio.getAvailableMarkets(ALL_PERP_IDS as unknown as bigint[]);
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
  const orders = await portfolio.getAllOpenOrders(ALL_PERP_IDS as unknown as bigint[]);
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
  nonce?: number;
}) {
  const perpId = resolvePerpId(params.market);
  const perpInfo = await portfolio.getMarket(perpId);
  const pricePNS = priceToPNS(params.price, BigInt(perpInfo.priceDecimals));
  const lotLNS = lotToLNS(params.size, BigInt(perpInfo.lotDecimals));
  const leverageH = leverageToHdths(params.leverage);

  let txHash: string;

  if (mode === "operator" && operatorWallet) {
    // Operator mode — use OperatorWallet methods (supports WS fast-path)
    if (params.is_market_order) {
      if (params.side === "long") {
        txHash = String(await operatorWallet.marketOpenLong({ perpId, lotLNS, leverageHdths: leverageH, maxPricePNS: pricePNS }));
      } else {
        txHash = String(await operatorWallet.marketOpenShort({ perpId, lotLNS, leverageHdths: leverageH, minPricePNS: pricePNS }));
      }
    } else {
      if (params.side === "long") {
        txHash = await operatorWallet.openLong({ perpId, pricePNS, lotLNS, leverageHdths: leverageH, nonce: params.nonce });
      } else {
        txHash = await operatorWallet.openShort({ perpId, pricePNS, lotLNS, leverageHdths: leverageH, nonce: params.nonce });
      }
    }
  } else if (params.is_market_order && wsClient && wsAccountId !== undefined) {
    // Owner mode, market order → WS API (takes liquidity, faster matching)
    const lastBlock = Number(await publicClient.getBlockNumber()) + 1000;
    const orderType = params.side === "long" ? 1 : 2; // OpenLong : OpenShort
    const requestId = wsClient.submitOrder({
      rq: Date.now(),
      mkt: Number(perpId),
      acc: wsAccountId,
      t: orderType as never,
      p: Number(pricePNS),
      s: Number(lotLNS),
      fl: 4 as never, // IOC
      lv: Number(leverageH),
      lb: lastBlock,
    });
    return {
      success: true,
      requestId,
      route: "api",
      market: params.market.toUpperCase(),
      side: params.side,
      size: params.size,
      price: params.price,
      leverage: params.leverage,
      type: "market",
    };
  } else {
    // Owner mode, limit order → on-chain SDK (adds liquidity to book)
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
    };
    txHash = await execOrder(orderDesc, params.nonce);
  }

  return {
    success: true,
    txHash,
    market: params.market.toUpperCase(),
    side: params.side,
    size: params.size,
    price: params.price,
    leverage: params.leverage,
    type: params.is_market_order ? "market" : "limit",
  };
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

  // Use on-chain lot if no size given; otherwise convert user size
  let rawLotLNS: bigint;
  if (params.size) {
    rawLotLNS = lotToLNS(params.size, lotDecimals);
  } else {
    rawLotLNS = position.lotLNS;
  }

  // Use on-chain position type (authoritative) — user/Claude may guess wrong side
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
  let txHash: string;

  if (mode === "operator" && operatorWallet) {
    if (isMarket) {
      if (isLong) {
        txHash = String(await operatorWallet.marketCloseLong({ perpId, lotLNS: rawLotLNS, minPricePNS: pricePNS }));
      } else {
        txHash = String(await operatorWallet.marketCloseShort({ perpId, lotLNS: rawLotLNS, maxPricePNS: pricePNS }));
      }
    } else {
      if (isLong) {
        txHash = await operatorWallet.closeLong({ perpId, pricePNS, lotLNS: rawLotLNS });
      } else {
        txHash = await operatorWallet.closeShort({ perpId, pricePNS, lotLNS: rawLotLNS });
      }
    }
  } else if (isMarket && wsClient && wsAccountId !== undefined) {
    // Owner mode, market close → WS API (takes liquidity, faster matching)
    const lastBlock = Number(await publicClient.getBlockNumber()) + 1000;
    const apiOrderType = isLong ? 3 : 4; // CloseLong : CloseShort
    const requestId = wsClient.submitOrder({
      rq: Date.now(),
      mkt: Number(perpId),
      acc: wsAccountId,
      t: apiOrderType as never,
      p: Number(pricePNS),
      s: Number(rawLotLNS),
      fl: 4 as never, // IOC
      lv: 0,
      lb: lastBlock,
    });
    const closedSize = Number(rawLotLNS) / Number(10n ** lotDecimals);
    const closePrice = Number(pricePNS) / Number(10n ** priceDecimals);
    return {
      success: true,
      requestId,
      route: "api",
      market: params.market.toUpperCase(),
      side: isLong ? "long" : "short",
      size: closedSize,
      price: closePrice,
      type: "market",
    };
  } else {
    // Owner mode, limit close → on-chain SDK (adds liquidity to book)
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
      immediateOrCancel: isMarket,
      maxMatches: 0n,
      leverageHdths: 100n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };
    txHash = await execOrder(orderDesc);
  }

  const closedSize = Number(rawLotLNS) / Number(10n ** lotDecimals);
  const closePrice = Number(pricePNS) / Number(10n ** priceDecimals);

  return {
    success: true,
    txHash,
    market: params.market.toUpperCase(),
    side: isLong ? "long" : "short",
    size: closedSize,
    price: closePrice,
    type: isMarket ? "market" : "limit",
  };
}

export async function cancelOrder(market: string, orderId: string) {
  const perpId = resolvePerpId(market);

  let txHash: string;
  if (mode === "operator" && operatorWallet) {
    txHash = await operatorWallet.cancelOrder(perpId, BigInt(orderId));
  } else {
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
    };
    txHash = await execOrder(orderDesc);
  }

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
  // Fetch current nonce and manually increment per order to avoid mempool collisions
  const nonce = await publicClient.getTransactionCount({
    address: exchange.getSignerAddress(),
    blockTag: "pending",
  });
  const results = [];
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    try {
      const result = await openPosition({ ...order, nonce: nonce + i });
      results.push(result);
    } catch (err) {
      results.push({
        success: false,
        error: (err as Error).message,
        market: order.market.toUpperCase(),
        side: order.side,
        size: order.size,
        price: order.price,
      });
    }
  }
  return {
    totalOrders: orders.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
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
  // Withdrawals must go through the owner wallet — operator CANNOT withdraw (smart contract enforced)
  throw new Error(
    "Withdrawals must be done through the CLI with the owner wallet: npm run dev -- manage withdraw --amount " + amount,
  );
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

const orderRequestEvent = parseAbiItem(
  "event OrderRequest(uint256 perpId, uint256 accountId, uint256 orderDescId, uint256 orderId, uint8 orderType, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 gasLeft)",
);
const orderPlacedEvent = parseAbiItem(
  "event OrderPlaced(uint256 orderId, uint256 lotLNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)",
);
const orderCancelledEvent = parseAbiItem(
  "event OrderCancelled(uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)",
);
const makerFilledEvent = parseAbiItem(
  "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)",
);

export async function getOrderbook(market: string, depth = 10) {
  const perpId = resolvePerpId(market);
  const exchangeAddr = envConfig.chain.exchangeAddress;
  const perpInfo = await exchange.getPerpetualInfo(perpId);
  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);
  const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

  const currentBlock = await publicClient.getBlockNumber();
  const blocksToScan = 1000n;
  const startBlock = currentBlock - blocksToScan;
  const BATCH_SIZE = 100n;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placed = new Map<string, any>();
  const cancelled = new Set<string>();
  const filled = new Map<string, bigint>();

  for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
    const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

    const [reqBatch, placedBatch, cancelBatch, fillBatch] = await Promise.all([
      publicClient.getLogs({ address: exchangeAddr, event: orderRequestEvent, fromBlock, toBlock }),
      publicClient.getLogs({ address: exchangeAddr, event: orderPlacedEvent, fromBlock, toBlock }),
      publicClient.getLogs({ address: exchangeAddr, event: orderCancelledEvent, fromBlock, toBlock }),
      publicClient.getLogs({ address: exchangeAddr, event: makerFilledEvent, fromBlock, toBlock }),
    ]);

    for (const log of reqBatch) {
      if (log.args.perpId === perpId && !log.args.immediateOrCancel) {
        requests.push(log);
      }
    }
    for (const log of placedBatch) placed.set(log.transactionHash, log);
    for (const log of cancelBatch) cancelled.add(log.transactionHash);
    for (const log of fillBatch) {
      if (log.args.perpId === perpId) {
        const oid = log.args.orderId!.toString();
        filled.set(oid, (filled.get(oid) || 0n) + log.args.lotLNS!);
      }
    }
  }

  const bids = new Map<number, number>();
  const asks = new Map<number, number>();

  for (const req of requests) {
    const placedLog = placed.get(req.transactionHash);
    if (!placedLog || cancelled.has(req.transactionHash)) continue;

    const orderId = placedLog.args.orderId!.toString();
    const orderType = Number(req.args.orderType);
    const remainingLNS = placedLog.args.lotLNS! - (filled.get(orderId) || 0n);
    if (remainingLNS <= 0n) continue;

    const price = pnsToPrice(req.args.pricePNS!, priceDecimals);
    const size = lnsToLot(remainingLNS, lotDecimals);
    const isBid = orderType === 0 || orderType === 3;

    if (isBid) bids.set(price, (bids.get(price) || 0) + size);
    else asks.set(price, (asks.get(price) || 0) + size);
  }

  return {
    market: market.toUpperCase(),
    markPrice,
    bids: [...bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, depth).map(([price, size]) => ({ price, size })),
    asks: [...asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, depth).map(([price, size]) => ({ price, size })),
    totalOrders: requests.length,
    blocksScanned: Number(blocksToScan),
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
  };

  const result = await simulateTrade(envConfig, orderDesc);
  const reportAnsi = captureConsole(() =>
    printDryRunReport(result, orderDesc, perpName, priceDecimals, lotDecimals),
  );
  const data = JSON.parse(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v));
  data._report = ansiToHtml(reportAnsi);
  return data;
}
