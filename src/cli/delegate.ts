/**
 * Delegate command - Trade and manage via DelegatedAccount (operator pattern)
 */

import type { Command } from "commander";
import type { Address } from "viem";
import {
  loadEnvConfig,
  validateOperatorConfig,
  validateOwnerConfig,
  OperatorWallet,
  OwnerWallet,
  Exchange,
  DelegatedAccount,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
  pnsToPrice,
  lnsToLot,
} from "../sdk/index.js";

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

export function registerDelegateCommand(program: Command): void {
  const delegate = program
    .command("delegate")
    .description("Trade and manage via DelegatedAccount (operator pattern)");

  // === TRADE SUBCOMMANDS ===
  const trade = delegate
    .command("trade")
    .description("Execute trades as an operator via DelegatedAccount");

  // Open position
  trade
    .command("open")
    .description("Open a new position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
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

      // Fetch perpetual info to get correct decimals
      const exchange = new Exchange(config.chain.exchangeAddress, operator.publicClient);
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Opening ${side} position (delegate)...`);
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
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
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

      // Fetch perpetual info to get correct decimals
      const exchange = new Exchange(config.chain.exchangeAddress, operator.publicClient);
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Closing ${side} position (delegate)...`);
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
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
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

  // Cancel all orders
  trade
    .command("cancel-all")
    .description("Cancel all open orders on a market")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
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

      const delegatedAccount = new DelegatedAccount(
        config.delegatedAccountAddress,
        operator.publicClient
      );
      const accountId = await delegatedAccount.getAccountId();

      const perpId = resolvePerpId(options.perp);
      const blocksToScan = BigInt(options.blocks);

      console.log(`Scanning last ${blocksToScan} blocks for orders on perp ${perpId}...`);
      console.log(`Account ID: ${accountId}`);

      const currentBlock = await operator.publicClient.getBlockNumber();
      const startBlock = currentBlock - blocksToScan;

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

      const ourRequests = requestLogs.filter(
        (log) =>
          log.args.accountId === accountId &&
          log.args.perpId === perpId &&
          (log.args.orderType === 0 || log.args.orderType === 1) &&
          !log.args.immediateOrCancel
      );

      if (ourRequests.length === 0) {
        console.log("No open orders found in recent blocks.");
        return;
      }

      const txHashes = new Set(ourRequests.map((log) => log.transactionHash));
      const orderIds = placedLogs
        .filter((log) => txHashes.has(log.transactionHash) && log.args.orderId! > 0n)
        .map((log) => log.args.orderId!);

      const uniqueOrderIds = [...new Set(orderIds)];
      if (uniqueOrderIds.length === 0) {
        console.log("No order IDs found (orders may have been filled or cancelled).");
        return;
      }

      console.log(`Found ${uniqueOrderIds.length} order(s) to cancel: ${uniqueOrderIds.join(", ")}`);

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

  // === MANAGE SUBCOMMANDS ===
  const manage = delegate
    .command("manage")
    .description("DelegatedAccount management operations");

  // Status
  manage
    .command("status")
    .description("Show DelegatedAccount status and positions")
    .action(async () => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const delegatedAccount = owner.connect(config.delegatedAccountAddress);
      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient
      );

      console.log("Fetching delegate account status...\n");

      try {
        const state = await delegatedAccount.getState();
        const accountId = state.accountId;

        console.log("=== DelegatedAccount ===");
        console.log(`Address: ${config.delegatedAccountAddress}`);
        console.log(`Owner: ${state.owner}`);
        console.log(`Exchange Account ID: ${accountId}`);
        console.log(`Exchange: ${state.exchange}`);
        console.log(`Collateral Token: ${state.collateralToken}`);

        if (accountId === 0n) {
          console.log("\nNo exchange account created yet.");
          return;
        }

        const accountInfo = await exchange.getAccountById(accountId);

        console.log("\n=== Exchange Account ===");
        console.log(`Balance: ${Number(accountInfo.balanceCNS) / 1e6} USD stable`);
        console.log(`Locked: ${Number(accountInfo.lockedBalanceCNS) / 1e6} USD stable`);
        console.log(
          `Available: ${Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6} USD stable`
        );

        console.log("\n=== Positions ===");

        for (const [name, perpId] of Object.entries(PERPETUALS)) {
          const { position, markPrice } = await exchange.getPosition(
            perpId,
            accountId
          );

          if (position.lotLNS > 0n) {
            const perpInfo = await exchange.getPerpetualInfo(perpId);
            const priceDecimals = Number(perpInfo.priceDecimals);
            const lotDecimals = Number(perpInfo.lotDecimals);

            const size = lnsToLot(position.lotLNS, BigInt(lotDecimals));
            const entryPrice = pnsToPrice(position.pricePNS, BigInt(priceDecimals));
            const currentPrice = pnsToPrice(markPrice, BigInt(priceDecimals));
            const pnl = Number(position.pnlCNS) / 1e6;

            const posType = Number(position.positionType) === 0 ? "LONG" : "SHORT";

            console.log(`\n${name}:`);
            console.log(`  Type: ${posType}`);
            console.log(`  Size: ${size.toFixed(lotDecimals)}`);
            console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
            console.log(`  Mark Price: $${currentPrice.toFixed(2)}`);
            console.log(`  PnL: $${pnl.toFixed(2)}`);
          }
        }
      } catch (error) {
        console.error("Failed to fetch status:", error);
        process.exit(1);
      }
    });

  // Deposit
  manage
    .command("deposit")
    .description("Deposit collateral to DelegatedAccount")
    .requiredOption("--amount <amount>", "Amount to deposit in USD stable")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const delegatedAccount = owner.connect(config.delegatedAccountAddress);

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      const accountId = await delegatedAccount.getAccountId();

      if (accountId === 0n) {
        console.log(`Creating exchange account with ${amount} USD stable deposit...`);

        try {
          const { transferHash, createHash } = await owner.createExchangeAccount(
            config.chain.collateralToken,
            amountCNS
          );
          console.log(`Transfer tx: ${transferHash}`);
          console.log(`Create account tx: ${createHash}`);

          const newAccountId = await delegatedAccount.getAccountId();
          console.log(`Exchange account created with ID: ${newAccountId}`);
        } catch (error) {
          console.error("Account creation failed:", error);
          process.exit(1);
        }
      } else {
        console.log(`Depositing ${amount} USD stable to account ${accountId}...`);

        try {
          const { transferHash, depositHash } = await owner.depositCollateral(
            config.chain.collateralToken,
            amountCNS
          );
          console.log(`Transfer tx: ${transferHash}`);
          console.log(`Deposit tx: ${depositHash}`);
        } catch (error) {
          console.error("Deposit failed:", error);
          process.exit(1);
        }
      }
    });

  // Withdraw
  manage
    .command("withdraw")
    .description("Withdraw collateral from DelegatedAccount")
    .requiredOption("--amount <amount>", "Amount to withdraw in USD stable")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      owner.connect(config.delegatedAccountAddress);

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      console.log(`Withdrawing ${amount} USD stable...`);

      try {
        const txHash = await owner.withdrawCollateral(amountCNS);
        console.log(`Transaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Withdrawal failed:", error);
        process.exit(1);
      }
    });

  // Add operator
  manage
    .command("add-operator")
    .description("Add a new operator to the DelegatedAccount")
    .requiredOption("--address <address>", "Operator address to add")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      owner.connect(config.delegatedAccountAddress);

      console.log(`Adding operator ${options.address}...`);

      try {
        const txHash = await owner.addOperator(options.address as Address);
        console.log(`Transaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Failed to add operator:", error);
        process.exit(1);
      }
    });

  // Remove operator
  manage
    .command("remove-operator")
    .description("Remove an operator from the DelegatedAccount")
    .requiredOption("--address <address>", "Operator address to remove")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      owner.connect(config.delegatedAccountAddress);

      console.log(`Removing operator ${options.address}...`);

      try {
        const txHash = await owner.removeOperator(options.address as Address);
        console.log(`Transaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Failed to remove operator:", error);
        process.exit(1);
      }
    });
}
