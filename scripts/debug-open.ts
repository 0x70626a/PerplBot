import "dotenv/config";

// Force owner mode
delete process.env.OPERATOR_PRIVATE_KEY;
delete process.env.DELEGATED_ACCOUNT_ADDRESS;

import { createPublicClient, http, encodeFunctionData } from "viem";
import { monadTestnet, getChainConfig } from "../src/sdk/config.js";
import { ExchangeAbi } from "../src/sdk/contracts/abi.js";
import { initSDK, getAccountSummary, openPosition } from "../src/chatbot/sdk-bridge.js";

async function main() {
  const chainConfig = getChainConfig();
  console.log("=== Chain Config ===");
  console.log("Exchange:", chainConfig.exchangeAddress);
  console.log("Collateral:", chainConfig.collateralToken);

  const client = createPublicClient({
    chain: monadTestnet,
    transport: http(chainConfig.rpcUrl),
  });

  // 1. Try getPerpetualInfo(16) directly with full error
  console.log("\n=== getPerpetualInfo(16) ===");
  try {
    const info = await client.readContract({
      address: chainConfig.exchangeAddress,
      abi: ExchangeAbi,
      functionName: "getPerpetualInfo",
      args: [16n],
    });
    const i = info as Record<string, unknown>;
    console.log("symbol:", i.symbol);
    console.log("markPNS:", i.markPNS);
    console.log("oraclePNS:", i.oraclePNS);
    console.log("priceDecimals:", i.priceDecimals);
    console.log("lotDecimals:", i.lotDecimals);
    console.log("paused:", i.paused);
  } catch (e: any) {
    console.log("Error:", e.shortMessage || e.message);
    if (e.cause) console.log("Cause:", e.cause.message || e.cause);
    // Try raw call
    console.log("\nTrying raw eth_call...");
    try {
      const data = encodeFunctionData({
        abi: ExchangeAbi,
        functionName: "getPerpetualInfo",
        args: [16n],
      });
      const result = await client.call({
        to: chainConfig.exchangeAddress,
        data,
      });
      console.log("Raw result:", result);
    } catch (e2: any) {
      console.log("Raw error:", e2.shortMessage || e2.message);
      if (e2.cause?.data) console.log("Revert data:", e2.cause.data);
    }
  }

  // 2. Init SDK and try to open position
  console.log("\n=== Initializing SDK ===");
  await initSDK();

  console.log("\n=== Account Summary ===");
  const summary = await getAccountSummary();
  console.log(JSON.stringify(summary, null, 2));

  // 3. Open BTC long - use a reasonable price
  console.log("\n=== Opening BTC long (perpId 16) ===");
  console.log("Price: 100000 (high crossing price)");
  console.log("Size: 0.001, Leverage: 2");

  try {
    const result = await openPosition({
      market: "BTC",
      side: "long",
      size: 0.001,
      price: 100000,
      leverage: 2,
      is_market_order: false,
    });
    console.log("\n=== SUCCESS ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    console.log("\n=== ERROR ===");
    console.log("Message:", (e as Error).message);
    if (e.details) console.log("Details:", e.details);
    if (e.shortMessage) console.log("Short:", e.shortMessage);
    if ((e as any).cause?.data) console.log("Revert data:", (e as any).cause.data);
    console.log(
      "\nFull error:",
      JSON.stringify(e, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
