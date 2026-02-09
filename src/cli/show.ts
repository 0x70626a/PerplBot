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

      // Get perpetual info for decimals
      const exchangeAddr = config.chain.exchangeAddress;
      const exchange = new Exchange(exchangeAddr, publicClient);
      const client = new HybridClient({ exchange });
      const perpInfo = await client.getPerpetualInfo(perpId);

      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);
      const markPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);

      // Scan recent blocks for orders (limited to reduce RPC calls)
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

      // Collect events (Monad testnet limits eth_getLogs to 100 blocks)
      const BATCH_SIZE = 100n;
      const requests: any[] = [];
      const placed: Map<string, any> = new Map();
      const cancelled: Set<string> = new Set();
      const filled: Map<string, bigint> = new Map(); // orderId -> filled amount

      console.log("Scanning recent blocks for orders...");

      for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
        const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

        const [reqBatch, placedBatch, cancelBatch, fillBatch] = await Promise.all([
          publicClient.getLogs({
            address: exchangeAddr,
            event: orderRequestEvent,
            fromBlock,
            toBlock,
          }),
          publicClient.getLogs({
            address: exchangeAddr,
            event: orderPlacedEvent,
            fromBlock,
            toBlock,
          }),
          publicClient.getLogs({
            address: exchangeAddr,
            event: orderCancelledEvent,
            fromBlock,
            toBlock,
          }),
          publicClient.getLogs({
            address: exchangeAddr,
            event: makerFilledEvent,
            fromBlock,
            toBlock,
          }),
        ]);

        // Filter requests for this perp, non-IOC orders
        for (const log of reqBatch) {
          if (log.args.perpId === perpId && !log.args.immediateOrCancel) {
            requests.push(log);
          }
        }

        // Track placed orders by tx hash
        for (const log of placedBatch) {
          placed.set(log.transactionHash, log);
        }

        // Track cancellations by tx hash
        for (const log of cancelBatch) {
          cancelled.add(log.transactionHash);
        }

        // Track fills
        for (const log of fillBatch) {
          if (log.args.perpId === perpId) {
            const orderId = log.args.orderId!.toString();
            const prevFilled = filled.get(orderId) || 0n;
            filled.set(orderId, prevFilled + log.args.lotLNS!);
          }
        }
      }

      // Build orderbook: aggregate by price level
      const bids: Map<number, number> = new Map(); // price -> size
      const asks: Map<number, number> = new Map();

      for (const req of requests) {
        const txHash = req.transactionHash;
        const placedLog = placed.get(txHash);

        // Skip if not placed or was cancelled
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

      // Sort and display
      const sortedBids = [...bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, depth);
      const sortedAsks = [...asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, depth);

      console.log(`\n=== ${perpName} Order Book ===`);
      console.log(`Mark Price: $${markPrice.toFixed(2)}\n`);

      // Display asks (top to bottom = high to low price)
      console.log("         Price          Size");
      console.log("─────────────────────────────");

      for (const [price, size] of sortedAsks.reverse()) {
        console.log(`  ASK    $${price.toFixed(2).padStart(10)}    ${size.toFixed(6)}`);
      }

      console.log(`  ────── $${markPrice.toFixed(2).padStart(10)} ──────`);

      for (const [price, size] of sortedBids) {
        console.log(`  BID    $${price.toFixed(2).padStart(10)}    ${size.toFixed(6)}`);
      }

      if (sortedBids.length === 0 && sortedAsks.length === 0) {
        console.log("\n  (No resting orders found in recent blocks)");
      }

      console.log(`\nScanned ${blocksToScan} blocks, found ${requests.length} order requests`);
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
