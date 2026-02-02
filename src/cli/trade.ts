/**
 * Trade command - Direct trading from owner wallet on Exchange
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  Exchange,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
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
    .description("Execute trades directly from owner wallet");

  // Open position
  trade
    .command("open")
    .description("Open a new position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side (long or short)")
    .requiredOption("--size <amount>", "Position size")
    .requiredOption("--price <price>", "Limit price")
    .option("--leverage <multiplier>", "Leverage multiplier", "1")
    .option("--ioc", "Immediate-or-cancel order (market order)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);
      const leverage = parseFloat(options.leverage);

      // Get perpetual info for decimals
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Opening ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);
      console.log(`  Leverage: ${leverage}x`);

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
        immediateOrCancel: options.ioc ?? false,
        maxMatches: 0n,
        leverageHdths: leverageToHdths(leverage),
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      };

      try {
        const txHash = await exchange.execOrder(orderDesc);
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
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);

      // Get perpetual info for decimals
      const perpInfo = await exchange.getPerpetualInfo(perpId);
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
      };

      try {
        const txHash = await exchange.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Close failed:", error);
        process.exit(1);
      }
    });
}
