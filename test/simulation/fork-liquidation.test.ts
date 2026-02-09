/**
 * Fork-based liquidation simulation tests
 * Unit tests for slot computation, boundary detection, config merge, divergence math.
 * Report rendering tests. Integration tests gated by Anvil availability.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  computeMappingSlot,
  computeDivergence,
  findBoundaryFromSweep,
  extractField,
  writeField,
  DEFAULT_FORK_LIQUIDATION_CONFIG,
  type ForkPricePoint,
  type ForkLiquidationResult,
} from "../../src/sdk/simulation/fork-liquidation.js";
import { priceToPNS } from "../../src/sdk/trading/orders.js";
import { keccak256, encodePacked, pad, numberToHex } from "viem";

// Disable chalk colors for deterministic test output
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// ============ computeMappingSlot tests ============

describe("computeMappingSlot", () => {
  it("should compute keccak256(abi.encode(key, slot)) for offset 0", () => {
    const perpId = 16n;
    const baseSlot = 5;
    const result = computeMappingSlot(perpId, baseSlot, 0);

    // Manually compute expected: keccak256(abi.encode(16, 5))
    const keyHex = pad(numberToHex(perpId), { size: 32 });
    const slotHex = pad(numberToHex(baseSlot), { size: 32 });
    const expected = keccak256(encodePacked(["bytes32", "bytes32"], [keyHex, slotHex]));

    expect(result).toBe(expected);
  });

  it("should add offset to derived slot", () => {
    const perpId = 16n;
    const baseSlot = 5;

    const base = computeMappingSlot(perpId, baseSlot, 0);
    const withOffset = computeMappingSlot(perpId, baseSlot, 3);

    const expectedBigInt = BigInt(base) + 3n;
    const expected = pad(numberToHex(expectedBigInt), { size: 32 });

    expect(withOffset).toBe(expected);
  });

  it("should produce different slots for different perpIds", () => {
    const slot1 = computeMappingSlot(16n, 5, 0);
    const slot2 = computeMappingSlot(32n, 5, 0);
    expect(slot1).not.toBe(slot2);
  });

  it("should produce different slots for different base slots", () => {
    const slot1 = computeMappingSlot(16n, 5, 0);
    const slot2 = computeMappingSlot(16n, 6, 0);
    expect(slot1).not.toBe(slot2);
  });

  it("should handle perpId 0", () => {
    const result = computeMappingSlot(0n, 0, 0);
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("should produce a valid 32-byte hex string", () => {
    const result = computeMappingSlot(16n, 42, 7);
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ============ extractField / writeField tests ============

describe("extractField", () => {
  it("should extract lowest 32 bits", () => {
    const word = 0xDEADBEEF12345678n;
    expect(extractField(word, 0, 32)).toBe(0x12345678n);
  });

  it("should extract bits [32:64]", () => {
    const word = 0xDEADBEEF12345678n;
    expect(extractField(word, 32, 32)).toBe(0xDEADBEEFn);
  });

  it("should extract a 16-bit field", () => {
    const word = 0xABCD1234n;
    expect(extractField(word, 16, 16)).toBe(0xABCDn);
  });

  it("should handle zero word", () => {
    expect(extractField(0n, 0, 32)).toBe(0n);
    expect(extractField(0n, 64, 32)).toBe(0n);
  });

  it("should extract from high bits of 256-bit word", () => {
    const word = 1n << 224n; // bit 224 set
    expect(extractField(word, 224, 32)).toBe(1n);
    expect(extractField(word, 192, 32)).toBe(0n);
  });
});

describe("writeField", () => {
  it("should write to lowest 32 bits without affecting upper bits", () => {
    const word = 0xAAAABBBBCCCCDDDDn;
    const result = writeField(word, 0, 32, 0x11111111n);
    expect(extractField(result, 0, 32)).toBe(0x11111111n);
    expect(extractField(result, 32, 32)).toBe(extractField(word, 32, 32));
  });

  it("should write to bits [32:64] without affecting other bits", () => {
    const word = 0xAAAABBBBCCCCDDDDn;
    const result = writeField(word, 32, 32, 0x99999999n);
    expect(extractField(result, 32, 32)).toBe(0x99999999n);
    expect(extractField(result, 0, 32)).toBe(extractField(word, 0, 32));
  });

  it("should preserve all other fields in a multi-field word", () => {
    // Simulate a packed word with 4 fields: [0:32] [32:64] [64:96] [96:128]
    let word = 0n;
    word = writeField(word, 0, 32, 100n);
    word = writeField(word, 32, 32, 200n);
    word = writeField(word, 64, 32, 300n);
    word = writeField(word, 96, 32, 400n);

    expect(extractField(word, 0, 32)).toBe(100n);
    expect(extractField(word, 32, 32)).toBe(200n);
    expect(extractField(word, 64, 32)).toBe(300n);
    expect(extractField(word, 96, 32)).toBe(400n);

    // Modify only field [32:64]
    const modified = writeField(word, 32, 32, 999n);
    expect(extractField(modified, 0, 32)).toBe(100n);  // unchanged
    expect(extractField(modified, 32, 32)).toBe(999n);  // changed
    expect(extractField(modified, 64, 32)).toBe(300n);  // unchanged
    expect(extractField(modified, 96, 32)).toBe(400n);  // unchanged
  });

  it("should mask value to field width", () => {
    const result = writeField(0n, 0, 8, 0xFFFFn); // 16 bits into 8-bit field
    expect(extractField(result, 0, 8)).toBe(0xFFn); // truncated to 8 bits
  });

  it("should handle zero value", () => {
    const word = writeField(0xFFFFFFFFn, 0, 32, 0n);
    expect(word).toBe(0n);
  });
});

// ============ computeDivergence tests ============

describe("computeDivergence", () => {
  it("should compute zero divergence when prices match", () => {
    const { pct, usd } = computeDivergence(100000, 100000);
    expect(pct).toBe(0);
    expect(usd).toBe(0);
  });

  it("should compute positive divergence when fork price is higher", () => {
    const { pct, usd } = computeDivergence(101000, 100000);
    expect(usd).toBe(1000);
    expect(pct).toBeCloseTo(1, 2);
  });

  it("should compute negative divergence when fork price is lower", () => {
    const { pct, usd } = computeDivergence(99000, 100000);
    expect(usd).toBe(-1000);
    expect(pct).toBeCloseTo(-1, 2);
  });

  it("should handle zero math price", () => {
    const { pct, usd } = computeDivergence(5000, 0);
    expect(pct).toBe(0);
    expect(usd).toBe(0);
  });

  it("should handle small divergences", () => {
    const { pct } = computeDivergence(100000.50, 100000);
    expect(pct).toBeCloseTo(0.0005, 4);
  });
});

// ============ findBoundaryFromSweep tests ============

describe("findBoundaryFromSweep", () => {
  function makePoint(price: number, isLiquidatable: boolean): ForkPricePoint {
    return {
      price,
      pricePNS: priceToPNS(price),
      isLiquidatable,
      reverted: !isLiquidatable,
    };
  }

  it("should find boundary for long position (liquidatable at low prices)", () => {
    const points: ForkPricePoint[] = [
      makePoint(90000, true),
      makePoint(92000, true),
      makePoint(94000, true),
      makePoint(96000, false),
      makePoint(98000, false),
      makePoint(100000, false),
    ];

    const result = findBoundaryFromSweep(points, true);
    expect(result).not.toBeNull();
    expect(result!.lastSafe.price).toBe(96000);
    expect(result!.firstLiquidatable.price).toBe(94000);
  });

  it("should find boundary for short position (liquidatable at high prices)", () => {
    const points: ForkPricePoint[] = [
      makePoint(90000, false),
      makePoint(95000, false),
      makePoint(100000, false),
      makePoint(105000, true),
      makePoint(110000, true),
    ];

    const result = findBoundaryFromSweep(points, false);
    expect(result).not.toBeNull();
    expect(result!.lastSafe.price).toBe(100000);
    expect(result!.firstLiquidatable.price).toBe(105000);
  });

  it("should return null when all points are safe", () => {
    const points: ForkPricePoint[] = [
      makePoint(90000, false),
      makePoint(95000, false),
      makePoint(100000, false),
    ];

    expect(findBoundaryFromSweep(points, true)).toBeNull();
    expect(findBoundaryFromSweep(points, false)).toBeNull();
  });

  it("should return null when all points are liquidatable", () => {
    const points: ForkPricePoint[] = [
      makePoint(90000, true),
      makePoint(95000, true),
      makePoint(100000, true),
    ];

    expect(findBoundaryFromSweep(points, true)).toBeNull();
    expect(findBoundaryFromSweep(points, false)).toBeNull();
  });

  it("should handle unsorted points", () => {
    const points: ForkPricePoint[] = [
      makePoint(100000, false),
      makePoint(90000, true),
      makePoint(96000, false),
      makePoint(94000, true),
      makePoint(98000, false),
      makePoint(92000, true),
    ];

    const result = findBoundaryFromSweep(points, true);
    expect(result).not.toBeNull();
    expect(result!.lastSafe.price).toBe(96000);
    expect(result!.firstLiquidatable.price).toBe(94000);
  });

  it("should handle single transition point", () => {
    const points: ForkPricePoint[] = [
      makePoint(95000, true),
      makePoint(100000, false),
    ];

    const result = findBoundaryFromSweep(points, true);
    expect(result).not.toBeNull();
    expect(result!.lastSafe.price).toBe(100000);
    expect(result!.firstLiquidatable.price).toBe(95000);
  });
});

// ============ Config merge tests ============

describe("ForkLiquidationConfig defaults", () => {
  it("should have reasonable defaults", () => {
    const cfg = DEFAULT_FORK_LIQUIDATION_CONFIG;
    expect(cfg.priceRangePct).toBe(30);
    expect(cfg.priceSteps).toBe(20);
    expect(cfg.binarySearchIterations).toBe(10);
    expect(cfg.anvilTimeout).toBe(30_000);
    expect(cfg.maintenanceMargin).toBe(0.05);
  });

  it("should allow partial overrides via spread", () => {
    const custom = { priceSteps: 10, priceRangePct: 50 };
    const merged = { ...DEFAULT_FORK_LIQUIDATION_CONFIG, ...custom };

    expect(merged.priceSteps).toBe(10);
    expect(merged.priceRangePct).toBe(50);
    expect(merged.binarySearchIterations).toBe(10); // default preserved
    expect(merged.maintenanceMargin).toBe(0.05); // default preserved
  });
});

// ============ Report rendering tests ============

describe("Fork liquidation report", () => {
  let printForkLiquidationReport: typeof import("../../src/sdk/simulation/fork-liquidation-report.js").printForkLiquidationReport;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/fork-liquidation-report.js");
    printForkLiquidationReport = mod.printForkLiquidationReport;
  });

  function makeResult(overrides: Partial<ForkLiquidationResult> = {}): ForkLiquidationResult {
    return {
      perpId: 16n,
      perpName: "BTC",
      positionType: "long",
      entryPrice: 100000,
      size: 1,
      collateral: 10000,
      currentMarkPrice: 100000,
      accountId: 1n,
      forkLiquidationPrice: 94750,
      mathLiquidationPrice: 94736.84,
      divergencePct: 0.014,
      divergenceUsd: 13.16,
      forkPricePoints: [
        { price: 70000, pricePNS: priceToPNS(70000), isLiquidatable: true, reverted: true },
        { price: 80000, pricePNS: priceToPNS(80000), isLiquidatable: true, reverted: true },
        { price: 90000, pricePNS: priceToPNS(90000), isLiquidatable: true, reverted: true },
        { price: 94000, pricePNS: priceToPNS(94000), isLiquidatable: true, reverted: true },
        { price: 96000, pricePNS: priceToPNS(96000), isLiquidatable: false, reverted: false },
        { price: 100000, pricePNS: priceToPNS(100000), isLiquidatable: false, reverted: false },
        { price: 110000, pricePNS: priceToPNS(110000), isLiquidatable: false, reverted: false },
        { price: 120000, pricePNS: priceToPNS(120000), isLiquidatable: false, reverted: false },
        { price: 130000, pricePNS: priceToPNS(130000), isLiquidatable: false, reverted: false },
      ],
      cascadeEvents: [],
      timing: {
        slotDiscoveryMs: 1500,
        sweepMs: 3000,
        binarySearchMs: 2000,
        totalMs: 6500,
      },
      alreadyLiquidatable: false,
      ...overrides,
    };
  }

  it("should not throw when printing a normal report", () => {
    const result = makeResult();

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printForkLiquidationReport(result)).not.toThrow();
    expect(logs.length).toBeGreaterThan(5);
  });

  it("should include key information in output", () => {
    const result = makeResult();

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("BTC-PERP");
    expect(output).toContain("LONG");
    expect(output).toContain("Fork-Verified");
    expect(output).toContain("Math Estimate");
    expect(output).toContain("Divergence");
    expect(output).toContain("Performance");
  });

  it("should display FORK LIQUIDATION SIMULATOR header", () => {
    const result = makeResult();

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("FORK LIQUIDATION SIMULATOR");
  });

  it("should handle already-liquidatable position", () => {
    const result = makeResult({
      alreadyLiquidatable: true,
      forkPricePoints: [],
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printForkLiquidationReport(result)).not.toThrow();

    const output = logs.join("\n");
    expect(output).toContain("ALREADY LIQUIDATABLE");
  });

  it("should handle short position", () => {
    const result = makeResult({
      positionType: "short",
      forkLiquidationPrice: 105000,
      mathLiquidationPrice: 104761.90,
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printForkLiquidationReport(result)).not.toThrow();

    const output = logs.join("\n");
    expect(output).toContain("SHORT");
  });

  it("should display cascade events when present", () => {
    const result = makeResult({
      cascadeEvents: [
        { eventName: "PositionClosed", args: { accountId: 1n, perpId: 16n } },
        { eventName: "CollateralSeized", args: { amount: 500n } },
      ],
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("Cascade Effects");
    expect(output).toContain("PositionClosed");
    expect(output).toContain("CollateralSeized");
  });

  it("should display performance timing", () => {
    const result = makeResult();

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("Slot Discovery");
    expect(output).toContain("Price Sweep");
    expect(output).toContain("Binary Search");
    expect(output).toContain("Total");
  });

  it("should show agreement summary for small divergence", () => {
    const result = makeResult({ divergencePct: 0.01 });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("agree");
  });

  it("should show significant divergence warning", () => {
    const result = makeResult({ divergencePct: 2.5 });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForkLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("diverge significantly");
  });

  it("should handle empty price points gracefully", () => {
    const result = makeResult({ forkPricePoints: [] });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printForkLiquidationReport(result)).not.toThrow();
  });
});
