/**
 * Tests for position management utilities
 */

import { describe, it, expect } from "vitest";
import {
  cnsToAmount,
  amountToCNS,
  parsePosition,
  calculateUnrealizedPnL,
  calculateLiquidationPrice,
  calculateEffectiveLeverage,
  calculateMarginRatio,
  isAtLiquidationRisk,
  getPositionSummary,
  COLLATERAL_DECIMALS,
} from "../src/sdk/trading/positions.js";
import { type PositionInfo, PositionType } from "../src/sdk/contracts/Exchange.js";

describe("Collateral Conversions", () => {
  it("converts CNS to human-readable amount", () => {
    expect(cnsToAmount(1000000n)).toBe(1);
    expect(cnsToAmount(100000000n)).toBe(100);
    expect(cnsToAmount(1500000n)).toBe(1.5);
  });

  it("converts human-readable amount to CNS", () => {
    expect(amountToCNS(1)).toBe(1000000n);
    expect(amountToCNS(100)).toBe(100000000n);
    expect(amountToCNS(1.5)).toBe(1500000n);
  });
});

describe("Position Parsing", () => {
  const createMockPosition = (overrides: Partial<PositionInfo> = {}): PositionInfo => ({
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: 1000000000n, // 1000 USD stable (6 decimals)
    pricePNS: 450000n, // 45000 USD (1 decimal: 45000 * 10)
    lotLNS: 10000n, // 0.1 BTC (5 decimals: 0.1 * 100000)
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  });

  it("parses a long position", () => {
    const position = createMockPosition();
    const parsed = parsePosition(position);

    expect(parsed.type).toBe("long");
    expect(parsed.entryPrice).toBe(45000);
    expect(parsed.size).toBe(0.1);
    expect(parsed.depositCollateral).toBe(1000);
  });

  it("parses a short position", () => {
    const position = createMockPosition({ positionType: PositionType.Short });
    const parsed = parsePosition(position);

    expect(parsed.type).toBe("short");
  });

  it("parses an empty position", () => {
    const position = createMockPosition({ lotLNS: 0n });
    const parsed = parsePosition(position);

    expect(parsed.type).toBe("none");
  });
});

describe("PnL Calculations", () => {
  const createMockPosition = (overrides: Partial<PositionInfo> = {}): PositionInfo => ({
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: 1000000000n, // 1000 USD stable
    pricePNS: 450000n, // 45000 USD entry
    lotLNS: 10000n, // 0.1 BTC
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  });

  it("calculates positive PnL for long position", () => {
    const position = createMockPosition();
    const markPricePNS = 460000n; // Price went up to 46000

    const pnl = calculateUnrealizedPnL(position, markPricePNS);

    // (46000 - 45000) * 0.1 = 100
    expect(pnl).toBeCloseTo(100);
  });

  it("calculates negative PnL for long position", () => {
    const position = createMockPosition();
    const markPricePNS = 440000n; // Price went down to 44000

    const pnl = calculateUnrealizedPnL(position, markPricePNS);

    // (44000 - 45000) * 0.1 = -100
    expect(pnl).toBeCloseTo(-100);
  });

  it("calculates positive PnL for short position", () => {
    const position = createMockPosition({ positionType: PositionType.Short });
    const markPricePNS = 440000n; // Price went down to 44000

    const pnl = calculateUnrealizedPnL(position, markPricePNS);

    // (45000 - 44000) * 0.1 = 100 (short profits when price goes down)
    expect(pnl).toBeCloseTo(100);
  });

  it("calculates negative PnL for short position", () => {
    const position = createMockPosition({ positionType: PositionType.Short });
    const markPricePNS = 460000n; // Price went up to 46000

    const pnl = calculateUnrealizedPnL(position, markPricePNS);

    // (45000 - 46000) * 0.1 = -100 (short loses when price goes up)
    expect(pnl).toBeCloseTo(-100);
  });

  it("returns 0 PnL for empty position", () => {
    const position = createMockPosition({ lotLNS: 0n });
    const pnl = calculateUnrealizedPnL(position, 460000n);

    expect(pnl).toBe(0);
  });
});

describe("Liquidation Calculations", () => {
  const createMockPosition = (overrides: Partial<PositionInfo> = {}): PositionInfo => ({
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: 450000000n, // 450 USD stable (10x leverage on 0.1 BTC at 45000)
    pricePNS: 450000n, // 45000 USD
    lotLNS: 10000n, // 0.1 BTC
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  });

  it("calculates liquidation price for long position", () => {
    const position = createMockPosition();
    const liqPrice = calculateLiquidationPrice(position, 0.05); // 5% maintenance

    // Entry: 45000, Notional: 4500, Collateral: 450
    // Max loss before liquidation: 450 - (4500 * 0.05) = 450 - 225 = 225
    // Price change: 225 / 4500 = 5%
    // Liq price: 45000 * 0.95 = 42750
    expect(liqPrice).toBeCloseTo(42750, -1);
  });

  it("calculates liquidation price for short position", () => {
    const position = createMockPosition({ positionType: PositionType.Short });
    const liqPrice = calculateLiquidationPrice(position, 0.05);

    // Liq price for short: 45000 * 1.05 = 47250
    expect(liqPrice).toBeCloseTo(47250, -1);
  });
});

describe("Leverage Calculations", () => {
  const createMockPosition = (overrides: Partial<PositionInfo> = {}): PositionInfo => ({
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: 450000000n, // 450 USD stable
    pricePNS: 450000n, // 45000 USD
    lotLNS: 10000n, // 0.1 BTC
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  });

  it("calculates effective leverage", () => {
    const position = createMockPosition();
    const markPricePNS = 450000n;

    const leverage = calculateEffectiveLeverage(position, markPricePNS);

    // Notional: 45000 * 0.1 = 4500
    // Equity: 450
    // Leverage: 4500 / 450 = 10
    expect(leverage).toBeCloseTo(10);
  });

  it("leverage increases with profit for long", () => {
    const position = createMockPosition();
    const lowerPrice = 440000n; // Price dropped

    const leverage = calculateEffectiveLeverage(position, lowerPrice);

    // Loss of 100, equity now 350
    // Notional at 44000: 4400
    // Leverage: 4400 / 350 = 12.57
    expect(leverage).toBeGreaterThan(10);
  });

  it("calculates margin ratio", () => {
    const position = createMockPosition();
    const markPricePNS = 450000n;

    const marginRatio = calculateMarginRatio(position, markPricePNS);

    // 1 / 10 = 0.1 (10%)
    expect(marginRatio).toBeCloseTo(0.1);
  });
});

describe("Risk Detection", () => {
  const createMockPosition = (overrides: Partial<PositionInfo> = {}): PositionInfo => ({
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: 450000000n, // 450 USD stable
    pricePNS: 450000n, // 45000 USD
    lotLNS: 10000n, // 0.1 BTC
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  });

  it("detects liquidation risk when margin ratio is low", () => {
    const position = createMockPosition();
    // Price dropped significantly
    const dangerousMarkPrice = 430000n; // 43000 * 10^1

    const isAtRisk = isAtLiquidationRisk(position, dangerousMarkPrice, 0.05);

    expect(isAtRisk).toBe(true);
  });

  it("no risk when position is healthy", () => {
    const position = createMockPosition();
    const safeMarkPrice = 450000n;

    const isAtRisk = isAtLiquidationRisk(position, safeMarkPrice, 0.05);

    expect(isAtRisk).toBe(false);
  });
});

describe("Position Summary", () => {
  it("generates complete position summary", () => {
    const position: PositionInfo = {
      accountId: 1n,
      nextNodeId: 0n,
      prevNodeId: 0n,
      positionType: PositionType.Long,
      depositCNS: 450000000n,
      pricePNS: 450000n,
      lotLNS: 10000n,
      entryBlock: 1000n,
      pnlCNS: 0n,
      deltaPnlCNS: 0n,
      premiumPnlCNS: 0n,
    };

    const summary = getPositionSummary(position, 460000n);

    expect(summary.type).toBe("long");
    expect(summary.size).toBe(0.1);
    expect(summary.entryPrice).toBe(45000);
    expect(summary.markPrice).toBe(46000);
    expect(summary.unrealizedPnL).toBeCloseTo(100);
    expect(summary.leverage).toBeGreaterThan(1); // Leverage depends on mark price PnL
    expect(summary.collateral).toBe(450);
  });
});
