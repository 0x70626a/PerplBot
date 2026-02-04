/**
 * Markets handler - /markets command
 * Shows available markets with prices and funding rates
 */

import type { BotContext } from "../types.js";
import {
  ALL_PERP_IDS,
  pnsToPrice,
  lnsToLot,
} from "../../sdk/index.js";
import {
  formatMarkets,
  formatError,
  type MarketData,
} from "../formatters/telegram.js";
import { createHybridClient } from "../client.js";

/**
 * Fetch market data for all perpetuals
 */
export async function fetchMarketData(): Promise<MarketData[]> {
  console.log("[MARKETS] Creating HybridClient...");
  const client = await createHybridClient({ authenticate: false });

  const markets: MarketData[] = [];

  for (const perpId of ALL_PERP_IDS) {
    try {
      const info = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(info.priceDecimals);
      const lotDecimals = BigInt(info.lotDecimals);

      const markPrice = pnsToPrice(info.markPNS, priceDecimals);
      const oraclePrice = pnsToPrice(info.oraclePNS, priceDecimals);
      const fundingRate = info.fundingRatePct100k / 100000;
      const longOI = lnsToLot(info.longOpenInterestLNS, lotDecimals);
      const shortOI = lnsToLot(info.shortOpenInterestLNS, lotDecimals);

      markets.push({
        symbol: info.symbol,
        markPrice,
        oraclePrice,
        fundingRate,
        longOI,
        shortOI,
        paused: info.paused,
      });
    } catch {
      // Market doesn't exist or error fetching - skip
    }
  }

  return markets;
}

/**
 * Handle /markets command
 */
export async function handleMarkets(ctx: BotContext): Promise<void> {
  try {
    await ctx.reply("Fetching market data...");

    const markets = await fetchMarketData();
    const message = formatMarkets(markets);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error occurred";
    await ctx.reply(formatError(errorMsg), { parse_mode: "MarkdownV2" });
  }
}
