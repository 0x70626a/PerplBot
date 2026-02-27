/**
 * Trade command - Direct trading on Exchange
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateConfig,
  Wallet,
  Exchange,
  HybridClient,
  PERPETUALS,
  ALL_PERP_IDS,
  priceToPNS,
  pnsToPrice,
  lotToLNS,
  leverageToHdths,
  amountToCNS,
  simulateTrade,
  printDryRunReport,
} from "../sdk/index.js";
import { OrderType, type OrderDesc } from "../sdk/contracts/Exchange.js";

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

export function registerTradeCommand(program: Command): void {
  const trade = program
    .command("trade")
    .description("Execute trades");

  // Open position
  trade
    .command("open")
    .description("Open a new position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side (long or short)")
    .requiredOption("--size <amount>", "Position size")
    .requiredOption("--price <price>", "Limit price or 'market' for market order")
    .option("--leverage <multiplier>", "Leverage multiplier", "1")
    .option("--ioc", "Immediate-or-cancel order (market order)")
    .option("--slippage <percent>", "Slippage tolerance for market orders", "1")
    .option("--dry-run", "Simulate trade on forked chain without sending")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const leverage = parseFloat(options.leverage);
      const slippage = parseFloat(options.slippage) / 100; // Convert to decimal

      // Get perpetual info for decimals
      const perpInfo = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      // Handle market price
      const isMarketOrder = options.price.toLowerCase() === "market";
      let price: number;
      let isIoc = options.ioc ?? false;

      if (isMarketOrder) {
        // Fetch current mark price
        const accountInfo = await client.getAccountByAddress(wallet.address);
        const { markPrice } = await client.getPosition(perpId, accountInfo.accountId);
        const currentPrice = pnsToPrice(markPrice, priceDecimals);

        // Apply slippage based on side
        if (side === "long") {
          price = currentPrice * (1 + slippage); // Pay up to X% more
        } else {
          price = currentPrice * (1 - slippage); // Receive at least X% less
        }
        isIoc = true; // Market orders are always IOC
        console.log(`Opening ${side} MARKET position...`);
        console.log(`  Perpetual ID: ${perpId}`);
        console.log(`  Size: ${size}`);
        console.log(`  Mark Price: ${currentPrice.toFixed(2)}`);
        console.log(`  Slippage: ${options.slippage}%`);
        console.log(`  Max Price: ${price.toFixed(2)}`);
        console.log(`  Leverage: ${leverage}x`);
      } else {
        price = parseFloat(options.price);
        console.log(`Opening ${side} position...`);
        console.log(`  Perpetual ID: ${perpId}`);
        console.log(`  Size: ${size}`);
        console.log(`  Price: ${price}`);
        console.log(`  Leverage: ${leverage}x`);
      }

      const orderType = side === "long" ? OrderType.OpenLong : OrderType.OpenShort;

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType,
        orderId: 0n,
        pricePNS: priceToPNS(price, priceDecimals),
        lotLNS: lotToLNS(size, lotDecimals),
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: isIoc,
        maxMatches: 0n,
        leverageHdths: leverageToHdths(leverage),
        lastExecutionBlock: 0n,
        amountCNS: 0n,
        maxSlippageBps: 0n,
      };

      // Dry-run: simulate instead of sending
      if (options.dryRun) {
        const perpName = options.perp.toUpperCase();
        try {
          const dryResult = await simulateTrade(config, orderDesc);
          printDryRunReport(dryResult, orderDesc, perpName, priceDecimals, lotDecimals);
        } catch (error) {
          console.error("Dry-run failed:", error);
          process.exit(1);
        }
        return;
      }

      try {
        const txHash = await client.execOrder(orderDesc);
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
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side to close (long or short)")
    .requiredOption("--size <amount>", "Size to close")
    .requiredOption("--price <price>", "Limit price")
    .option("--dry-run", "Simulate trade on forked chain without sending")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);

      // Get perpetual info for decimals
      const perpInfo = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Closing ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);

      const orderType = side === "long" ? OrderType.CloseLong : OrderType.CloseShort;

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType,
        orderId: 0n,
        pricePNS: priceToPNS(price, priceDecimals),
        lotLNS: lotToLNS(size, lotDecimals),
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

      // Dry-run: simulate instead of sending
      if (options.dryRun) {
        const perpName = options.perp.toUpperCase();
        try {
          const dryResult = await simulateTrade(config, orderDesc);
          printDryRunReport(dryResult, orderDesc, perpName, priceDecimals, lotDecimals);
        } catch (error) {
          console.error("Dry-run failed:", error);
          process.exit(1);
        }
        return;
      }

      try {
        const txHash = await client.execOrder(orderDesc);
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
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .requiredOption("--order-id <id>", "Order ID to cancel")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const orderId = BigInt(options.orderId);

      console.log(`Cancelling order ${orderId} on perp ${perpId}...`);

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType: OrderType.Cancel,
        orderId,
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

      try {
        const txHash = await client.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Cancel failed:", error);
        process.exit(1);
      }
    });

  // Cancel all orders
  trade
    .command("cancel-all")
    .description("Cancel all open orders on a market")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange });

      const accountInfo = await client.getAccountByAddress(wallet.address);
      const accountId = accountInfo.accountId;

      const perpId = resolvePerpId(options.perp);

      console.log(`Fetching open orders for perp ${perpId}...`);
      console.log(`Account ID: ${accountId}`);

      const orders = await client.getOpenOrders(perpId, accountId);

      if (orders.length === 0) {
        console.log("No open orders found.");
        return;
      }

      console.log(`Found ${orders.length} order(s) to cancel: ${orders.map(o => o.orderId).join(", ")}`);

      let cancelled = 0;
      for (const order of orders) {
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

        try {
          console.log(`Cancelling order ${order.orderId}...`);
          const txHash = await client.execOrder(orderDesc);
          console.log(`  Tx: ${txHash}`);
          cancelled++;
        } catch (e: any) {
          console.log(`  Failed: ${e.shortMessage || e.message}`);
        }
      }

      console.log(`\nCancelled ${cancelled}/${orders.length} orders.`);
    });

  // Add margin to position
  trade
    .command("add-margin")
    .description("Add margin to an existing position")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .requiredOption("--amount <amount>", "USD amount to add")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );

      const perpId = resolvePerpId(options.perp);
      const amount = parseFloat(options.amount);
      const amtCNS = amountToCNS(amount);

      console.log(`Adding margin to ${options.perp.toUpperCase()} position...`);
      console.log(`  Amount: $${amount}`);

      try {
        const txHash = await exchange.increasePositionCollateral(perpId, amtCNS);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Add margin failed:", error);
        process.exit(1);
      }
    });

  // Remove margin from position (request step)
  trade
    .command("remove-margin")
    .description("Request margin removal from a position (2-step: request + finalize after timelock)")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .requiredOption("--amount <amount>", "USD amount to remove")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );

      const perpId = resolvePerpId(options.perp);
      const amount = parseFloat(options.amount);
      const amtCNS = amountToCNS(amount);

      console.log(`Requesting margin removal from ${options.perp.toUpperCase()} position...`);
      console.log(`  Amount: $${amount}`);

      try {
        const txHash = await exchange.requestDecreasePositionCollateral(perpId, amtCNS, true);
        console.log(`\nRequest submitted: ${txHash}`);
        console.log("Note: Finalization required after timelock period.");
      } catch (error) {
        console.error("Remove margin request failed:", error);
        process.exit(1);
      }
    });

  // Close all positions and cancel all orders
  trade
    .command("close-all")
    .description("Close all positions and cancel all orders")
    .option("--perp <name>", "Specific market only (btc, eth, sol, mon, zec)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange });

      const accountInfo = await client.getAccountByAddress(wallet.address);
      const accountId = accountInfo.accountId;

      if (accountId === 0n) {
        console.log("No exchange account found.");
        return;
      }

      // Determine which markets to process
      const marketsToProcess = options.perp
        ? [resolvePerpId(options.perp)]
        : ALL_PERP_IDS;

      const scope = options.perp ? options.perp.toUpperCase() : "all markets";
      console.log(`Closing everything on ${scope}...`);
      console.log(`Account ID: ${accountId}`);

      let ordersCancelled = 0;
      let positionsClosed = 0;
      const errors: string[] = [];

      for (const perpId of marketsToProcess) {
        const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || perpId.toString();

        try {
          // Cancel all open orders for this market
          const orders = await client.getOpenOrders(perpId, accountId);

          if (orders.length > 0) {
            console.log(`\n[${perpName}] Found ${orders.length} open order(s)`);

            for (const order of orders) {
              try {
                console.log(`  Cancelling order ${order.orderId}...`);
                const cancelDesc: OrderDesc = {
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
                const txHash = await client.execOrder(cancelDesc);
                console.log(`    Tx: ${txHash}`);
                ordersCancelled++;
              } catch (e: any) {
                const msg = `Failed to cancel ${perpName} order #${order.orderId}: ${e.shortMessage || e.message}`;
                console.log(`    ${msg}`);
                errors.push(msg);
              }
            }
          }

          // Close position if exists
          const { position, markPrice } = await client.getPosition(perpId, accountId);

          if (position.lotLNS > 0n) {
            try {
              const perpInfo = await client.getPerpetualInfo(perpId);
              const priceDecimals = BigInt(perpInfo.priceDecimals);

              const isLong = Number(position.positionType) === 0;
              const orderType = isLong ? OrderType.CloseLong : OrderType.CloseShort;
              const side = isLong ? "LONG" : "SHORT";

              const currentPrice = pnsToPrice(markPrice, priceDecimals);
              const slippagePrice = isLong ? currentPrice * 0.99 : currentPrice * 1.01;

              console.log(`\n[${perpName}] Closing ${side} position...`);

              const closeDesc: OrderDesc = {
                orderDescId: 0n,
                perpId,
                orderType,
                orderId: 0n,
                pricePNS: priceToPNS(slippagePrice, priceDecimals),
                lotLNS: position.lotLNS,
                expiryBlock: 0n,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true, // Market order
                maxMatches: 0n,
                leverageHdths: 100n,
                lastExecutionBlock: 0n,
                amountCNS: 0n,
                maxSlippageBps: 0n,
              };

              const txHash = await client.execOrder(closeDesc);
              console.log(`    Tx: ${txHash}`);
              positionsClosed++;
            } catch (e: any) {
              const msg = `Failed to close ${perpName} position: ${e.shortMessage || e.message}`;
              console.log(`    ${msg}`);
              errors.push(msg);
            }
          }
        } catch (e: any) {
          const msg = `Failed to process ${perpName}: ${e.shortMessage || e.message}`;
          console.log(msg);
          errors.push(msg);
        }
      }

      console.log("\n" + "=".repeat(50));
      console.log("Close All Complete");
      console.log("=".repeat(50));
      console.log(`Orders cancelled: ${ordersCancelled}`);
      console.log(`Positions closed: ${positionsClosed}`);

      if (errors.length > 0) {
        console.log(`\nErrors (${errors.length}):`);
        for (const err of errors) {
          console.log(`  - ${err}`);
        }
      }
    });
}
