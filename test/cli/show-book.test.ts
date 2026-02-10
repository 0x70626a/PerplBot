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
        exchangeAddress: "0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7",
        collateralToken: "0xdF5B718d8FcC173335185a2a1513eE8151e3c027",
      },
    })),
    validateOwnerConfig: vi.fn(),
    Exchange: vi.fn().mockImplementation(() => ({
      getPerpetualInfo: (...args: any[]) => mockGetPerpetualInfo(...args),
      getVolumeAtBookPrice: (...args: any[]) => mockGetVolumeAtBookPrice(...args),
      getNextPriceBelowWithOrders: (...args: any[]) => mockGetNextPriceBelowWithOrders(...args),
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
  synthPerpPricePNS: 0n,
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

  async function runShowBook(perp = "btc", depth = "10") {
    const { registerShowCommand } = await import("../../src/cli/show.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerShowCommand(program);
    await program.parseAsync(["node", "test", "show", "book", "--perp", perp, "--depth", depth]);
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
});
