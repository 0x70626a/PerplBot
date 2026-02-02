/**
 * Deploy command - Deploy a new DelegatedAccount
 */

import type { Command } from "commander";
import type { Address } from "viem";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
} from "../sdk/index.js";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Deploy a new DelegatedAccount proxy contract")
    .requiredOption(
      "--implementation <address>",
      "Address of the DelegatedAccount implementation contract"
    )
    .option(
      "--operator <address>",
      "Address of the operator (hot wallet). If not specified, no operator is set initially."
    )
    .option("--deposit <amount>", "Initial deposit amount in USD stable", "0")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      console.log("Deploying DelegatedAccount...\n");

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      console.log(`Owner address: ${owner.address}`);
      console.log(`Exchange address: ${config.chain.exchangeAddress}`);
      console.log(`Collateral token: ${config.chain.collateralToken}`);

      if (options.operator) {
        console.log(`Operator address: ${options.operator}`);
      } else {
        console.log("Operator: None (can be added later)");
      }

      console.log("\nDeploying proxy...");

      try {
        const { delegatedAccount, txHash } = await owner.deploy(
          options.implementation as Address,
          {
            operator: (options.operator ?? "0x0000000000000000000000000000000000000000") as Address,
            exchange: config.chain.exchangeAddress,
            collateralToken: config.chain.collateralToken,
          }
        );

        console.log(`\nDeployment successful!`);
        console.log(`Transaction hash: ${txHash}`);
        console.log(`DelegatedAccount address: ${delegatedAccount.address}`);

        // Handle initial deposit if specified
        const depositAmount = parseFloat(options.deposit);
        if (depositAmount > 0) {
          console.log(`\nCreating exchange account with ${depositAmount} USD stable deposit...`);

          const amountCNS = BigInt(Math.round(depositAmount * 1e6));
          const { transferHash, createHash } = await owner.createExchangeAccount(
            config.chain.collateralToken,
            amountCNS
          );

          console.log(`Transfer tx: ${transferHash}`);
          console.log(`Create account tx: ${createHash}`);

          // Get the created account ID
          const accountId = await delegatedAccount.getAccountId();
          console.log(`Exchange account ID: ${accountId}`);
        }

        console.log("\n--- Configuration for .env ---");
        console.log(`DELEGATED_ACCOUNT_ADDRESS=${delegatedAccount.address}`);
      } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
      }
    });
}
