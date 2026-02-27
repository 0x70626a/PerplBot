/**
 * Strategy simulation tests
 * Tests for config validation, mapEventsToOrderResults, report formatting,
 * CLI registration, and strategy integration
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { OrderType, type OrderDesc, type PerpetualInfo } from "../../src/sdk/contracts/Exchange.js";
import { priceToPNS, lotToLNS, leverageToHdths } from "../../src/sdk/trading/orders.js";
import type { DecodedEvent } from "../../src/sdk/simulation/dry-run.js";
import type { MatchInfo } from "../../src/sdk/simulation/forensics.js";

// Disable chalk colors for deterministic test output
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// ============ Test Fixtures ============

const makeOrderDesc = (overrides?: Partial<OrderDesc>): OrderDesc => ({
  orderDescId: 0n,
  perpId: 16n,
  orderType: OrderType.OpenLong,
  orderId: 0n,
  pricePNS: priceToPNS(50000, 1n),
  lotLNS: lotToLNS(0.001, 5n),
  expiryBlock: 0n,
  postOnly: false,
  fillOrKill: false,
  immediateOrCancel: false,
  maxMatches: 0n,
  leverageHdths: leverageToHdths(2),
  lastExecutionBlock: 0n,
  amountCNS: 0n,
  maxSlippageBps: 0n,
  ...overrides,
});

const makePerpInfo = (overrides?: Partial<PerpetualInfo>): PerpetualInfo => ({
  name: "BTC",
  symbol: "BTC",
  priceDecimals: 1n,
  lotDecimals: 5n,
  markPNS: 985000n,
  markTimestamp: 0n,
  oraclePNS: 985000n,
  longOpenInterestLNS: 500000n,
  shortOpenInterestLNS: 300000n,
  fundingStartBlock: 0n,
  fundingRatePct100k: 0,
  status: 0,
  paused: false,
  basePricePNS: 900000n,
  maxBidPriceONS: 70500n,
  minBidPriceONS: 60000n,
  maxAskPriceONS: 72000n,
  minAskPriceONS: 85000n,
  numOrders: 12n,
  ...overrides,
});

import type { StrategySimResult, OrderResult } from "../../src/sdk/simulation/strategy-sim.js";
import type { AccountSnapshot } from "../../src/sdk/simulation/dry-run.js";

const makeSimResult = (overrides?: Partial<StrategySimResult>): StrategySimResult => ({
  strategyType: "grid",
  perpId: 16n,
  perpName: "BTC",
  perpInfo: makePerpInfo(),
  priceDecimals: 1n,
  lotDecimals: 5n,
  midPrice: 98500,
  gridConfig: {
    centerPrice: 98500,
    gridLevels: 3,
    gridSpacing: 100,
    orderSize: 0.001,
    leverage: 2,
  },
  orderDescs: [
    makeOrderDesc({ orderType: OrderType.OpenLong, pricePNS: priceToPNS(98200, 1n) }),
    makeOrderDesc({ orderType: OrderType.OpenLong, pricePNS: priceToPNS(98300, 1n) }),
    makeOrderDesc({ orderType: OrderType.OpenLong, pricePNS: priceToPNS(98400, 1n) }),
    makeOrderDesc({ orderType: OrderType.OpenShort, pricePNS: priceToPNS(98600, 1n) }),
    makeOrderDesc({ orderType: OrderType.OpenShort, pricePNS: priceToPNS(98700, 1n) }),
    makeOrderDesc({ orderType: OrderType.OpenShort, pricePNS: priceToPNS(98800, 1n) }),
  ],
  orderResults: [
    { index: 0, orderType: OrderType.OpenLong, pricePNS: priceToPNS(98200, 1n), lotLNS: lotToLNS(0.001, 5n), status: "resting", matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: 1n },
    { index: 1, orderType: OrderType.OpenLong, pricePNS: priceToPNS(98300, 1n), lotLNS: lotToLNS(0.001, 5n), status: "resting", matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: 2n },
    { index: 2, orderType: OrderType.OpenLong, pricePNS: priceToPNS(98400, 1n), lotLNS: lotToLNS(0.001, 5n), status: "filled", matches: [{ makerAccountId: 5n, makerOrderId: 10n, pricePNS: priceToPNS(98400, 1n), lotLNS: lotToLNS(0.001, 5n), feeCNS: 50000n }], avgFillPrice: 98400, totalFeesCNS: 50000n, orderId: null },
    { index: 3, orderType: OrderType.OpenShort, pricePNS: priceToPNS(98600, 1n), lotLNS: lotToLNS(0.001, 5n), status: "filled", matches: [{ makerAccountId: 6n, makerOrderId: 11n, pricePNS: priceToPNS(98600, 1n), lotLNS: lotToLNS(0.001, 5n), feeCNS: 50000n }], avgFillPrice: 98600, totalFeesCNS: 50000n, orderId: null },
    { index: 4, orderType: OrderType.OpenShort, pricePNS: priceToPNS(98700, 1n), lotLNS: lotToLNS(0.001, 5n), status: "resting", matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: 3n },
    { index: 5, orderType: OrderType.OpenShort, pricePNS: priceToPNS(98800, 1n), lotLNS: lotToLNS(0.001, 5n), status: "resting", matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: 4n },
  ],
  totalOrders: 6,
  filledOrders: 2,
  restingOrders: 4,
  failedOrders: 0,
  totalFilledLots: 0.002,
  totalFeesCNS: 100000n,
  preState: {
    balanceCNS: 1000000000n,
    lockedBalanceCNS: 0n,
    position: null,
    ethBalance: 1000000000000000000n,
  },
  postState: {
    balanceCNS: 900000000n,
    lockedBalanceCNS: 100000000n,
    position: null,
    ethBalance: 985000000000000000n,
  },
  gasUsed: 800000n,
  gasPrice: 50000000000n,
  gasCostWei: 40000000000000000n,
  events: [],
  gridMetrics: {
    totalCapital: 59.1,
    profitPerRoundTrip: 0.0008,
    breakevenRoundTrips: 73875,
    maxPositionSize: 0.003,
  },
  takerFeePer100K: 100,
  makerFeePer100K: 50,
  ...overrides,
});

// ============ Config Validation ============

describe("Strategy simulation config validation", () => {
  it("should reject grid strategy without grid config", async () => {
    const { runStrategySimulation } = await import("../../src/sdk/simulation/strategy-sim.js");
    const config = {
      chain: { chain: {} as any, rpcUrl: "http://localhost:8545", exchangeAddress: "0x1" as any, collateralToken: "0x2" as any },
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
    };
    await expect(
      runStrategySimulation(config, { strategyType: "grid", perpId: 16n })
    ).rejects.toThrow("Grid config is required");
  });

  it("should reject mm strategy without mm config", async () => {
    const { runStrategySimulation } = await import("../../src/sdk/simulation/strategy-sim.js");
    const config = {
      chain: { chain: {} as any, rpcUrl: "http://localhost:8545", exchangeAddress: "0x1" as any, collateralToken: "0x2" as any },
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
    };
    await expect(
      runStrategySimulation(config, { strategyType: "mm", perpId: 16n })
    ).rejects.toThrow("MM config is required");
  });

  it("should reject when PRIVATE_KEY is missing", async () => {
    const { runStrategySimulation } = await import("../../src/sdk/simulation/strategy-sim.js");
    const config = {
      chain: { chain: {} as any, rpcUrl: "http://localhost:8545", exchangeAddress: "0x1" as any, collateralToken: "0x2" as any },
    };
    await expect(
      runStrategySimulation(config, {
        strategyType: "grid",
        perpId: 16n,
        grid: { gridLevels: 3, gridSpacing: 100, orderSize: 0.001, leverage: 2 },
      })
    ).rejects.toThrow("PRIVATE_KEY is required");
  });
});

// ============ mapEventsToOrderResults ============

describe("mapEventsToOrderResults", () => {
  let mapEventsToOrderResults: typeof import("../../src/sdk/simulation/strategy-sim.js").mapEventsToOrderResults;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/strategy-sim.js");
    mapEventsToOrderResults = mod.mapEventsToOrderResults;
  });

  it("should map a single filled order", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
      { eventName: "MakerOrderFilled", args: { accountId: 5n, orderId: 10n, pricePNS: 980000n, lotLNS: 100n, feeCNS: 50000n } },
    ];
    const orderDescs = [makeOrderDesc({ pricePNS: 980000n })];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("filled");
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].avgFillPrice).not.toBeNull();
    expect(results[0].totalFeesCNS).toBe(50000n);
  });

  it("should map a resting order with OrderPlaced event", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
      { eventName: "OrderPlaced", args: { orderId: 42n, lotLNS: 100n, lockedBalanceCNS: 50000n, amountCNS: 0n, balanceCNS: 950000n } },
    ];
    const orderDescs = [makeOrderDesc()];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("resting");
    expect(results[0].orderId).toBe(42n);
    expect(results[0].matches).toHaveLength(0);
  });

  it("should map a failed order with no events", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
    ];
    const orderDescs = [makeOrderDesc()];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].matches).toHaveLength(0);
  });

  it("should handle mixed batch: filled, resting, failed", () => {
    const events: DecodedEvent[] = [
      // Order 0: filled
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
      { eventName: "MakerOrderFilled", args: { accountId: 5n, orderId: 10n, pricePNS: 980000n, lotLNS: 100n, feeCNS: 50000n } },
      // Order 1: resting
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 1 } },
      { eventName: "OrderPlaced", args: { orderId: 42n, lotLNS: 100n, lockedBalanceCNS: 50000n, amountCNS: 0n, balanceCNS: 900000n } },
      // Order 2: failed
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
    ];
    const orderDescs = [
      makeOrderDesc({ orderType: OrderType.OpenLong }),
      makeOrderDesc({ orderType: OrderType.OpenShort }),
      makeOrderDesc({ orderType: OrderType.OpenLong }),
    ];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("filled");
    expect(results[1].status).toBe("resting");
    expect(results[2].status).toBe("failed");
  });

  it("should compute avg fill price across multiple matches", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
      { eventName: "MakerOrderFilled", args: { accountId: 5n, orderId: 10n, pricePNS: 1000n, lotLNS: 100n, feeCNS: 10000n } },
      { eventName: "MakerOrderFilled", args: { accountId: 6n, orderId: 11n, pricePNS: 2000n, lotLNS: 100n, feeCNS: 20000n } },
    ];
    const orderDescs = [makeOrderDesc()];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(2);
    // Weighted avg: (1000*100 + 2000*100) / (100+100) = 1500, / 10^1 = 150
    expect(results[0].avgFillPrice).toBe(150);
    expect(results[0].totalFeesCNS).toBe(30000n);
  });

  it("should sum fees across matches", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n, orderType: 0 } },
      { eventName: "MakerOrderFilled", args: { accountId: 5n, orderId: 10n, pricePNS: 1000n, lotLNS: 50n, feeCNS: 25000n } },
      { eventName: "MakerOrderFilled", args: { accountId: 6n, orderId: 11n, pricePNS: 1000n, lotLNS: 50n, feeCNS: 75000n } },
    ];
    const orderDescs = [makeOrderDesc()];
    const results = mapEventsToOrderResults(events, orderDescs, 1n, 5n);

    expect(results[0].totalFeesCNS).toBe(100000n);
  });

  it("should handle empty events list", () => {
    const results = mapEventsToOrderResults([], [], 1n, 5n);
    expect(results).toHaveLength(0);
  });
});

// ============ Report Formatting ============

describe("Strategy simulation report", () => {
  let printStrategySimReport: typeof import("../../src/sdk/simulation/strategy-report.js").printStrategySimReport;
  let strategySimResultToJson: typeof import("../../src/sdk/simulation/strategy-report.js").strategySimResultToJson;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/strategy-report.js");
    printStrategySimReport = mod.printStrategySimReport;
    strategySimResultToJson = mod.strategySimResultToJson;
  });

  it("should print header with strategy type and market", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("STRATEGY DRY RUN");
    expect(output).toContain("GRID");
    expect(output).toContain("BTC-PERP");
  });

  it("should print grid config summary", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Strategy Config:");
    expect(output).toContain("Center:");
    expect(output).toContain("Levels:");
    expect(output).toContain("3 above + 3 below");
    expect(output).toContain("Spacing:");
    expect(output).toContain("2x");
  });

  it("should print MM config summary", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult({
      strategyType: "mm",
      gridConfig: undefined,
      mmConfig: {
        orderSize: 0.001,
        spreadPercent: 0.001,
        leverage: 2,
        maxPosition: 0.01,
      },
      gridMetrics: undefined,
    }));

    const output = logs.join("\n");
    expect(output).toContain("MARKET MAKER");
    expect(output).toContain("Spread:");
    expect(output).toContain("0.10%");
    expect(output).toContain("Max Pos:");
  });

  it("should print order results table", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Order Results:");
    expect(output).toContain("Open Long");
    expect(output).toContain("Open Short");
    expect(output).toContain("FILLED");
    expect(output).toContain("RESTING");
  });

  it("should print fill summary with counts", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Fill Summary:");
    expect(output).toContain("Total Orders:");
    expect(output).toContain("6");
    expect(output).toContain("Filled:");
    expect(output).toContain("2");
    expect(output).toContain("Resting:");
    expect(output).toContain("4");
  });

  it("should print account changes with balance bars", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Account Changes:");
    expect(output).toContain("Balance:");
    expect(output).toContain("█");
    expect(output).toContain("Before:");
    expect(output).toContain("After:");
  });

  it("should print position changes", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Position Changes:");
    expect(output).toContain("No position");
  });

  it("should print gas costs", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Gas:");
    expect(output).toContain("Gas Used:");
    expect(output).toContain("800,000");
    expect(output).toContain("MON");
  });

  it("should print grid metrics when available", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Grid Metrics:");
    expect(output).toContain("Capital Required:");
    expect(output).toContain("Profit/Round-Trip:");
    expect(output).toContain("Breakeven Trips:");
    expect(output).toContain("Max Position:");
  });

  it("should not print grid metrics for MM strategy", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult({
      strategyType: "mm",
      gridConfig: undefined,
      mmConfig: { orderSize: 0.001, spreadPercent: 0.001, leverage: 2, maxPosition: 0.01 },
      gridMetrics: undefined,
    }));

    const output = logs.join("\n");
    expect(output).not.toContain("Grid Metrics:");
  });

  it("should print simulation disclaimer at end", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("simulation on a forked chain");
    expect(output).toContain("No real trades");
  });

  it("should handle 0 filled orders gracefully", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult({
      filledOrders: 0,
      restingOrders: 6,
      failedOrders: 0,
      totalFilledLots: 0,
      totalFeesCNS: 0n,
      orderResults: makeSimResult().orderResults.map(r => ({ ...r, status: "resting" as const, matches: [], avgFillPrice: null, totalFeesCNS: 0n })),
    }));

    const output = logs.join("\n");
    expect(output).toContain("Filled:");
    expect(output).toContain("0");
    expect(output).toContain("Resting:");
  });

  it("should handle all orders filled", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const match: MatchInfo = { makerAccountId: 5n, makerOrderId: 10n, pricePNS: 980000n, lotLNS: 100n, feeCNS: 50000n };
    printStrategySimReport(makeSimResult({
      filledOrders: 6,
      restingOrders: 0,
      failedOrders: 0,
      totalFilledLots: 0.006,
      totalFeesCNS: 300000n,
      orderResults: makeSimResult().orderResults.map(r => ({ ...r, status: "filled" as const, matches: [match], avgFillPrice: 98000, totalFeesCNS: 50000n })),
    }));

    const output = logs.join("\n");
    expect(output).toContain("6");
    // All should show FILLED
    const filledCount = (output.match(/FILLED/g) || []).length;
    expect(filledCount).toBeGreaterThanOrEqual(6);
  });

  it("should show failed orders count in red when > 0", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult({
      failedOrders: 2,
      filledOrders: 2,
      restingOrders: 2,
      orderResults: [
        ...makeSimResult().orderResults.slice(0, 4),
        { index: 4, orderType: OrderType.OpenShort, pricePNS: priceToPNS(98700, 1n), lotLNS: lotToLNS(0.001, 5n), status: "failed" as const, matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: null },
        { index: 5, orderType: OrderType.OpenShort, pricePNS: priceToPNS(98800, 1n), lotLNS: lotToLNS(0.001, 5n), status: "failed" as const, matches: [], avgFillPrice: null, totalFeesCNS: 0n, orderId: null },
      ],
    }));

    const output = logs.join("\n");
    expect(output).toContain("FAILED");
    expect(output).toContain("Failed:");
  });

  it("should print market state with mark price", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Market State:");
    expect(output).toContain("Mark Price:");
    expect(output).toContain("98,500");
  });

  it("should print OI bars when open interest exists", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printStrategySimReport(makeSimResult());

    const output = logs.join("\n");
    expect(output).toContain("Open Interest:");
    expect(output).toContain("LONG");
    expect(output).toContain("SHORT");
  });

  // ============ JSON Output ============

  it("should serialize BigInt values to strings in JSON output", () => {
    const result = makeSimResult();
    const json = strategySimResultToJson(result);

    expect(typeof json.perpId).toBe("string");
    expect(json.perpId).toBe("16");
    expect(typeof json.gasUsed).toBe("string");
  });

  it("should produce valid JSON from strategySimResultToJson", () => {
    const result = makeSimResult();
    const json = strategySimResultToJson(result);

    // Should be round-trippable
    const str = JSON.stringify(json);
    const parsed = JSON.parse(str);
    expect(parsed.strategyType).toBe("grid");
    expect(parsed.perpName).toBe("BTC");
    expect(parsed.totalOrders).toBe(6);
  });
});

// ============ CLI Registration ============

describe("Simulate CLI command", () => {
  it("should register simulate strategy subcommand", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const simulateCmd = program.commands.find((c) => c.name() === "simulate");
    expect(simulateCmd).toBeDefined();

    const strategyCmd = simulateCmd?.commands.find((c) => c.name() === "strategy");
    expect(strategyCmd).toBeDefined();
  });

  it("should have --strategy option on strategy subcommand", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const strategyCmd = program.commands
      .find((c) => c.name() === "simulate")
      ?.commands.find((c) => c.name() === "strategy");

    const strategyOption = strategyCmd?.options.find((o) => o.long === "--strategy");
    expect(strategyOption).toBeDefined();
  });

  it("should have --perp option on strategy subcommand", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const strategyCmd = program.commands
      .find((c) => c.name() === "simulate")
      ?.commands.find((c) => c.name() === "strategy");

    const perpOption = strategyCmd?.options.find((o) => o.long === "--perp");
    expect(perpOption).toBeDefined();
  });

  it("should have --json flag on strategy subcommand", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const strategyCmd = program.commands
      .find((c) => c.name() === "simulate")
      ?.commands.find((c) => c.name() === "strategy");

    const jsonOption = strategyCmd?.options.find((o) => o.long === "--json");
    expect(jsonOption).toBeDefined();
  });

  it("should have grid-specific options", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const strategyCmd = program.commands
      .find((c) => c.name() === "simulate")
      ?.commands.find((c) => c.name() === "strategy");

    expect(strategyCmd?.options.find((o) => o.long === "--levels")).toBeDefined();
    expect(strategyCmd?.options.find((o) => o.long === "--spacing")).toBeDefined();
    expect(strategyCmd?.options.find((o) => o.long === "--center-price")).toBeDefined();
    expect(strategyCmd?.options.find((o) => o.long === "--leverage")).toBeDefined();
    expect(strategyCmd?.options.find((o) => o.long === "--post-only")).toBeDefined();
  });

  it("should have MM-specific options", async () => {
    const { Command } = await import("commander");
    const { registerSimulateCommand } = await import("../../src/cli/simulate.js");

    const program = new Command();
    registerSimulateCommand(program);

    const strategyCmd = program.commands
      .find((c) => c.name() === "simulate")
      ?.commands.find((c) => c.name() === "strategy");

    expect(strategyCmd?.options.find((o) => o.long === "--spread")).toBeDefined();
    expect(strategyCmd?.options.find((o) => o.long === "--max-position")).toBeDefined();
  });
});

// ============ Strategy Integration ============

describe("Strategy order generation", () => {
  it("should generate correct number of grid orders", async () => {
    const { createGridOrders } = await import("../../src/sdk/trading/strategies/grid.js");

    const orders = createGridOrders({
      perpId: 16n,
      centerPrice: 98500,
      gridLevels: 3,
      gridSpacing: 100,
      orderSize: 0.001,
      leverage: 2,
      priceDecimals: 1n,
      lotDecimals: 5n,
    });

    // 3 above + 3 below = 6
    expect(orders).toHaveLength(6);
  });

  it("should generate buy orders below center and sell orders above", async () => {
    const { createGridOrders } = await import("../../src/sdk/trading/strategies/grid.js");

    const orders = createGridOrders({
      perpId: 16n,
      centerPrice: 98500,
      gridLevels: 2,
      gridSpacing: 100,
      orderSize: 0.001,
      leverage: 2,
      priceDecimals: 1n,
      lotDecimals: 5n,
    });

    // Orders sorted by price ascending
    const longs = orders.filter(o => o.orderType === OrderType.OpenLong);
    const shorts = orders.filter(o => o.orderType === OrderType.OpenShort);

    expect(longs).toHaveLength(2);
    expect(shorts).toHaveLength(2);

    // All longs should be below center price
    for (const o of longs) {
      expect(Number(o.pricePNS)).toBeLessThan(98500 * 10);
    }
    // All shorts should be above center price
    for (const o of shorts) {
      expect(Number(o.pricePNS)).toBeGreaterThan(98500 * 10);
    }
  });

  it("should pass priceDecimals and lotDecimals through to grid orders", async () => {
    const { createGridOrders } = await import("../../src/sdk/trading/strategies/grid.js");

    const orders = createGridOrders({
      perpId: 16n,
      centerPrice: 100,
      gridLevels: 1,
      gridSpacing: 10,
      orderSize: 1.5,
      leverage: 1,
      priceDecimals: 3n,
      lotDecimals: 8n,
    });

    expect(orders).toHaveLength(2);
    // With priceDecimals=3, price 90 → 90000
    expect(orders[0].pricePNS).toBe(BigInt(Math.round(90 * 1000)));
    // With lotDecimals=8, lot 1.5 → 150000000
    expect(orders[0].lotLNS).toBe(BigInt(Math.round(1.5 * 100000000)));
  });

  it("should generate MM bid and ask from mid price", async () => {
    const { MarketMakerStrategy } = await import("../../src/sdk/trading/strategies/marketMaker.js");

    const mm = new MarketMakerStrategy({
      perpId: 16n,
      orderSize: 0.001,
      spreadPercent: 0.001,
      leverage: 2,
      maxPosition: 0.01,
      priceDecimals: 1n,
      lotDecimals: 5n,
    });

    const quotes = mm.calculateQuotes(
      { bestBid: 98400, bestAsk: 98600, midPrice: 98500 },
      { size: 0 },
    );

    expect(quotes.bidPrice).toBeLessThan(98500);
    expect(quotes.askPrice).toBeGreaterThan(98500);
    expect(quotes.bidSize).toBe(0.001);
    expect(quotes.askSize).toBe(0.001);
  });

  it("should generate MM orders from quotes", async () => {
    const { MarketMakerStrategy } = await import("../../src/sdk/trading/strategies/marketMaker.js");

    const mm = new MarketMakerStrategy({
      perpId: 16n,
      orderSize: 0.001,
      spreadPercent: 0.001,
      leverage: 2,
      maxPosition: 0.01,
      priceDecimals: 1n,
      lotDecimals: 5n,
    });

    const quotes = mm.calculateQuotes(
      { bestBid: 98400, bestAsk: 98600, midPrice: 98500 },
      { size: 0 },
    );
    const { bidOrder, askOrder } = mm.generateOrders(quotes);

    expect(bidOrder).toBeDefined();
    expect(askOrder).toBeDefined();
    expect(bidOrder!.orderType).toBe(OrderType.OpenLong);
    expect(askOrder!.orderType).toBe(OrderType.OpenShort);
  });
});

// ============ Type Exports ============

describe("Strategy simulation exports", () => {
  it("should export runStrategySimulation from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.runStrategySimulation).toBe("function");
  });

  it("should export printStrategySimReport from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.printStrategySimReport).toBe("function");
  });

  it("should export strategySimResultToJson from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.strategySimResultToJson).toBe("function");
  });

  it("should export mapEventsToOrderResults from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.mapEventsToOrderResults).toBe("function");
  });
});
