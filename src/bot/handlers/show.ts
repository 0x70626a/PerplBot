/**
 * Show handlers - Order book and recent trades
 */

import type { BotContext } from "../types.js";
import { createPublicClient, http, parseAbiItem } from "viem";
import {
  loadEnvConfig,
  Exchange,
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
 * Fetch order book data for a market using contract view functions
 */
export async function fetchOrderBook(market: Market, depth = 10): Promise<OrderBookData> {
  const config = loadEnvConfig();
  const perpId = PERP_NAMES[market];
  const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || market.toUpperCase();

  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  const exchange = new Exchange(config.chain.exchangeAddress, publicClient);
  const perpInfo = await exchange.getPerpetualInfo(perpId);

  const priceDecimals = perpInfo.priceDecimals;
  const lotDecimals = perpInfo.lotDecimals;
  const basePNS = perpInfo.basePricePNS;
  const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

  const onsToPrice = (ons: bigint) => pnsToPrice(ons + basePNS, priceDecimals);

  // Empty book
  if (perpInfo.maxBidPriceONS === 0n && perpInfo.maxAskPriceONS === 0n) {
    return {
      symbol: perpName,
      markPrice,
      bids: [],
      asks: [],
      priceLevels: 0,
      totalOrders: Number(perpInfo.numOrders),
    };
  }

  // Walk bids downward from best bid
  async function walkBids(): Promise<Array<{ price: number; size: number }>> {
    const levels: Array<{ price: number; size: number }> = [];
    let currentONS = perpInfo.maxBidPriceONS;
    if (currentONS === 0n) return levels;

    while (levels.length < depth && currentONS > 0n) {
      const [volume, nextONS] = await Promise.all([
        exchange.getVolumeAtBookPrice(perpId, currentONS),
        exchange.getNextPriceBelowWithOrders(perpId, currentONS),
      ]);
      if (volume.bids > 0n) {
        levels.push({
          price: onsToPrice(currentONS),
          size: lnsToLot(volume.bids, lotDecimals),
        });
      }
      currentONS = nextONS;
    }
    return levels;
  }

  // Walk asks downward from worst ask, collect all, take closest to spread
  async function walkAsks(): Promise<Array<{ price: number; size: number }>> {
    const allLevels: Array<{ price: number; size: number }> = [];
    let currentONS = perpInfo.maxAskPriceONS;
    if (currentONS === 0n) return allLevels;

    let hops = 0;
    while (currentONS > 0n && hops < 200) {
      const [volume, nextONS] = await Promise.all([
        exchange.getVolumeAtBookPrice(perpId, currentONS),
        exchange.getNextPriceBelowWithOrders(perpId, currentONS),
      ]);
      if (volume.asks > 0n) {
        allLevels.push({
          price: onsToPrice(currentONS),
          size: lnsToLot(volume.asks, lotDecimals),
        });
      }
      currentONS = nextONS;
      hops++;
    }
    // allLevels is worst-to-best (descending price); take last `depth` = closest to spread
    const trimmed = allLevels.slice(-depth);
    // Return lowest-to-highest for display
    return trimmed.reverse();
  }

  const [bidLevels, askLevels] = await Promise.all([walkBids(), walkAsks()]);

  // Compute spread
  let spread: { price: number; percent: number } | undefined;
  if (bidLevels.length > 0 && askLevels.length > 0) {
    const bestBid = bidLevels[0].price;
    const bestAsk = askLevels[askLevels.length - 1].price;
    const spreadPrice = bestAsk - bestBid;
    const spreadPct = (spreadPrice / ((bestAsk + bestBid) / 2)) * 100;
    spread = { price: spreadPrice, percent: spreadPct };
  }

  return {
    symbol: perpName,
    markPrice,
    bids: bidLevels,
    asks: askLevels,
    spread,
    priceLevels: bidLevels.length + askLevels.length,
    totalOrders: Number(perpInfo.numOrders),
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
