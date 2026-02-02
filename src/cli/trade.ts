/**
 * Trade command - Execute trades as an operator
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateOperatorConfig,
  OperatorWallet,
  Exchange,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
} from "../sdk/index.js";

// Market name to ID mapping (IDs from dex-sdk testnet config)
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,   // 16
  eth: PERPETUALS.ETH,   // 32
  sol: PERPETUALS.SOL,   // 48
  mon: PERPETUALS.MON,   // 64
  zec: PERPETUALS.ZEC,   // 256
};

function resolvePerpId(perp: string): bigint {
  const lower = perp.toLowerCase();
  if (PERP_NAMES[lower] !== undefined) {
    return PERP_NAMES[lower];
  }
  // Try to parse as number
  const parsed = parseInt(perp, 10);
  if (!isNaN(parsed)) {
    return BigInt(parsed);
  }
  throw new Error(`Unknown perpetual: ${perp}. Use btc (16), eth (32), sol (48), mon (64), zec (256), or a numeric ID.`);
}

export function registerTradeCommand(program: Command): void {
  const trade = program
    .command("trade")
    .description("Execute trades as an operator");

  // Open position
  trade
    .command("open")
    .description("Open a new position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, or ID)")
    .requiredOption("--side <side>", "Position side (long or short)")
    .requiredOption("--size <amount>", "Position size")
    .requiredOption("--price <price>", "Limit price")
    .option("--leverage <multiplier>", "Leverage multiplier", "1")
    .option("--post-only", "Make order post-only (maker only)")
    .option("--ioc", "Immediate-or-cancel order")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOperatorConfig(config);

      const operator = OperatorWallet.fromPrivateKey(
        config.operatorPrivateKey,
        config.chain
      );

      operator.connect(
        config.chain.exchangeAddress,
        config.delegatedAccountAddress
      );

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);
      const leverage = parseFloat(options.leverage);

      // Fetch perpetual info to get correct decimals for this market
      const exchange = new Exchange(config.chain.exchangeAddress, operator.publicClient);
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Opening ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);
      console.log(`  Leverage: ${leverage}x`);

      try {
        let txHash: string;

        if (side === "long") {
          txHash = await operator.openLong({
            perpId,
            pricePNS: priceToPNS(price, priceDecimals),
            lotLNS: lotToLNS(size, lotDecimals),
            leverageHdths: leverageToHdths(leverage),
            postOnly: options.postOnly ?? false,
            immediateOrCancel: options.ioc ?? false,
          });
        } else if (side === "short") {
          txHash = await operator.openShort({
            perpId,
            pricePNS: priceToPNS(price, priceDecimals),
            lotLNS: lotToLNS(size, lotDecimals),
            leverageHdths: leverageToHdths(leverage),
            postOnly: options.postOnly ?? false,
            immediateOrCancel: options.ioc ?? false,
          });
        } else {
          console.error("Side must be 'long' or 'short'");
          process.exit(1);
        }

        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Trade failed:", error);
        process.exit(1);
      }
    });

  // Close position
  trade
    .command("close")
    .description("Close an existing position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, or ID)")
    .requiredOption("--side <side>", "Position side to close (long or short)")
    .requiredOption("--size <amount>", "Size to close")
    .requiredOption("--price <price>", "Limit price")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOperatorConfig(config);

      const operator = OperatorWallet.fromPrivateKey(
        config.operatorPrivateKey,
        config.chain
      );

      operator.connect(
        config.chain.exchangeAddress,
        config.delegatedAccountAddress
      );

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);

      // Fetch perpetual info to get correct decimals for this market
      const exchange = new Exchange(config.chain.exchangeAddress, operator.publicClient);
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Closing ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);

      try {
        let txHash: string;

        if (side === "long") {
          txHash = await operator.closeLong({
            perpId,
            pricePNS: priceToPNS(price, priceDecimals),
            lotLNS: lotToLNS(size, lotDecimals),
          });
        } else if (side === "short") {
          txHash = await operator.closeShort({
            perpId,
            pricePNS: priceToPNS(price, priceDecimals),
            lotLNS: lotToLNS(size, lotDecimals),
          });
        } else {
          console.error("Side must be 'long' or 'short'");
          process.exit(1);
        }

        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Close failed:", error);
        process.exit(1);
      }
    });

  // Cancel order
  trade
    .command("cancel")
    .description("Cancel an existing order")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, or ID)")
    .requiredOption("--order-id <id>", "Order ID to cancel")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOperatorConfig(config);

      const operator = OperatorWallet.fromPrivateKey(
        config.operatorPrivateKey,
        config.chain
      );

      operator.connect(
        config.chain.exchangeAddress,
        config.delegatedAccountAddress
      );

      const perpId = resolvePerpId(options.perp);
      const orderId = BigInt(options.orderId);

      console.log(`Cancelling order ${orderId} on perp ${perpId}...`);

      try {
        const txHash = await operator.cancelOrder(perpId, orderId);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Cancel failed:", error);
        process.exit(1);
      }
    });

  // Cancel all orders by scanning events
  trade
    .command("cancel-all")
    .description("Cancel all open orders on a market (scans recent events)")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec, or ID)")
    .option("--blocks <num>", "Number of recent blocks to scan for orders", "1000")
    .action(async (options) => {
      const { parseAbiItem } = await import("viem");
      const config = loadEnvConfig();
      validateOperatorConfig(config);

      const operator = OperatorWallet.fromPrivateKey(
        config.operatorPrivateKey,
        config.chain
      );

      operator.connect(
        config.chain.exchangeAddress,
        config.delegatedAccountAddress
      );

      // Get our account ID
      const { DelegatedAccount } = await import("../sdk/index.js");
      const delegatedAccount = new DelegatedAccount(
        config.delegatedAccountAddress,
        operator.publicClient
      );
      const accountId = await delegatedAccount.getAccountId();

      const perpId = resolvePerpId(options.perp);
      const blocksToScan = BigInt(options.blocks);

      console.log(`Scanning last ${blocksToScan} blocks for orders on perp ${perpId}...`);
      console.log(`Account ID: ${accountId}`);

      // Get current block
      const currentBlock = await operator.publicClient.getBlockNumber();
      const startBlock = currentBlock - blocksToScan;

      // We need to correlate OrderRequest (which has accountId) with OrderPlaced (which has orderId)
      // They occur in the same transaction, so we scan for both and match by tx hash
      const orderRequestEvent = parseAbiItem(
        "event OrderRequest(uint256 perpId, uint256 accountId, uint256 orderDescId, uint256 orderId, uint8 orderType, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 gasLeft)"
      );
      const orderPlacedEvent = parseAbiItem(
        "event OrderPlaced(uint256 orderId, uint256 lotLNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)"
      );

      const BATCH_SIZE = 100n;
      const requestLogs: any[] = [];
      const placedLogs: any[] = [];

      console.log("Scanning events...");
      for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += BATCH_SIZE) {
        const toBlock = fromBlock + BATCH_SIZE - 1n > currentBlock ? currentBlock : fromBlock + BATCH_SIZE - 1n;

        const [reqBatch, placedBatch] = await Promise.all([
          operator.publicClient.getLogs({
            address: config.chain.exchangeAddress,
            event: orderRequestEvent,
            fromBlock,
            toBlock,
          }),
          operator.publicClient.getLogs({
            address: config.chain.exchangeAddress,
            event: orderPlacedEvent,
            fromBlock,
            toBlock,
          }),
        ]);
        requestLogs.push(...reqBatch);
        placedLogs.push(...placedBatch);
      }

      // Filter OrderRequest for our account, perp, and resting orders
      const ourRequests = requestLogs.filter(
        (log) =>
          log.args.accountId === accountId &&
          log.args.perpId === perpId &&
          (log.args.orderType === 0 || log.args.orderType === 1) && // OpenLong or OpenShort
          !log.args.immediateOrCancel // Only resting orders
      );

      if (ourRequests.length === 0) {
        console.log("No open orders found in recent blocks.");
        return;
      }

      // Match OrderRequest with OrderPlaced by transaction hash to get actual order IDs
      const txHashes = new Set(ourRequests.map((log) => log.transactionHash));
      const orderIds = placedLogs
        .filter((log) => txHashes.has(log.transactionHash) && log.args.orderId! > 0n)
        .map((log) => log.args.orderId!);

      // Dedupe
      const uniqueOrderIds = [...new Set(orderIds)];
      if (uniqueOrderIds.length === 0) {
        console.log("No order IDs found (orders may have been filled or cancelled).");
        return;
      }

      console.log(`Found ${uniqueOrderIds.length} order(s) to cancel: ${uniqueOrderIds.join(", ")}`);

      // Cancel each order
      let cancelled = 0;
      for (const orderId of uniqueOrderIds) {
        try {
          console.log(`Cancelling order ${orderId}...`);
          const txHash = await operator.cancelOrder(perpId, orderId);
          console.log(`  Tx: ${txHash}`);
          cancelled++;
        } catch (e: any) {
          console.log(`  Failed: ${e.shortMessage || e.message}`);
        }
      }

      console.log(`\nCancelled ${cancelled}/${uniqueOrderIds.length} orders.`);
    });
}
