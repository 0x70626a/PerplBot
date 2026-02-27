/**
 * Close handler tests
 * Tests for close position and close all functionality
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";

// Test database path
const TEST_DB_PATH = "./test-data/test-close-perpl.db";

// Set environment before importing
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.MONAD_RPC_URL = "https://testnet-rpc.monad.xyz";

import {
  initDatabase,
  closeDatabase,
  getDatabase,
} from "../../src/bot/db/index.js";

// Helper to clean up database files
function cleanupDbFiles(path: string) {
  if (existsSync(path)) rmSync(path);
  if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
  if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

// Mock the client module
vi.mock("../../src/bot/client.js", () => ({
  createHybridClient: vi.fn(),
}));

// Mock loadEnvConfig to avoid actual env loading issues
vi.mock("../../src/sdk/index.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadEnvConfig: vi.fn(() => ({
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
      chain: {
        chain: { id: 10143, name: "monad-testnet" },
        rpcUrl: "https://testnet-rpc.monad.xyz",
        exchangeAddress: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
        collateralToken: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      },
    })),
    validateConfig: vi.fn(),
    Wallet: {
      fromPrivateKey: vi.fn(() => ({
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      })),
    },
  };
});

describe("Close Handlers", () => {
  beforeAll(() => {
    mkdirSync("./test-data", { recursive: true });
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
    initDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM link_requests");
    vi.clearAllMocks();
  });

  afterAll(() => {
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
  });

  describe("handleClosePosition", () => {
    it("should close position in single-user mode", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n, // Has a position
            positionType: 0, // Long
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 51000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xmocktxhash123"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined, // Single-user mode
        reply: replyMock,
      } as any;

      await handleClosePosition(ctx, "btc");

      expect(replyMock).toHaveBeenCalledTimes(2);
      expect(replyMock).toHaveBeenNthCalledWith(1, "Closing BTC position...");
      expect(replyMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("BTC Position Closed"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );
      expect(mockClient.execOrder).toHaveBeenCalled();
    });

    it("should report no position when none exists", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 0n, // No position
            positionType: 0,
            pricePNS: 0n,
            pnlCNS: 0n,
          },
          markPrice: 51000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleClosePosition(ctx, "eth");

      expect(replyMock).toHaveBeenNthCalledWith(2, "No ETH position to close\\.", { parse_mode: "MarkdownV2" });
    });

    it("should handle no exchange account error", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 0n, // No account
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleClosePosition(ctx, "btc");

      expect(replyMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("No exchange account found"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );
    });
  });

  describe("handleCloseAll", () => {
    it("should close all positions and orders in single-user mode", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getOpenOrders: vi.fn().mockResolvedValue([
          { orderId: 1n, orderType: 0, priceONS: 50000, lotLNS: 1000n, leverageHdths: 200 },
          { orderId: 2n, orderType: 1, priceONS: 51000, lotLNS: 500n, leverageHdths: 300 },
        ]),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 0,
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 51000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xclosealltxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleCloseAll(ctx);

      expect(replyMock).toHaveBeenNthCalledWith(1, "Closing everything on all markets...");
      expect(replyMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("Close All Complete"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );

      // Should have called execOrder for cancels and closes
      expect(mockClient.execOrder).toHaveBeenCalled();
    });

    it("should close only specific market when specified", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getOpenOrders: vi.fn().mockResolvedValue([]),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 50000000000n,
            positionType: 1, // Short
            pricePNS: 100000000000n,
            pnlCNS: 0n,
          },
          markPrice: 99000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xsoltxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleCloseAll(ctx, "sol");

      expect(replyMock).toHaveBeenNthCalledWith(1, "Closing everything on SOL...");

      // Should only query SOL market (perpId 48)
      expect(mockClient.getOpenOrders).toHaveBeenCalledWith(48n, 1n);
      expect(mockClient.getPosition).toHaveBeenCalledWith(48n, 1n);
    });

    it("should handle no exchange account error", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 0n, // No account
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleCloseAll(ctx);

      const message = replyMock.mock.calls[1][0];
      expect(message).toContain("No exchange account found");
    });

    it("should report errors for failed order cancellations", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      let callCount = 0;
      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getOpenOrders: vi.fn().mockResolvedValue([
          { orderId: 1n, orderType: 0, priceONS: 50000, lotLNS: 1000n, leverageHdths: 200 },
        ]),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 0n,
            positionType: 0,
            pricePNS: 0n,
            pnlCNS: 0n,
          },
          markPrice: 0n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("Transaction reverted");
          }
          return "0xsuccesstx";
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleCloseAll(ctx);

      const message = replyMock.mock.calls[1][0];
      expect(message).toContain("Errors");
      expect(message).toContain("Transaction reverted");
    });

    it("should handle zero orders and zero positions gracefully", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
          balanceCNS: 1000000000n,
        }),
        getOpenOrders: vi.fn().mockResolvedValue([]),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 0n,
            positionType: 0,
            pricePNS: 0n,
            pnlCNS: 0n,
          },
          markPrice: 0n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = {
        user: undefined,
        reply: replyMock,
      } as any;

      await handleCloseAll(ctx);

      const message = replyMock.mock.calls[1][0];
      expect(message).toContain("Orders cancelled: 0");
      expect(message).toContain("Positions closed: 0");
    });
  });

  describe("Order type determination", () => {
    it("should use CloseLong for long positions", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
        }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 0, // Long
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 51000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xtxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleClosePosition(ctx, "btc");

      // Verify execOrder was called with CloseLong (orderType 2)
      const orderArg = mockClient.execOrder.mock.calls[0][0];
      expect(orderArg.orderType).toBe(2); // CloseLong
    });

    it("should use CloseShort for short positions", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({
          accountId: 1n,
        }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 1, // Short
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 49000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xtxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleClosePosition(ctx, "btc");

      // Verify execOrder was called with CloseShort (orderType 3)
      const orderArg = mockClient.execOrder.mock.calls[0][0];
      expect(orderArg.orderType).toBe(3); // CloseShort
    });
  });

  describe("Slippage calculation", () => {
    it("should apply 1% negative slippage for long positions", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({ accountId: 1n }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 0, // Long
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 50000000000000n, // 50000 with 9 decimals
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xtxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleClosePosition(ctx, "btc");

      const orderArg = mockClient.execOrder.mock.calls[0][0];
      // For a long close, slippage price = currentPrice * 0.99
      // 50000 * 0.99 = 49500
      // In PNS (9 decimals): 49500000000000
      expect(orderArg.pricePNS).toBe(49500000000000n);
    });

    it("should apply 1% positive slippage for short positions", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({ accountId: 1n }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 1, // Short
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 50000000000000n, // 50000 with 9 decimals
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xtxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleClosePosition(ctx, "btc");

      const orderArg = mockClient.execOrder.mock.calls[0][0];
      // For a short close, slippage price = currentPrice * 1.01
      // 50000 * 1.01 = 50500
      // In PNS (9 decimals): 50500000000000
      expect(orderArg.pricePNS).toBe(50500000000000n);
    });
  });

  describe("Market order flags", () => {
    it("should set immediateOrCancel=true for market close orders", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleClosePosition } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({ accountId: 1n }),
        getPosition: vi.fn().mockResolvedValue({
          position: {
            lotLNS: 100000000000n,
            positionType: 0,
            pricePNS: 50000000000000n,
            pnlCNS: 0n,
          },
          markPrice: 50000000000000n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
        execOrder: vi.fn().mockResolvedValue("0xtxhash"),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleClosePosition(ctx, "btc");

      const orderArg = mockClient.execOrder.mock.calls[0][0];
      expect(orderArg.immediateOrCancel).toBe(true);
      expect(orderArg.postOnly).toBe(false);
      expect(orderArg.fillOrKill).toBe(false);
    });
  });

  describe("All markets iteration", () => {
    it("should iterate through all 5 markets when no specific market given", async () => {
      const { createHybridClient } = await import("../../src/bot/client.js");
      const { handleCloseAll } = await import("../../src/bot/handlers/close.js");

      const mockClient = {
        getAccountByAddress: vi.fn().mockResolvedValue({ accountId: 1n }),
        getOpenOrders: vi.fn().mockResolvedValue([]),
        getPosition: vi.fn().mockResolvedValue({
          position: { lotLNS: 0n, positionType: 0, pricePNS: 0n, pnlCNS: 0n },
          markPrice: 0n,
        }),
        getPerpetualInfo: vi.fn().mockResolvedValue({
          priceDecimals: 9,
          lotDecimals: 9,
        }),
      };

      (createHybridClient as any).mockResolvedValue(mockClient);

      const replyMock = vi.fn();
      const ctx = { user: undefined, reply: replyMock } as any;

      await handleCloseAll(ctx);

      // Should query all 5 markets: BTC(16), ETH(32), SOL(48), MON(64), ZEC(256)
      expect(mockClient.getOpenOrders).toHaveBeenCalledTimes(5);
      expect(mockClient.getPosition).toHaveBeenCalledTimes(5);

      // Verify each market was queried
      const openOrdersCalls = mockClient.getOpenOrders.mock.calls;
      const perpIds = openOrdersCalls.map((call: any[]) => call[0]);
      expect(perpIds).toContain(16n);  // BTC
      expect(perpIds).toContain(32n);  // ETH
      expect(perpIds).toContain(48n);  // SOL
      expect(perpIds).toContain(64n);  // MON
      expect(perpIds).toContain(256n); // ZEC
    });
  });
});
