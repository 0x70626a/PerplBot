/**
 * Manage command - Account management
 * Uses HybridClient for API-first reads with contract fallback
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
  pnsToPrice,
  lnsToLot,
  PerplApiClient,
  API_CONFIG,
  USE_API,
} from "../sdk/index.js";
import { ERC20Abi, ExchangeAbi } from "../sdk/contracts/abi.js";

export function registerManageCommand(program: Command): void {
  const manage = program
    .command("manage")
    .description("Account management");

  // Account status
  manage
    .command("status")
    .description("Show account status and positions")
    .action(async () => {
      const config = loadEnvConfig();
      validateConfig(config);

      // Get global options from parent
      const globalOpts = program.opts();
      const useApi = globalOpts.api !== false && USE_API;

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      // Initialize API client if enabled
      let apiClient: PerplApiClient | undefined;
      if (useApi) {
        apiClient = new PerplApiClient(API_CONFIG);
      }

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        wallet.publicClient,
        wallet.walletClient
      );
      const client = new HybridClient({ exchange, apiClient });

      console.log("Fetching account status...");
      console.log(`Mode: ${client.isApiEnabled() ? "API + Contract" : "Contract only"}\n`);

      try {
        // Get account by address
        let accountInfo;
        try {
          accountInfo = await client.getAccountByAddress(wallet.address);
        } catch {
          console.log("=== Wallet ===");
          console.log(`Address: ${wallet.address}`);
          console.log("\nNo exchange account found.");
          console.log("Use 'manage deposit' to create one.");

          const ethBalance = await wallet.getEthBalance();
          const tokenBalance = await wallet.getTokenBalance(
            config.chain.collateralToken
          );
          console.log("\n=== Wallet Balances ===");
          console.log(`ETH: ${Number(ethBalance) / 1e18}`);
          console.log(`USD stable: ${Number(tokenBalance) / 1e6}`);
          return;
        }

        if (accountInfo.accountId === 0n) {
          console.log("=== Wallet ===");
          console.log(`Address: ${wallet.address}`);
          console.log("\nNo exchange account found.");
          console.log("Use 'manage deposit' to create one.");
          return;
        }

        console.log("=== Exchange Account ===");
        console.log(`Address: ${wallet.address}`);
        console.log(`Account ID: ${accountInfo.accountId}`);
        console.log(`Balance: ${Number(accountInfo.balanceCNS) / 1e6} USD stable`);
        console.log(`Locked: ${Number(accountInfo.lockedBalanceCNS) / 1e6} USD stable`);
        console.log(
          `Available: ${Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6} USD stable`
        );

        // Get positions
        console.log("\n=== Positions ===");

        for (const [name, perpId] of Object.entries(PERPETUALS)) {
          const { position, markPrice } = await client.getPosition(
            perpId,
            accountInfo.accountId
          );

          if (position.lotLNS > 0n) {
            const perpInfo = await client.getPerpetualInfo(perpId);
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

        // Wallet balances
        const ethBalance = await wallet.getEthBalance();
        const tokenBalance = await wallet.getTokenBalance(
          config.chain.collateralToken
        );

        console.log("\n=== Wallet Balances ===");
        console.log(`ETH: ${Number(ethBalance) / 1e18}`);
        console.log(`USD stable: ${Number(tokenBalance) / 1e6}`);
      } catch (error) {
        console.error("Failed to fetch status:", error);
        process.exit(1);
      }
    });

  // Deposit collateral
  manage
    .command("deposit")
    .description("Deposit collateral to exchange account (creates if needed)")
    .requiredOption("--amount <amount>", "Amount to deposit in USD stable")
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

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      // Check if account exists
      let accountExists = false;
      let accountInfo;
      try {
        accountInfo = await client.getAccountByAddress(wallet.address);
        accountExists = accountInfo.accountId > 0n;
      } catch {
        accountExists = false;
      }

      const account = wallet.walletClient.account;
      if (!account) throw new Error("No account");

      if (!accountExists) {
        console.log(`Creating exchange account with ${amount} USD stable...`);

        // Approve tokens
        console.log("Approving tokens...");
        const approveHash = await wallet.walletClient.writeContract({
          address: config.chain.collateralToken,
          abi: ERC20Abi,
          functionName: "approve",
          args: [config.chain.exchangeAddress, amountCNS],
          account,
          chain: wallet.walletClient.chain,
        });
        console.log(`Approve tx: ${approveHash}`);
        await wallet.publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Create account
        console.log("Creating account...");
        const createHash = await wallet.walletClient.writeContract({
          address: config.chain.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "createAccount",
          args: [amountCNS],
          account,
          chain: wallet.walletClient.chain,
        });
        console.log(`Create account tx: ${createHash}`);

        // Get new account ID
        await wallet.publicClient.waitForTransactionReceipt({ hash: createHash });
        const newAccountInfo = await client.getAccountByAddress(wallet.address);
        console.log(`Account created with ID: ${newAccountInfo.accountId}`);
      } else {
        console.log(`Depositing ${amount} USD stable to account ${accountInfo!.accountId}...`);

        // Approve tokens
        console.log("Approving tokens...");
        const approveHash = await wallet.walletClient.writeContract({
          address: config.chain.collateralToken,
          abi: ERC20Abi,
          functionName: "approve",
          args: [config.chain.exchangeAddress, amountCNS],
          account,
          chain: wallet.walletClient.chain,
        });
        console.log(`Approve tx: ${approveHash}`);
        await wallet.publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Deposit
        console.log("Depositing...");
        const depositHash = await wallet.walletClient.writeContract({
          address: config.chain.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "depositCollateral",
          args: [amountCNS],
          account,
          chain: wallet.walletClient.chain,
        });
        console.log(`Deposit tx: ${depositHash}`);
      }
    });

  // Withdraw collateral
  manage
    .command("withdraw")
    .description("Withdraw collateral from exchange account")
    .requiredOption("--amount <amount>", "Amount to withdraw in USD stable")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateConfig(config);

      const wallet = Wallet.fromPrivateKey(
        config.privateKey,
        config.chain
      );

      const account = wallet.walletClient.account;
      if (!account) throw new Error("No account");

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      console.log(`Withdrawing ${amount} USD stable...`);

      try {
        const txHash = await wallet.walletClient.writeContract({
          address: config.chain.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "withdrawCollateral",
          args: [amountCNS],
          account,
          chain: wallet.walletClient.chain,
        });
        console.log(`Transaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Withdrawal failed:", error);
        process.exit(1);
      }
    });

  // Show available markets
  manage
    .command("markets")
    .description("Show available markets with prices and funding rates")
    .action(async () => {
      const { createPublicClient, http } = await import("viem");
      const config = loadEnvConfig();

      const publicClient = createPublicClient({
        chain: config.chain.chain,
        transport: http(config.chain.rpcUrl),
      });

      const exchange = new Exchange(config.chain.exchangeAddress, publicClient);
      const client = new HybridClient({ exchange });

      console.log("Fetching market data...\n");

      const markets: Array<{
        symbol: string;
        markPrice: string;
        oraclePrice: string;
        funding: string;
        longOI: string;
        shortOI: string;
        status: string;
      }> = [];

      for (const perpId of ALL_PERP_IDS) {
        try {
          const info = await client.getPerpetualInfo(perpId);
          const priceDecimals = Number(info.priceDecimals);
          const lotDecimals = Number(info.lotDecimals);

          const markPrice = pnsToPrice(info.markPNS, BigInt(priceDecimals));
          const oraclePrice = pnsToPrice(info.oraclePNS, BigInt(priceDecimals));

          const fundingRate = info.fundingRatePct100k / 100000;

          const longOI = lnsToLot(info.longOpenInterestLNS, BigInt(lotDecimals));
          const shortOI = lnsToLot(info.shortOpenInterestLNS, BigInt(lotDecimals));

          markets.push({
            symbol: info.symbol,
            markPrice: markPrice > 0 ? `$${markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "N/A",
            oraclePrice: oraclePrice > 0 ? `$${oraclePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "N/A",
            funding: `${fundingRate >= 0 ? "+" : ""}${(fundingRate * 100).toFixed(4)}%`,
            longOI: longOI.toFixed(lotDecimals > 4 ? 4 : lotDecimals),
            shortOI: shortOI.toFixed(lotDecimals > 4 ? 4 : lotDecimals),
            status: info.status !== 0 ? "PAUSED" : "Active",
          });
        } catch {
          // Market doesn't exist or error fetching
        }
      }

      if (markets.length === 0) {
        console.log("No markets found.");
        return;
      }

      console.log("=== Available Markets ===\n");
      console.log(
        "Symbol".padEnd(8) +
        "Mark Price".padEnd(14) +
        "Oracle Price".padEnd(14) +
        "Funding/8h".padEnd(12) +
        "Long OI".padEnd(12) +
        "Short OI".padEnd(12) +
        "Status"
      );
      console.log("-".repeat(80));

      for (const m of markets) {
        console.log(
          m.symbol.padEnd(8) +
          m.markPrice.padEnd(14) +
          m.oraclePrice.padEnd(14) +
          m.funding.padEnd(12) +
          m.longOI.padEnd(12) +
          m.shortOI.padEnd(12) +
          m.status
        );
      }

      console.log("\nFunding rate is per 8-hour period.");
    });
}
