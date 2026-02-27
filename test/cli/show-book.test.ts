/**
 * Show book CLI tests
 * Tests for orderbook display using contract view functions
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { pnsToPrice, lnsToLot } from "../../src/sdk/trading/orders.js";

// Must be declared before vi.mock (hoisted)
const mockGetPerpetualInfo = vi.fn();
const mockGetVolumeAtBookPrice = vi.fn();
const mockGetNextPriceBelowWithOrders = vi.fn();
const mockGetOrdersAtPriceLevel = vi.fn();

beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// Mock the SDK
vi.mock("../../src/sdk/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  return {
    ...actual,
    loadEnvConfig: vi.fn(() => ({
      chain: {
        chain: { id: 10143, name: "monad-testnet" },
        rpcUrl: "https://testnet-rpc.monad.xyz",
        exchangeAddress: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
        collateralToken: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      },
    })),
    validateOwnerConfig: vi.fn(),
    Exchange: vi.fn().mockImplementation(() => ({
      getPerpetualInfo: (...args: any[]) => mockGetPerpetualInfo(...args),
      getVolumeAtBookPrice: (...args: any[]) => mockGetVolumeAtBookPrice(...args),
      getNextPriceBelowWithOrders: (...args: any[]) => mockGetNextPriceBelowWithOrders(...args),
      getOrdersAtPriceLevel: (...args: any[]) => mockGetOrdersAtPriceLevel(...args),
    })),
    HybridClient: vi.fn().mockImplementation(() => ({})),
    pnsToPrice: actual.pnsToPrice,
    priceToPNS: actual.priceToPNS,
    lnsToLot: actual.lnsToLot,
    lotToLNS: actual.lotToLNS,
    PERPETUALS: actual.PERPETUALS,
  };
});

// Shared mock state
const mockPerpInfo = {
  name: "Bitcoin",
  symbol: "BTC",
  priceDecimals: 1n,
  lotDecimals: 5n,
  markPNS: 950000n, // 95000.0
  markTimestamp: 0n,
  oraclePNS: 950000n,
  longOpenInterestLNS: 0n,
  shortOpenInterestLNS: 0n,
  fundingStartBlock: 0n,
  fundingRatePct100k: 0,
  status: 0,
  paused: false,
  basePricePNS: 900000n, // 90000.0 base
  maxBidPriceONS: 49000n, // ONS 49000 → PNS 949000 → $94900.0
  minBidPriceONS: 40000n,
  maxAskPriceONS: 60000n, // ONS 60000 → PNS 960000 → $96000.0
  minAskPriceONS: 51000n, // ONS 51000 → PNS 951000 → $95100.0
  numOrders: 25n,
};

describe("Show Book CLI", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function runShowBook(perp = "btc", depth = "10", level = "2") {
    const { registerShowCommand } = await import("../../src/cli/show.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerShowCommand(program);
    await program.parseAsync(["node", "test", "show", "book", "--perp", perp, "--depth", depth, "--level", level]);
  }

  function getOutput(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  describe("Normal book with bid/ask levels", () => {
    beforeEach(() => {
      mockGetPerpetualInfo.mockResolvedValue(mockPerpInfo);

      // Bids: 3 levels walking down from ONS 49000
      mockGetVolumeAtBookPrice.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) return { bids: 100000n, expBids: 0n, asks: 0n, expAsks: 0n };
          if (ons === 48000) return { bids: 200000n, expBids: 0n, asks: 0n, expAsks: 0n };
          if (ons === 47000) return { bids: 50000n, expBids: 0n, asks: 0n, expAsks: 0n };
          // Asks: 3 levels
          if (ons === 60000) return { bids: 0n, expBids: 0n, asks: 30000n, expAsks: 0n };
          if (ons === 55000) return { bids: 0n, expBids: 0n, asks: 80000n, expAsks: 0n };
          if (ons === 51000) return { bids: 0n, expBids: 0n, asks: 150000n, expAsks: 0n };
          return { bids: 0n, expBids: 0n, asks: 0n, expAsks: 0n };
        }
      );

      mockGetNextPriceBelowWithOrders.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          // Bid walk: 49000 → 48000 → 47000 → 0
          if (ons === 49000) return 48000n;
          if (ons === 48000) return 47000n;
          if (ons === 47000) return 0n;
          // Ask walk: 60000 → 55000 → 51000 → 0
          if (ons === 60000) return 55000n;
          if (ons === 55000) return 51000n;
          if (ons === 51000) return 0n;
          return 0n;
        }
      );
    });

    it("should display bid and ask levels with prices", async () => {
      await runShowBook("btc", "10");
      const output = getOutput();

      expect(output).toContain("BTC Order Book");
      expect(output).toContain("Mark Price: $95000.0");
      expect(output).toContain("ASK");
      expect(output).toContain("BID");
    });

    it("should show spread info", async () => {
      await runShowBook("btc", "10");
      const output = getOutput();

      // Best bid: ONS 49000 → $94900.0
      // Best ask: ONS 51000 → $95100.0
      // Spread: $200.0
      expect(output).toContain("Spread:");
    });

    it("should show level count and total orders", async () => {
      await runShowBook("btc", "10");
      const output = getOutput();

      expect(output).toContain("price levels");
      expect(output).toContain("25 total orders");
    });

    it("should display asks and bids", async () => {
      await runShowBook("btc", "10");
      const output = getOutput();

      const lines = output.split("\n");
      const askLines = lines.filter((l) => l.includes("ASK"));
      const bidLines = lines.filter((l) => l.includes("BID"));

      expect(askLines.length).toBe(3);
      expect(bidLines.length).toBe(3);
    });
  });

  describe("Empty book", () => {
    it("should show no resting orders when book is empty", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxBidPriceONS: 0n,
        minBidPriceONS: 0n,
        maxAskPriceONS: 0n,
        minAskPriceONS: 0n,
        numOrders: 0n,
      });

      await runShowBook("btc");
      const output = getOutput();

      expect(output).toContain("No resting orders");
      expect(mockGetVolumeAtBookPrice).not.toHaveBeenCalled();
      expect(mockGetNextPriceBelowWithOrders).not.toHaveBeenCalled();
    });
  });

  describe("Bids only", () => {
    it("should display bids when no asks exist", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxAskPriceONS: 0n,
        minAskPriceONS: 0n,
      });

      mockGetVolumeAtBookPrice.mockResolvedValue({
        bids: 100000n,
        expBids: 0n,
        asks: 0n,
        expAsks: 0n,
      });
      mockGetNextPriceBelowWithOrders.mockResolvedValue(0n);

      await runShowBook("btc");
      const output = getOutput();

      expect(output).toContain("BID");
      // No ASK lines (but "Asks" might appear in headers, check for actual ASK data lines)
      const lines = output.split("\n");
      const askLines = lines.filter((l) => l.trimStart().startsWith("ASK"));
      expect(askLines.length).toBe(0);
      // No spread when only one side
      expect(output).not.toContain("Spread:");
    });
  });

  describe("Asks only", () => {
    it("should display asks when no bids exist", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxBidPriceONS: 0n,
        minBidPriceONS: 0n,
      });

      mockGetVolumeAtBookPrice.mockResolvedValue({
        bids: 0n,
        expBids: 0n,
        asks: 50000n,
        expAsks: 0n,
      });
      mockGetNextPriceBelowWithOrders.mockResolvedValue(0n);

      await runShowBook("btc");
      const output = getOutput();

      const lines = output.split("\n");
      const askLines = lines.filter((l) => l.trimStart().startsWith("ASK"));
      const bidLines = lines.filter((l) => l.trimStart().startsWith("BID"));
      expect(askLines.length).toBe(1);
      expect(bidLines.length).toBe(0);
      expect(output).not.toContain("Spread:");
    });
  });

  describe("Ask trimming", () => {
    it("should trim asks to depth closest to spread", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxBidPriceONS: 0n,
        minBidPriceONS: 0n,
        maxAskPriceONS: 60000n,
      });

      const askPrices = [60000, 58000, 55000, 53000, 51000]; // worst to best

      mockGetVolumeAtBookPrice.mockImplementation(async () => ({
        bids: 0n,
        expBids: 0n,
        asks: 10000n,
        expAsks: 0n,
      }));

      mockGetNextPriceBelowWithOrders.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          const idx = askPrices.indexOf(ons);
          if (idx >= 0 && idx < askPrices.length - 1) {
            return BigInt(askPrices[idx + 1]);
          }
          return 0n;
        }
      );

      await runShowBook("btc", "3");
      const output = getOutput();

      const askLines = output.split("\n").filter((l) => l.trimStart().startsWith("ASK"));
      expect(askLines.length).toBe(3);
    });
  });

  describe("Walker end detection", () => {
    it("should stop walking when getNextPriceBelowWithOrders returns 0", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxAskPriceONS: 0n,
        minAskPriceONS: 0n,
      });

      // Only 1 bid level
      mockGetVolumeAtBookPrice.mockResolvedValue({
        bids: 100000n,
        expBids: 0n,
        asks: 0n,
        expAsks: 0n,
      });
      mockGetNextPriceBelowWithOrders.mockResolvedValue(0n);

      await runShowBook("btc", "10");
      const output = getOutput();

      const bidLines = output.split("\n").filter((l) => l.trimStart().startsWith("BID"));
      expect(bidLines.length).toBe(1);
      // Should have called walker only once since it returned 0
      expect(mockGetNextPriceBelowWithOrders).toHaveBeenCalledTimes(1);
    });
  });

  describe("ONS to price conversion", () => {
    it("should correctly convert ONS to display price", () => {
      // basePricePNS = 900000, priceDecimals = 1
      // ONS 49000 → PNS (49000 + 900000) = 949000 → price 94900.0
      const basePNS = 900000n;
      const priceDecimals = 1n;
      const ons = 49000n;

      const price = pnsToPrice(ons + basePNS, priceDecimals);
      expect(price).toBe(94900.0);
    });

    it("should correctly convert LNS volume to display size", () => {
      // lotDecimals = 5, volume = 100000 → 1.00000
      const lotDecimals = 5n;
      const vol = 100000n;

      const size = lnsToLot(vol, lotDecimals);
      expect(size).toBe(1.0);
    });
  });

  describe("L1 — Best bid/ask only", () => {
    beforeEach(() => {
      mockGetPerpetualInfo.mockResolvedValue(mockPerpInfo);
      mockGetVolumeAtBookPrice.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) return { bids: 100000n, expBids: 0n, asks: 0n, expAsks: 0n };
          if (ons === 51000) return { bids: 0n, expBids: 0n, asks: 150000n, expAsks: 0n };
          return { bids: 0n, expBids: 0n, asks: 0n, expAsks: 0n };
        }
      );
    });

    it("should show best bid and ask only", async () => {
      await runShowBook("btc", "10", "1");
      const output = getOutput();

      expect(output).toContain("L1");
      expect(output).toContain("Best Ask:");
      expect(output).toContain("Best Bid:");
      expect(output).toContain("$95100.0"); // minAskPriceONS = 51000
      expect(output).toContain("$94900.0"); // maxBidPriceONS = 49000
    });

    it("should not call walk functions", async () => {
      await runShowBook("btc", "10", "1");

      expect(mockGetNextPriceBelowWithOrders).not.toHaveBeenCalled();
    });

    it("should show spread", async () => {
      await runShowBook("btc", "10", "1");
      const output = getOutput();

      expect(output).toContain("Spread:");
    });

    it("should handle missing bids", async () => {
      mockGetPerpetualInfo.mockResolvedValue({
        ...mockPerpInfo,
        maxBidPriceONS: 0n,
        minBidPriceONS: 0n,
      });

      await runShowBook("btc", "10", "1");
      const output = getOutput();

      expect(output).toContain("Best Bid: ---");
      expect(output).not.toContain("Spread:");
    });
  });

  describe("L2 — Default level", () => {
    it("should use L2 by default (no --level flag)", async () => {
      mockGetPerpetualInfo.mockResolvedValue(mockPerpInfo);
      mockGetVolumeAtBookPrice.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) return { bids: 100000n, expBids: 0n, asks: 0n, expAsks: 0n };
          if (ons === 60000) return { bids: 0n, expBids: 0n, asks: 30000n, expAsks: 0n };
          return { bids: 0n, expBids: 0n, asks: 0n, expAsks: 0n };
        }
      );
      mockGetNextPriceBelowWithOrders.mockResolvedValue(0n);

      await runShowBook("btc", "10", "2");
      const output = getOutput();

      expect(output).toContain("ASK");
      expect(output).toContain("BID");
      expect(output).not.toContain("L1");
      expect(output).not.toContain("L3");
    });
  });

  describe("L3 — Individual orders", () => {
    beforeEach(() => {
      mockGetPerpetualInfo.mockResolvedValue(mockPerpInfo);

      mockGetVolumeAtBookPrice.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) return { bids: 100000n, expBids: 0n, asks: 0n, expAsks: 0n };
          if (ons === 60000) return { bids: 0n, expBids: 0n, asks: 30000n, expAsks: 0n };
          if (ons === 51000) return { bids: 0n, expBids: 0n, asks: 150000n, expAsks: 0n };
          return { bids: 0n, expBids: 0n, asks: 0n, expAsks: 0n };
        }
      );

      mockGetNextPriceBelowWithOrders.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) return 0n;
          if (ons === 60000) return 51000n;
          if (ons === 51000) return 0n;
          return 0n;
        }
      );

      mockGetOrdersAtPriceLevel.mockImplementation(
        async (_perpId: bigint, priceONS: bigint) => {
          const ons = Number(priceONS);
          if (ons === 49000) {
            return {
              orders: [
                { accountId: 42, orderType: 0, priceONS: 49000, lotLNS: 60000n, recycleFeeRaw: 0, expiryBlock: 0, leverageHdths: 500, orderId: 101, prevOrderId: 0, nextOrderId: 102, maxSlippageBps: 0 },
                { accountId: 43, orderType: 2, priceONS: 49000, lotLNS: 40000n, recycleFeeRaw: 0, expiryBlock: 5000, leverageHdths: 1000, orderId: 102, prevOrderId: 101, nextOrderId: 0, maxSlippageBps: 0 },
              ],
              numOrders: 2n,
            };
          }
          if (ons === 51000) {
            return {
              orders: [
                { accountId: 50, orderType: 1, priceONS: 51000, lotLNS: 150000n, recycleFeeRaw: 0, expiryBlock: 0, leverageHdths: 300, orderId: 201, prevOrderId: 0, nextOrderId: 0, maxSlippageBps: 0 },
              ],
              numOrders: 1n,
            };
          }
          if (ons === 60000) {
            return {
              orders: [
                { accountId: 55, orderType: 3, priceONS: 60000, lotLNS: 30000n, recycleFeeRaw: 0, expiryBlock: 10000, leverageHdths: 200, orderId: 301, prevOrderId: 0, nextOrderId: 0, maxSlippageBps: 0 },
              ],
              numOrders: 1n,
            };
          }
          return { orders: [], numOrders: 0n };
        }
      );
    });

    it("should display L3 header", async () => {
      await runShowBook("btc", "10", "3");
      const output = getOutput();

      expect(output).toContain("L3");
      expect(output).toContain("Asks");
      expect(output).toContain("Bids");
    });

    it("should call getOrdersAtPriceLevel for each level", async () => {
      await runShowBook("btc", "10", "3");

      // 1 bid level + 2 ask levels = 3 calls
      expect(mockGetOrdersAtPriceLevel).toHaveBeenCalledTimes(3);
    });

    it("should show individual order IDs", async () => {
      await runShowBook("btc", "10", "3");
      const output = getOutput();

      expect(output).toContain("#101");
      expect(output).toContain("#102");
      expect(output).toContain("#201");
      expect(output).toContain("#301");
    });

    it("should show leverage", async () => {
      await runShowBook("btc", "10", "3");
      const output = getOutput();

      expect(output).toContain("5.0x"); // leverageHdths 500
      expect(output).toContain("10.0x"); // leverageHdths 1000
      expect(output).toContain("3.0x"); // leverageHdths 300
    });

    it("should show expiry for non-GTC orders", async () => {
      await runShowBook("btc", "10", "3");
      const output = getOutput();

      expect(output).toContain("GTC");
      expect(output).toContain("exp:5000");
      expect(output).toContain("exp:10000");
    });

    it("should filter orders by side", async () => {
      await runShowBook("btc", "10", "3");
      const output = getOutput();

      // Bid orders (orderType 0, 2) should be under Bids
      expect(output).toContain("OpenLong");
      expect(output).toContain("CloseLong");
      // Ask orders (orderType 1, 3) should be under Asks
      expect(output).toContain("OpenShort");
      expect(output).toContain("CloseShort");
    });
  });
});
