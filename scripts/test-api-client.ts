#!/usr/bin/env npx tsx
/**
 * Phase 1 API Client Integration Tests
 *
 * Tests the new API client layer against the live Perpl API.
 *
 * Usage:
 *   npx tsx scripts/test-api-client.ts
 *
 * Requires:
 *   OWNER_PRIVATE_KEY in .env for authenticated tests
 */

import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import {
  PerplApiClient,
  PerplWebSocketClient,
  API_CONFIG,
  monadTestnet,
} from "../src/sdk/index.js";

config();

interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[test] ${msg}`);
}

function logResult(result: TestResult) {
  const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⏭️";
  console.log(`${icon} ${result.name}${result.details ? ` - ${result.details}` : ""}`);
  if (result.error) console.log(`   Error: ${result.error}`);
  results.push(result);
}

async function testRestClient(): Promise<{ authenticated: boolean; authNonce?: string; authCookies?: string }> {
  log("\n=== REST Client Tests ===\n");

  const client = new PerplApiClient(API_CONFIG);

  // Test 1: Get context (public)
  try {
    const context = await client.getContext();
    logResult({
      name: "Get context",
      status: context.markets?.length > 0 ? "pass" : "fail",
      details: `${context.markets?.length} markets, chain: ${context.chain?.name}`,
    });
  } catch (e: any) {
    logResult({ name: "Get context", status: "fail", error: e.message });
  }

  // Test 2: Get candles
  try {
    const to = Date.now();
    const from = to - 3600000;
    const candles = await client.getCandles(16, 3600, from, to);
    logResult({
      name: "Get candles",
      status: candles.d?.length > 0 ? "pass" : "fail",
      details: `${candles.d?.length} candles`,
    });
  } catch (e: any) {
    logResult({ name: "Get candles", status: "fail", error: e.message });
  }

  // Test 3: Get announcements
  try {
    const announcements = await client.getAnnouncements();
    logResult({
      name: "Get announcements",
      status: "ver" in announcements ? "pass" : "fail",
      details: `ver: ${announcements.ver}`,
    });
  } catch (e: any) {
    logResult({ name: "Get announcements", status: "fail", error: e.message });
  }

  // Test 4: Not authenticated initially
  logResult({
    name: "Not authenticated initially",
    status: client.isAuthenticated() === false ? "pass" : "fail",
  });

  // Test 5: Authenticate
  const privateKey = process.env.OWNER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    logResult({ name: "Authenticate", status: "skip", details: "No OWNER_PRIVATE_KEY" });
    return { authenticated: false };
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });

  log(`Authenticating wallet: ${account.address}`);

  try {
    const nonce = await client.authenticate(account.address, (msg) =>
      walletClient.signMessage({ message: msg })
    );
    logResult({
      name: "Authenticate",
      status: nonce?.length > 0 ? "pass" : "fail",
      details: `nonce length: ${nonce?.length}`,
    });
  } catch (e: any) {
    if (e.status === 418) {
      logResult({ name: "Authenticate", status: "skip", details: "Wallet not whitelisted (418)" });
    } else {
      logResult({ name: "Authenticate", status: "fail", error: e.message });
    }
    return { authenticated: false };
  }

  // Test 6: Is authenticated
  logResult({
    name: "Is authenticated",
    status: client.isAuthenticated() === true ? "pass" : "fail",
  });

  // Test 7: Get auth nonce
  const authNonce = client.getAuthNonce();
  logResult({
    name: "Get auth nonce",
    status: authNonce !== null ? "pass" : "fail",
    details: authNonce ? `length: ${authNonce.length}` : "null",
  });

  // Test 8-11: Authenticated endpoints
  const endpoints: [string, () => Promise<{ d: unknown[]; np: string }>][] = [
    ["Get fills", () => client.getFills()],
    ["Get order history", () => client.getOrderHistory()],
    ["Get position history", () => client.getPositionHistory()],
    ["Get account history", () => client.getAccountHistory()],
  ];

  for (const [name, method] of endpoints) {
    try {
      const result = await method();
      logResult({
        name,
        status: "d" in result ? "pass" : "fail",
        details: `${result.d?.length} items`,
      });
    } catch (e: any) {
      // 404 is valid for empty data
      if (e.status === 404) {
        logResult({ name, status: "pass", details: "No data (404)" });
      } else {
        logResult({ name, status: "fail", error: e.message });
      }
    }
  }

  // Return auth nonce and cookies for WebSocket tests (don't clear yet)
  return {
    authenticated: true,
    authNonce: client.getAuthNonce() || undefined,
    authCookies: client.getAuthCookies() || undefined,
  };
}

async function testClearAuth() {
  log("\n=== Clear Auth Test ===\n");
  const client = new PerplApiClient(API_CONFIG);

  // Just verify clear auth works on an unauthenticated client
  client.clearAuth();
  logResult({
    name: "Clear auth",
    status: client.isAuthenticated() === false ? "pass" : "fail",
  });
}

async function testWebSocketClient(authNonce?: string, authCookies?: string) {
  log("\n=== WebSocket Client Tests ===\n");

  const ws = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);

  // Test 1: Connect market data
  try {
    await ws.connectMarketData();
    logResult({ name: "Connect market data", status: "pass" });
  } catch (e: any) {
    logResult({ name: "Connect market data", status: "fail", error: e.message });
    return;
  }

  // Test 2: Subscribe order book
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for order book")), 5000);
      ws.once("order-book", (book) => {
        clearTimeout(timeout);
        logResult({
          name: "Subscribe order book",
          status: book.bid?.length > 0 || book.ask?.length > 0 ? "pass" : "fail",
          details: `${book.bid?.length || 0} bids, ${book.ask?.length || 0} asks`,
        });
        resolve();
      });
      ws.subscribeOrderBook(16);
    });
  } catch (e: any) {
    logResult({ name: "Subscribe order book", status: "fail", error: e.message });
  }

  // Test 3: Subscribe market state
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for market state")), 5000);
      ws.once("market-state", (state) => {
        clearTimeout(timeout);
        const marketCount = Object.keys(state).length;
        logResult({
          name: "Subscribe market state",
          status: marketCount > 0 ? "pass" : "fail",
          details: `${marketCount} markets`,
        });
        resolve();
      });
      ws.subscribeMarketState();
    });
  } catch (e: any) {
    logResult({ name: "Subscribe market state", status: "fail", error: e.message });
  }

  // Test 4: isConnected
  logResult({
    name: "Is connected",
    status: ws.isConnected() === true ? "pass" : "fail",
  });

  // Test 5: Disconnect
  ws.disconnect();
  logResult({
    name: "Disconnect",
    status: ws.isConnected() === false ? "pass" : "fail",
  });

  // Test 6: Trading WebSocket (if authenticated)
  if (authNonce && authCookies) {
    log("\n--- Trading WebSocket Tests ---\n");
    const tradingWs = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);

    try {
      log(`Using auth nonce: ${authNonce.slice(0, 10)}...`);
      log(`Using cookies: yes`);

      // Add listeners for debugging
      tradingWs.on("error", (err) => {
        log(`Trading WS error: ${err.message}`);
      });
      tradingWs.on("disconnect", (code) => {
        log(`Trading WS disconnect: code ${code}`);
      });

      // Set up snapshot trackers before connecting
      let gotPositions = false;
      let gotOrders = false;
      let gotWallet = false;

      tradingWs.on("positions", () => {
        log("Received positions snapshot");
        gotPositions = true;
      });
      tradingWs.on("orders", () => {
        log("Received orders snapshot");
        gotOrders = true;
      });
      tradingWs.on("wallet", () => {
        log("Received wallet snapshot");
        gotWallet = true;
      });

      // Connect with cookies
      await tradingWs.connectTrading(authNonce, authCookies);
      logResult({ name: "Connect trading WS", status: "pass" });

      // Wait a bit for additional snapshots (positions/orders come after wallet)
      await new Promise((r) => setTimeout(r, 2000));

      logResult({
        name: "Receive wallet snapshot",
        status: gotWallet ? "pass" : "fail",
      });
      logResult({
        name: "Receive positions snapshot",
        status: gotPositions ? "pass" : "fail",
      });
      logResult({
        name: "Receive orders snapshot",
        status: gotOrders ? "pass" : "fail",
      });

      tradingWs.disconnect();
      logResult({
        name: "Disconnect trading WS",
        status: tradingWs.isConnected() === false ? "pass" : "fail",
      });
    } catch (e: any) {
      logResult({ name: "Connect trading WS", status: "fail", error: e.message });
    }
  } else {
    logResult({ name: "Trading WebSocket tests", status: "skip", details: "No auth nonce or cookies" });
  }
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           Phase 1: API Client Integration Tests                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("API Config:");
  console.log(`  Base URL: ${API_CONFIG.baseUrl}`);
  console.log(`  WS URL: ${API_CONFIG.wsUrl}`);
  console.log(`  Chain ID: ${API_CONFIG.chainId}`);

  const { authNonce, authCookies } = await testRestClient();
  await testWebSocketClient(authNonce, authCookies);
  await testClearAuth();

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                         Test Summary                           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed} | ⏭️ Skipped: ${skipped}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`  - ${r.name}: ${r.error || r.details}`);
    }
  }

  if (skipped > 0) {
    console.log("\nSkipped tests:");
    for (const r of results.filter((r) => r.status === "skip")) {
      console.log(`  - ${r.name}: ${r.details}`);
    }
  }

  // Exit with error if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
