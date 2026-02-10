/**
 * Show command - Display orderbook, recent trades, and liquidation analysis
 */

import type { Command } from "commander";
import { createPublicClient, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadEnvConfig,
  validateOwnerConfig,
  Exchange,
  HybridClient,
  PERPETUALS,
  pnsToPrice,
  lnsToLot,
  simulateLiquidation,
  printLiquidationReport,
  simulateForkLiquidation,
  printForkLiquidationReport,
} from "../sdk/index.js";

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

function resolvePerpId(perp: string): bigint {
  const lower = perp.toLowerCase();
  if (PERP_NAMES[lower] !== undefined) {
    return PERP_NAMES[lower];
  }
  const parsed = parseInt(perp, 10);
  if (!isNaN(parsed)) {
    return BigInt(parsed);
  }
  throw new Error(`Unknown perpetual: ${perp}`);
}

export function registerShowCommand(program: Command): void {
  const show = program
    .command("show")
    .description("Show live exchange state");

  // Show orderbook
  show
    .command("book")
    .description("Show order book for a market")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .option("--depth <n>", "Number of price levels to show", "10")
    .action(async (options) => {
      const config = loadEnvConfig();

      const publicClient = createPublicClient({
        chain: config.chain.chain,
        transport: http(config.chain.rpcUrl),
      });

      const perpId = resolvePerpId(options.perp);
      const depth = parseInt(options.depth, 10);
      const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || options.perp.toUpperCase();

      console.log(`Fetching ${perpName} order book...`);

      const exchangeAddr = config.chain.exchangeAddress;
      const exchange = new Exchange(exchangeAddr, publicClient);
      const perpInfo = await exchange.getPerpetualInfo(perpId);

      const priceDecimals = perpInfo.priceDecimals;
      const lotDecimals = perpInfo.lotDecimals;
      const basePNS = perpInfo.basePricePNS;
      const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

      const onsToPrice = (ons: bigint) => pnsToPrice(ons + basePNS, priceDecimals);

      // Check for empty book
      if (perpInfo.maxBidPriceONS === 0n && perpInfo.maxAskPriceONS === 0n) {
        console.log(`\n=== ${perpName} Order Book ===`);
        console.log(`Mark Price: $${markPrice.toFixed(2)}\n`);
        console.log("  (No resting orders)");
        console.log(`\n${perpInfo.numOrders} total orders`);
        return;
      }

      // Walk bids downward from best bid (maxBidPriceONS)
      async function walkBids(): Promise<Array<{ price: number; size: number; ons: bigint }>> {
        const levels: Array<{ price: number; size: number; ons: bigint }> = [];
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
              ons: currentONS,
            });
          }
          currentONS = nextONS;
        }
        return levels;
      }

      // Walk asks downward from worst ask (maxAskPriceONS), collect all, take closest to spread
      async function walkAsks(): Promise<Array<{ price: number; size: number; ons: bigint }>> {
        const allLevels: Array<{ price: number; size: number; ons: bigint }> = [];
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
              ons: currentONS,
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
      let spreadInfo = "";
      if (bidLevels.length > 0 && askLevels.length > 0) {
        const bestBid = bidLevels[0].price;
        const bestAsk = askLevels[askLevels.length - 1].price;
        const spreadPrice = bestAsk - bestBid;
        const spreadPct = (spreadPrice / ((bestAsk + bestBid) / 2)) * 100;
        spreadInfo = `  Spread: $${spreadPrice.toFixed(2)} (${spreadPct.toFixed(3)}%)`;
      }

      console.log(`\n=== ${perpName} Order Book ===`);
      console.log(`Mark Price: $${markPrice.toFixed(2)}\n`);

      console.log("         Price          Size");
      console.log("─────────────────────────────");

      // Asks: display high-to-low (askLevels is already low-to-high, reverse for display)
      for (const level of askLevels) {
        console.log(`  ASK    $${level.price.toFixed(2).padStart(10)}    ${level.size.toFixed(6)}`);
      }

      console.log(`  ────── $${markPrice.toFixed(2).padStart(10)} ──────`);

      // Bids: display high-to-low (already in that order)
      for (const level of bidLevels) {
        console.log(`  BID    $${level.price.toFixed(2).padStart(10)}    ${level.size.toFixed(6)}`);
      }

      if (bidLevels.length === 0 && askLevels.length === 0) {
        console.log("\n  (No resting orders)");
      }

      if (spreadInfo) {
        console.log(spreadInfo);
      }
      console.log(`\n${bidLevels.length + askLevels.length} price levels, ${perpInfo.numOrders} total orders`);
    });

  // Show recent trades
  show
    .command("trades")
    .description("Show recent trades for a market")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .option("--limit <n>", "Number of trades to show", "20")
    .action(async (options) => {
      const config = loadEnvConfig();

      const publicClient = createPublicClient({
        chain: config.chain.chain,
        transport: http(config.chain.rpcUrl),
      });

      const perpId = resolvePerpId(options.perp);
      const limit = parseInt(options.limit, 10);
      const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || options.perp.toUpperCase();

      console.log(`Fetching recent ${perpName} trades...`);

      // Get perpetual info for decimals
      const exchangeAddr = config.chain.exchangeAddress;
      const exchange = new Exchange(exchangeAddr, publicClient);
      const client = new HybridClient({ exchange });
      const perpInfo = await client.getPerpetualInfo(perpId);

      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      // Scan recent blocks for fills (limited to reduce RPC calls)
      const currentBlock = await publicClient.getBlockNumber();
      const blocksToScan = 2000n;
      const startBlock = currentBlock - blocksToScan;

      const makerFilledEvent = parseAbiItem(
        "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
      );

      const BATCH_SIZE = 100n;
      const trades: any[] = [];

      console.log("Scanning recent blocks for trades...");

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
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              price: pnsToPrice(log.args.pricePNS!, priceDecimals),
              size: lnsToLot(log.args.lotLNS!, lotDecimals),
              makerAccountId: log.args.accountId,
              orderId: log.args.orderId,
            });
          }
        }
      }

      // Sort by block (newest first) and limit
      trades.sort((a, b) => Number(b.blockNumber - a.blockNumber));
      const recentTrades = trades.slice(0, limit);

      console.log(`\n=== Recent ${perpName} Trades ===\n`);
      console.log("Block       Price          Size       Maker    Order");
      console.log("─────────────────────────────────────────────────────");

      if (recentTrades.length === 0) {
        console.log("  (No trades found in recent blocks)");
      } else {
        for (const trade of recentTrades) {
          const block = trade.blockNumber.toString().padStart(8);
          const price = `$${trade.price.toFixed(2)}`.padStart(12);
          const size = trade.size.toFixed(6).padStart(10);
          const maker = trade.makerAccountId.toString().padStart(6);
          const order = trade.orderId.toString().padStart(6);
          console.log(`${block}  ${price}  ${size}  ${maker}  ${order}`);
        }
      }

      console.log(`\nScanned ${blocksToScan} blocks, found ${trades.length} trades`);
    });

  // Show liquidation analysis
  show
    .command("liquidation")
    .alias("liq")
    .description("Simulate liquidation scenarios for your position")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .option("--range <pct>", "Price range to sweep (%)", "30")
    .option("--funding <hours>", "Funding projection hours", "24")
    .option("--fork", "Use fork-based simulation (requires Anvil)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const publicClient = createPublicClient({
        chain: config.chain.chain,
        transport: http(config.chain.rpcUrl),
      });

      const perpId = resolvePerpId(options.perp);
      const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || options.perp.toUpperCase();
      const exchangeAddr = config.chain.exchangeAddress;
      const exchange = new Exchange(exchangeAddr, publicClient);

      // Get account
      const account = privateKeyToAccount(config.ownerPrivateKey!);
      const accountInfo = await exchange.getAccountByAddress(account.address);
      if (accountInfo.accountId === 0n) {
        console.error("No exchange account found for this wallet.");
        process.exit(1);
      }

      // Get position
      const { position } = await exchange.getPosition(perpId, accountInfo.accountId);
      if (position.lotLNS === 0n) {
        console.error(`No open ${perpName} position.`);
        process.exit(1);
      }

      // Get perp info
      const perpInfo = await exchange.getPerpetualInfo(perpId);

      // Always run pure-math simulation (fast)
      const result = simulateLiquidation(
        perpId,
        position,
        perpInfo,
        perpName,
        {
          priceRangePct: parseInt(options.range, 10),
          fundingHours: parseInt(options.funding, 10),
        },
      );

      if (options.fork) {
        // Fork-based simulation: verify on-chain
        console.log("Starting fork-based liquidation simulation...");
        const forkResult = await simulateForkLiquidation(
          config,
          perpId,
          perpName,
          position,
          perpInfo,
          accountInfo.accountId,
          { priceRangePct: parseInt(options.range, 10) },
        );
        printForkLiquidationReport(forkResult);
      } else {
        printLiquidationReport(result);
      }
    });
}
