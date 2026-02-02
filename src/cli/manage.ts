/**
 * Manage command - Account management operations (owner only)
 */

import type { Command } from "commander";
import type { Address } from "viem";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  Exchange,
  ExchangeStateTracker,
  DelegatedAccount,
  PERPETUALS,
} from "../sdk/index.js";

export function registerManageCommand(program: Command): void {
  const manage = program
    .command("manage")
    .description("Account management operations (owner only)");

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

  // Withdraw collateral
  manage
    .command("withdraw")
    .description("Withdraw collateral from exchange to owner wallet")
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

  // Deposit collateral
  manage
    .command("deposit")
    .description("Deposit collateral to exchange account")
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

      owner.connect(config.delegatedAccountAddress);

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      console.log(`Depositing ${amount} USD stable...`);

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
    });

  // Account status
  manage
    .command("status")
    .description("Show account status and positions")
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

      console.log("Fetching account status...\n");

      try {
        // Get DelegatedAccount state
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

        // Get exchange account info
        const accountInfo = await exchange.getAccountById(accountId);

        console.log("\n=== Exchange Account ===");
        console.log(`Balance: ${Number(accountInfo.balanceCNS) / 1e6} USD stable`);
        console.log(`Locked: ${Number(accountInfo.lockedBalanceCNS) / 1e6} USD stable`);
        console.log(
          `Available: ${Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6} USD stable`
        );

        // Get positions
        console.log("\n=== Positions ===");

        for (const [name, perpId] of Object.entries(PERPETUALS)) {
          const { position, markPrice } = await exchange.getPosition(
            perpId,
            accountId
          );

          if (position.lotLNS > 0n) {
            const size = Number(position.lotLNS) / 1e8;
            const entryPrice = Number(position.pricePNS) / 1e6;
            const currentPrice = Number(markPrice) / 1e6;
            const pnl = Number(position.pnlCNS) / 1e6;

            const posType = position.positionType === 1 ? "LONG" : "SHORT";

            console.log(`\n${name}:`);
            console.log(`  Type: ${posType}`);
            console.log(`  Size: ${size}`);
            console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
            console.log(`  Mark Price: $${currentPrice.toFixed(2)}`);
            console.log(`  PnL: $${pnl.toFixed(2)}`);
          }
        }

        // Owner wallet balances
        const ownerEthBalance = await owner.getEthBalance();
        const ownerTokenBalance = await owner.getTokenBalance(
          config.chain.collateralToken
        );

        console.log("\n=== Owner Wallet ===");
        console.log(`Address: ${owner.address}`);
        console.log(`ETH: ${Number(ownerEthBalance) / 1e18}`);
        console.log(`USD stable: ${Number(ownerTokenBalance) / 1e6}`);
      } catch (error) {
        console.error("Failed to fetch status:", error);
        process.exit(1);
      }
    });

  // Check if address is operator
  manage
    .command("is-operator")
    .description("Check if an address is an operator")
    .requiredOption("--address <address>", "Address to check")
    .action(async (options) => {
      const config = loadEnvConfig();

      if (!config.delegatedAccountAddress) {
        console.error("DELEGATED_ACCOUNT_ADDRESS is required");
        process.exit(1);
      }

      // Don't need owner key for read-only operation
      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey ?? "0x0000000000000000000000000000000000000000000000000000000000000001",
        config.chain
      );

      const delegatedAccount = DelegatedAccount.connect(
        config.delegatedAccountAddress,
        owner.publicClient
      );

      try {
        const isOp = await delegatedAccount.isOperator(options.address as Address);
        console.log(`${options.address} is${isOp ? "" : " NOT"} an operator`);
      } catch (error) {
        console.error("Check failed:", error);
        process.exit(1);
      }
    });
}
