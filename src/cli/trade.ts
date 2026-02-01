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

const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
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
  throw new Error(`Unknown perpetual: ${perp}. Use btc, eth, sol, or a numeric ID.`);
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
            pricePNS: priceToPNS(price),
            lotLNS: lotToLNS(size),
            leverageHdths: leverageToHdths(leverage),
            postOnly: options.postOnly ?? false,
            immediateOrCancel: options.ioc ?? false,
          });
        } else if (side === "short") {
          txHash = await operator.openShort({
            perpId,
            pricePNS: priceToPNS(price),
            lotLNS: lotToLNS(size),
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

      console.log(`Closing ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);

      try {
        let txHash: string;

        if (side === "long") {
          txHash = await operator.closeLong({
            perpId,
            pricePNS: priceToPNS(price),
            lotLNS: lotToLNS(size),
          });
        } else if (side === "short") {
          txHash = await operator.closeShort({
            perpId,
            pricePNS: priceToPNS(price),
            lotLNS: lotToLNS(size),
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
}
