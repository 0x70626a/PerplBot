/**
 * Show handlers - Order book and recent trades
 */

import type { BotContext } from "../types.js";
import { createPublicClient, http, parseAbiItem } from "viem";
import {
  loadEnvConfig,
  PERPETUALS,
  pnsToPrice,
  lnsToLot,
} from "../../sdk/index.js";
import type { Market } from "../../cli/tradeParser.js";
import {
  formatOrderBook,
  formatRecentTrades,
  formatError,
  type OrderBookData,
  type RecentTrade,
} from "../formatters/telegram.js";

// Market name to ID mapping
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
};

const PERP_IDS_TO_NAMES: Record<string, string> = {
  "16": "BTC",
  "32": "ETH",
  "48": "SOL",
  "64": "MON",
  "256": "ZEC",
};

/**
 * Fetch order book data for a market
 */
export async function fetchOrderBook(market: Market): Promise<OrderBookData> {
  const config = loadEnvConfig();
  const perpId = PERP_NAMES[market];
  const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || market.toUpperCase();

  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  const exchange = config.chain.exchangeAddress;

  // Get perpetual info for decimals
  const perpInfo = await publicClient.readContract({
    address: exchange,
    abi: [{
      type: "function",
      name: "getPerpetualInfo",
      inputs: [{ name: "perpId", type: "uint256" }],
      outputs: [{
        name: "perpetualInfo",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "priceDecimals", type: "uint256" },
          { name: "lotDecimals", type: "uint256" },
          { name: "linkFeedId", type: "bytes32" },
          { name: "priceTolPer100K", type: "uint256" },
          { name: "refPriceMaxAgeSec", type: "uint256" },
          { name: "positionBalanceCNS", type: "uint256" },
          { name: "insuranceBalanceCNS", type: "uint256" },
          { name: "markPNS", type: "uint256" },
          { name: "markTimestamp", type: "uint256" },
          { name: "lastPNS", type: "uint256" },
          { name: "lastTimestamp", type: "uint256" },
          { name: "oraclePNS", type: "uint256" },
          { name: "oracleTimestampSec", type: "uint256" },
          { name: "longOpenInterestLNS", type: "uint256" },
          { name: "shortOpenInterestLNS", type: "uint256" },
          { name: "fundingStartBlock", type: "uint256" },
          { name: "fundingRatePct100k", type: "int16" },
          { name: "synthPerpPricePNS", type: "uint256" },
          { name: "absFundingClampPctPer100K", type: "uint256" },
          { name: "paused", type: "bool" },
          { name: "basePricePNS", type: "uint256" },
          { name: "maxBidPriceONS", type: "uint256" },
          { name: "minBidPriceONS", type: "uint256" },
          { name: "maxAskPriceONS", type: "uint256" },
          { name: "minAskPriceONS", type: "uint256" },
          { name: "numOrders", type: "uint256" },
          { name: "ignOracle", type: "bool" },
        ],
      }],
      stateMutability: "view",
    }],
    functionName: "getPerpetualInfo",
    args: [perpId],
  }) as any;

  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);
  const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

  // Scan recent blocks for orders
  const currentBlock = await publicClient.getBlockNumber();
  const blocksToScan = 1000n;
  const startBlock = currentBlock - blocksToScan;

  const orderRequestEvent = parseAbiItem(
    "event OrderRequest(uint256 perpId, uint256 accountId, uint256 orderDescId, uint256 orderId, uint8 orderType, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 gasLeft)"
  );
  const orderPlacedEvent = parseAbiItem(
    "event OrderPlaced(uint256 orderId, uint256 lotLNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
  );
  const orderCancelledEvent = parseAbiItem(
    "event OrderCancelled(uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
  );
  const makerFilledEvent = parseAbiItem(
    "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
  );

  const BATCH_SIZE = 100n;
  const requests: any[] = [];
  const placed: Map<string, any> = new Map();
  const cancelled: Set<string> = new Set();
  const filled: Map<string, bigint> = new Map();

  for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
    const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

    const [reqBatch, placedBatch, cancelBatch, fillBatch] = await Promise.all([
      publicClient.getLogs({
        address: exchange,
        event: orderRequestEvent,
        fromBlock,
        toBlock,
      }),
      publicClient.getLogs({
        address: exchange,
        event: orderPlacedEvent,
        fromBlock,
        toBlock,
      }),
      publicClient.getLogs({
        address: exchange,
        event: orderCancelledEvent,
        fromBlock,
        toBlock,
      }),
      publicClient.getLogs({
        address: exchange,
        event: makerFilledEvent,
        fromBlock,
        toBlock,
      }),
    ]);

    for (const log of reqBatch) {
      if (log.args.perpId === perpId && !log.args.immediateOrCancel) {
        requests.push(log);
      }
    }

    for (const log of placedBatch) {
      placed.set(log.transactionHash, log);
    }

    for (const log of cancelBatch) {
      cancelled.add(log.transactionHash);
    }

    for (const log of fillBatch) {
      if (log.args.perpId === perpId) {
        const orderId = log.args.orderId!.toString();
        const prevFilled = filled.get(orderId) || 0n;
        filled.set(orderId, prevFilled + log.args.lotLNS!);
      }
    }
  }

  // Build orderbook
  const bids: Map<number, number> = new Map();
  const asks: Map<number, number> = new Map();

  for (const req of requests) {
    const txHash = req.transactionHash;
    const placedLog = placed.get(txHash);

    if (!placedLog || cancelled.has(txHash)) continue;

    const orderId = placedLog.args.orderId!.toString();
    const orderType = Number(req.args.orderType);
    const pricePNS = req.args.pricePNS!;
    const lotLNS = placedLog.args.lotLNS!;
    const filledLNS = filled.get(orderId) || 0n;
    const remainingLNS = lotLNS - filledLNS;

    if (remainingLNS <= 0n) continue;

    const price = pnsToPrice(pricePNS, priceDecimals);
    const size = lnsToLot(remainingLNS, lotDecimals);

    // OrderType: 0=OpenLong (bid), 1=OpenShort (ask), 2=CloseLong (ask), 3=CloseShort (bid)
    const isBid = orderType === 0 || orderType === 3;

    if (isBid) {
      bids.set(price, (bids.get(price) || 0) + size);
    } else {
      asks.set(price, (asks.get(price) || 0) + size);
    }
  }

  const sortedBids = [...bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, 10);
  const sortedAsks = [...asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10);

  return {
    symbol: perpName,
    markPrice,
    bids: sortedBids.map(([price, size]) => ({ price, size })),
    asks: sortedAsks.map(([price, size]) => ({ price, size })),
    blocksScanned: Number(blocksToScan),
    ordersFound: requests.length,
  };
}

/**
 * Handle order book request
 */
export async function handleOrderBook(ctx: BotContext, market: Market): Promise<void> {
  try {
    await ctx.reply(`Fetching ${market.toUpperCase()} order book...`);

    const book = await fetchOrderBook(market);
    const message = formatOrderBook(book);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}

/**
 * Fetch recent trades for a market
 */
export async function fetchRecentTrades(market: Market, limit = 20): Promise<{
  symbol: string;
  trades: RecentTrade[];
  blocksScanned: number;
}> {
  const config = loadEnvConfig();
  const perpId = PERP_NAMES[market];
  const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || market.toUpperCase();

  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  const exchange = config.chain.exchangeAddress;

  // Get perpetual info for decimals
  const perpInfo = await publicClient.readContract({
    address: exchange,
    abi: [{
      type: "function",
      name: "getPerpetualInfo",
      inputs: [{ name: "perpId", type: "uint256" }],
      outputs: [{
        name: "perpetualInfo",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "priceDecimals", type: "uint256" },
          { name: "lotDecimals", type: "uint256" },
          { name: "linkFeedId", type: "bytes32" },
          { name: "priceTolPer100K", type: "uint256" },
          { name: "refPriceMaxAgeSec", type: "uint256" },
          { name: "positionBalanceCNS", type: "uint256" },
          { name: "insuranceBalanceCNS", type: "uint256" },
          { name: "markPNS", type: "uint256" },
          { name: "markTimestamp", type: "uint256" },
          { name: "lastPNS", type: "uint256" },
          { name: "lastTimestamp", type: "uint256" },
          { name: "oraclePNS", type: "uint256" },
          { name: "oracleTimestampSec", type: "uint256" },
          { name: "longOpenInterestLNS", type: "uint256" },
          { name: "shortOpenInterestLNS", type: "uint256" },
          { name: "fundingStartBlock", type: "uint256" },
          { name: "fundingRatePct100k", type: "int16" },
          { name: "synthPerpPricePNS", type: "uint256" },
          { name: "absFundingClampPctPer100K", type: "uint256" },
          { name: "paused", type: "bool" },
          { name: "basePricePNS", type: "uint256" },
          { name: "maxBidPriceONS", type: "uint256" },
          { name: "minBidPriceONS", type: "uint256" },
          { name: "maxAskPriceONS", type: "uint256" },
          { name: "minAskPriceONS", type: "uint256" },
          { name: "numOrders", type: "uint256" },
          { name: "ignOracle", type: "bool" },
        ],
      }],
      stateMutability: "view",
    }],
    functionName: "getPerpetualInfo",
    args: [perpId],
  }) as any;

  const priceDecimals = BigInt(perpInfo.priceDecimals);
  const lotDecimals = BigInt(perpInfo.lotDecimals);

  // Scan recent blocks for fills
  const currentBlock = await publicClient.getBlockNumber();
  const blocksToScan = 2000n;
  const startBlock = currentBlock - blocksToScan;

  const makerFilledEvent = parseAbiItem(
    "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
  );

  const BATCH_SIZE = 100n;
  const trades: RecentTrade[] = [];

  for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
    const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

    const fillBatch = await publicClient.getLogs({
      address: exchange,
      event: makerFilledEvent,
      fromBlock,
      toBlock,
    });

    for (const log of fillBatch) {
      if (log.args.perpId === perpId) {
        trades.push({
          blockNumber: log.blockNumber,
          price: pnsToPrice(log.args.pricePNS!, priceDecimals),
          size: lnsToLot(log.args.lotLNS!, lotDecimals),
          makerAccountId: log.args.accountId!,
        });
      }
    }
  }

  // Sort by block (newest first) and limit
  trades.sort((a, b) => Number(b.blockNumber - a.blockNumber));

  return {
    symbol: perpName,
    trades: trades.slice(0, limit),
    blocksScanned: Number(blocksToScan),
  };
}

/**
 * Handle recent trades request
 */
export async function handleRecentTrades(ctx: BotContext, market: Market): Promise<void> {
  try {
    await ctx.reply(`Fetching recent ${market.toUpperCase()} trades...`);

    const { symbol, trades, blocksScanned } = await fetchRecentTrades(market);
    const message = formatRecentTrades(symbol, trades, blocksScanned);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
