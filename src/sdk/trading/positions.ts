/**
 * Position management utilities
 * PnL calculations and position tracking
 */

import { type PositionInfo, PositionType } from "../contracts/Exchange.js";
import { pnsToPrice, lnsToLot, PRICE_DECIMALS, LOT_DECIMALS } from "./orders.js";

/**
 * Collateral decimals (USD stable)
 */
export const COLLATERAL_DECIMALS = 6n;

/**
 * Convert CNS (Collateral Native Scale) to human-readable
 */
export function cnsToAmount(cns: bigint, decimals: bigint = COLLATERAL_DECIMALS): number {
  return Number(cns) / Number(10n ** decimals);
}

/**
 * Convert human-readable amount to CNS
 */
export function amountToCNS(amount: number, decimals: bigint = COLLATERAL_DECIMALS): bigint {
  return BigInt(Math.round(amount * Number(10n ** decimals)));
}

/**
 * Human-readable position data
 */
export interface PositionData {
  accountId: bigint;
  type: "long" | "short" | "none";
  entryPrice: number;
  size: number;
  depositCollateral: number;
  pnl: number;
  deltaPnl: number;
  premiumPnl: number;
  entryBlock: bigint;
}

/**
 * Parse position info into human-readable format
 */
export function parsePosition(
  position: PositionInfo,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): PositionData {
  let positionTypeStr: "long" | "short" | "none";

  // Empty position (no size)
  if (position.lotLNS === 0n) {
    positionTypeStr = "none";
  } else {
    switch (position.positionType) {
      case PositionType.Long:
        positionTypeStr = "long";
        break;
      case PositionType.Short:
        positionTypeStr = "short";
        break;
      default:
        positionTypeStr = "none";
    }
  }

  return {
    accountId: position.accountId,
    type: positionTypeStr,
    entryPrice: pnsToPrice(position.pricePNS, priceDecimals),
    size: lnsToLot(position.lotLNS, lotDecimals),
    depositCollateral: cnsToAmount(position.depositCNS),
    pnl: cnsToAmount(position.pnlCNS),
    deltaPnl: cnsToAmount(position.deltaPnlCNS),
    premiumPnl: cnsToAmount(position.premiumPnlCNS),
    entryBlock: position.entryBlock,
  };
}

/**
 * Calculate unrealized PnL for a position at current mark price
 */
export function calculateUnrealizedPnL(
  position: PositionInfo,
  markPricePNS: bigint,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): number {
  if (position.lotLNS === 0n) {
    return 0;
  }

  const entryPrice = pnsToPrice(position.pricePNS, priceDecimals);
  const markPrice = pnsToPrice(markPricePNS, priceDecimals);
  const size = lnsToLot(position.lotLNS, lotDecimals);

  const priceDiff = markPrice - entryPrice;

  if (position.positionType === PositionType.Long) {
    return priceDiff * size;
  } else {
    return -priceDiff * size;
  }
}

/**
 * Calculate liquidation price for a position
 * Simplified calculation - actual liquidation depends on maintenance margin
 */
export function calculateLiquidationPrice(
  position: PositionInfo,
  maintenanceMarginFrac: number = 0.05, // 5% default
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): number {
  if (position.lotLNS === 0n) {
    return 0;
  }

  const entryPrice = pnsToPrice(position.pricePNS, priceDecimals);
  const size = lnsToLot(position.lotLNS, lotDecimals);
  const collateral = cnsToAmount(position.depositCNS);

  // Notional value
  const notional = entryPrice * size;

  // Loss that would trigger liquidation (collateral - maintenance margin)
  const maxLoss = collateral - notional * maintenanceMarginFrac;

  // Price change that causes this loss
  const priceChangePercent = maxLoss / notional;

  if (position.positionType === PositionType.Long) {
    // Liquidated when price drops
    return entryPrice * (1 - priceChangePercent);
  } else {
    // Liquidated when price rises
    return entryPrice * (1 + priceChangePercent);
  }
}

/**
 * Calculate effective leverage of a position
 */
export function calculateEffectiveLeverage(
  position: PositionInfo,
  markPricePNS: bigint,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): number {
  if (position.lotLNS === 0n) {
    return 0;
  }

  const markPrice = pnsToPrice(markPricePNS, priceDecimals);
  const size = lnsToLot(position.lotLNS, lotDecimals);
  const collateral = cnsToAmount(position.depositCNS);

  // Include unrealized PnL in equity
  const unrealizedPnL = calculateUnrealizedPnL(
    position,
    markPricePNS,
    priceDecimals,
    lotDecimals
  );
  const equity = collateral + unrealizedPnL;

  // Notional at current price
  const notional = markPrice * size;

  return notional / equity;
}

/**
 * Calculate margin ratio (equity / notional)
 */
export function calculateMarginRatio(
  position: PositionInfo,
  markPricePNS: bigint,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): number {
  const leverage = calculateEffectiveLeverage(
    position,
    markPricePNS,
    priceDecimals,
    lotDecimals
  );

  if (leverage === 0) return 0;
  return 1 / leverage;
}

/**
 * Check if position is at risk of liquidation
 */
export function isAtLiquidationRisk(
  position: PositionInfo,
  markPricePNS: bigint,
  maintenanceMarginFrac: number = 0.05,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): boolean {
  const marginRatio = calculateMarginRatio(
    position,
    markPricePNS,
    priceDecimals,
    lotDecimals
  );

  return marginRatio > 0 && marginRatio < maintenanceMarginFrac * 1.2; // 20% buffer
}

/**
 * Position summary for display
 */
export interface PositionSummary {
  type: "long" | "short" | "none";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  collateral: number;
  leverage: number;
  marginRatio: number;
  liquidationPrice: number;
  isAtRisk: boolean;
}

/**
 * Get a full summary of a position
 */
export function getPositionSummary(
  position: PositionInfo,
  markPricePNS: bigint,
  maintenanceMarginFrac: number = 0.05,
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS
): PositionSummary {
  const parsed = parsePosition(position, priceDecimals, lotDecimals);
  const markPrice = pnsToPrice(markPricePNS, priceDecimals);

  const unrealizedPnL = calculateUnrealizedPnL(
    position,
    markPricePNS,
    priceDecimals,
    lotDecimals
  );

  const entryNotional = parsed.entryPrice * parsed.size;
  const unrealizedPnLPercent =
    entryNotional > 0 ? (unrealizedPnL / entryNotional) * 100 : 0;

  return {
    type: parsed.type,
    size: parsed.size,
    entryPrice: parsed.entryPrice,
    markPrice,
    unrealizedPnL,
    unrealizedPnLPercent,
    collateral: parsed.depositCollateral,
    leverage: calculateEffectiveLeverage(
      position,
      markPricePNS,
      priceDecimals,
      lotDecimals
    ),
    marginRatio: calculateMarginRatio(
      position,
      markPricePNS,
      priceDecimals,
      lotDecimals
    ),
    liquidationPrice: calculateLiquidationPrice(
      position,
      maintenanceMarginFrac,
      priceDecimals,
      lotDecimals
    ),
    isAtRisk: isAtLiquidationRisk(
      position,
      markPricePNS,
      maintenanceMarginFrac,
      priceDecimals,
      lotDecimals
    ),
  };
}
