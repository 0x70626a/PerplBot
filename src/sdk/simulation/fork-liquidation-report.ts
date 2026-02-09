/**
 * Fork-based liquidation simulation report
 * Visual terminal output comparing fork-verified vs pure-math liquidation prices
 */

import chalk from "chalk";
import type { ForkLiquidationResult, ForkPricePoint } from "./fork-liquidation.js";

// ============ Color helpers ============

const success = (s: string) => chalk.green.bold(s);
const fail = (s: string) => chalk.red.bold(s);
const warn = (s: string) => chalk.yellow(s);
const positive = (s: string) => chalk.green(s);
const negative = (s: string) => chalk.red(s);
const header = (s: string) => chalk.bold(s);
const dim = (s: string) => chalk.dim(s);

// ============ Constants ============

const SEPARATOR = "═".repeat(56);
const THIN_SEP = "─".repeat(56);
const BAR_WIDTH = 30;

// ============ Utilities ============

function fmtPrice(price: number): string {
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return sign + pct.toFixed(4) + "%";
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function priceBar(
  price: number,
  low: number,
  high: number,
  isLiquidatable: boolean,
): string {
  if (high <= low) return "";
  const ratio = Math.max(0, Math.min(1, (price - low) / (high - low)));
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return isLiquidatable ? chalk.red(bar) : chalk.green(bar);
}

// ============ Report sections ============

function printHeader(r: ForkLiquidationResult): void {
  console.log(header(`\n${SEPARATOR}`));
  console.log(header(`  FORK LIQUIDATION SIMULATOR — ${r.perpName}-PERP`));
  console.log(header(SEPARATOR));
}

function printPosition(r: ForkLiquidationResult): void {
  const sideStr = r.positionType === "long" ? chalk.green("LONG") : chalk.red("SHORT");
  const leverage = r.collateral > 0
    ? (r.entryPrice * r.size / r.collateral).toFixed(2)
    : "∞";

  console.log(`\n  ${header("Position")}`);
  console.log(`  ${THIN_SEP}`);
  console.log(`  Side:         ${sideStr}`);
  console.log(`  Size:         ${r.size.toFixed(5)} ${r.perpName}`);
  console.log(`  Entry Price:  ${fmtPrice(r.entryPrice)}`);
  console.log(`  Collateral:   ${fmtUsd(r.collateral)} USDC`);
  console.log(`  Leverage:     ${leverage}x`);
  console.log(`  Account ID:   ${r.accountId.toString()}`);
}

function printLiquidationComparison(r: ForkLiquidationResult): void {
  console.log(`\n  ${header("Liquidation Price")}`);
  console.log(`  ${THIN_SEP}`);

  if (r.alreadyLiquidatable) {
    console.log(`  ${fail("⚠  POSITION IS ALREADY LIQUIDATABLE AT CURRENT PRICE")}`);
    console.log(`  Current Mark:  ${fmtPrice(r.currentMarkPrice)}`);
    console.log(`  Math Estimate: ${fmtPrice(r.mathLiquidationPrice)}`);
    return;
  }

  console.log(`  Fork-Verified: ${header(fmtPrice(r.forkLiquidationPrice))}`);
  console.log(`  Math Estimate: ${fmtPrice(r.mathLiquidationPrice)}`);

  const absDivPct = Math.abs(r.divergencePct);
  const absDivUsd = Math.abs(r.divergenceUsd);
  let divColor: (s: string) => string;
  if (absDivPct < 0.1) {
    divColor = positive;
  } else if (absDivPct < 1) {
    divColor = warn;
  } else {
    divColor = negative;
  }

  console.log(`  Divergence:    ${divColor(fmtPct(r.divergencePct))} (${divColor(fmtPrice(absDivUsd))})`);

  // Distance from current price
  const dropOrRise = r.positionType === "long" ? "drop" : "rise";
  const distUsd = r.positionType === "long"
    ? r.currentMarkPrice - r.forkLiquidationPrice
    : r.forkLiquidationPrice - r.currentMarkPrice;
  const distPct = r.currentMarkPrice > 0 ? (distUsd / r.currentMarkPrice) * 100 : 0;
  console.log(`  Distance:      ${Math.abs(distPct).toFixed(2)}% ${dropOrRise} (${fmtPrice(Math.abs(distUsd))})`);
}

function printPriceSweep(r: ForkLiquidationResult): void {
  if (r.forkPricePoints.length === 0) {
    return;
  }

  console.log(`\n  ${header("Fork Price Sweep")}`);
  console.log(`  ${THIN_SEP}`);

  // Select ~12 representative points
  const points = selectDisplayPoints(r);
  const allPrices = points.map(p => p.price);
  const low = Math.min(...allPrices);
  const high = Math.max(...allPrices);

  for (const pt of points) {
    const priceStr = fmtPrice(pt.price).padStart(14);
    const bar = priceBar(pt.price, low, high, pt.isLiquidatable);
    const status = pt.isLiquidatable
      ? chalk.red("LIQUIDATED")
      : chalk.green("SAFE      ");

    let label = "";
    if (pt.label === "current") label = dim(" ← NOW");
    else if (pt.label === "fork-liq") label = warn(" ← LIQ");

    console.log(`  ${priceStr}  ${bar}  ${status}${label}`);
  }
}

interface DisplayPoint extends ForkPricePoint {
  label?: "current" | "fork-liq";
}

function selectDisplayPoints(r: ForkLiquidationResult): DisplayPoint[] {
  const all = [...r.forkPricePoints].sort((a, b) => b.price - a.price); // high to low
  if (all.length === 0) return [];

  const targets: { price: number; label?: "current" | "fork-liq" }[] = [];

  // Endpoints
  targets.push({ price: all[all.length - 1].price });
  targets.push({ price: all[0].price });

  // Current mark price
  targets.push({ price: r.currentMarkPrice, label: "current" });

  // Fork liq price (if not already liquidatable)
  if (!r.alreadyLiquidatable) {
    const lowBound = all[all.length - 1].price;
    const highBound = all[0].price;
    if (r.forkLiquidationPrice >= lowBound && r.forkLiquidationPrice <= highBound) {
      targets.push({ price: r.forkLiquidationPrice, label: "fork-liq" });
    }
  }

  // Fill in evenly spaced points
  const totalDisplay = 12;
  const sorted = [...all].sort((a, b) => a.price - b.price);
  const lowP = sorted[0].price;
  const highP = sorted[sorted.length - 1].price;
  const step = (highP - lowP) / (totalDisplay - 1);
  for (let i = 1; i < totalDisplay - 1; i++) {
    targets.push({ price: lowP + step * i });
  }

  // Deduplicate by finding closest sweep point
  const used = new Set<number>();
  const result: DisplayPoint[] = [];

  // Labeled first
  const sortedTargets = [...targets].sort((a, b) => {
    if (a.label && !b.label) return -1;
    if (!a.label && b.label) return 1;
    return a.price - b.price;
  });

  for (const target of sortedTargets) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < all.length; i++) {
      const dist = Math.abs(all[i].price - target.price);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (!used.has(bestIdx)) {
      used.add(bestIdx);
      result.push({ ...all[bestIdx], label: target.label });
    }
  }

  // Sort high to low
  result.sort((a, b) => b.price - a.price);
  return result;
}

function printCascadeEvents(r: ForkLiquidationResult): void {
  if (r.cascadeEvents.length === 0) {
    return;
  }

  console.log(`\n  ${header("Cascade Effects")}`);
  console.log(`  ${THIN_SEP}`);

  for (const event of r.cascadeEvents) {
    const name = header(event.eventName);
    console.log(`  ${name}`);

    for (const [key, value] of Object.entries(event.args)) {
      const valueStr = typeof value === "bigint" ? value.toString() : String(value);
      console.log(`    ${dim(key)}: ${valueStr}`);
    }
  }
}

function printPerformance(r: ForkLiquidationResult): void {
  console.log(`\n  ${header("Performance")}`);
  console.log(`  ${THIN_SEP}`);
  console.log(`  Slot Discovery: ${fmtMs(r.timing.slotDiscoveryMs)}`);
  console.log(`  Price Sweep:    ${fmtMs(r.timing.sweepMs)}`);
  console.log(`  Binary Search:  ${fmtMs(r.timing.binarySearchMs)}`);
  console.log(`  Total:          ${header(fmtMs(r.timing.totalMs))}`);
}

function printSummary(r: ForkLiquidationResult): void {
  console.log(`\n${header(SEPARATOR)}`);

  if (r.alreadyLiquidatable) {
    console.log(fail(`  Position is already liquidatable at current price!`));
  } else {
    const absDivPct = Math.abs(r.divergencePct);
    if (absDivPct < 0.1) {
      console.log(`  Fork and math estimates ${success("agree")} (within 0.1%).`);
    } else if (absDivPct < 1) {
      console.log(`  Fork and math estimates ${warn("diverge slightly")} (${fmtPct(r.divergencePct)}).`);
    } else {
      console.log(`  Fork and math estimates ${fail("diverge significantly")} (${fmtPct(r.divergencePct)}).`);
      console.log(`  ${warn("The fork-verified price is more accurate — it accounts for on-chain conditions.")}`);
    }

    const dropOrRise = r.positionType === "long" ? "drop" : "rise";
    const distPct = r.currentMarkPrice > 0
      ? Math.abs(
          (r.positionType === "long"
            ? r.currentMarkPrice - r.forkLiquidationPrice
            : r.forkLiquidationPrice - r.currentMarkPrice
          ) / r.currentMarkPrice * 100
        )
      : 0;
    console.log(`  Position survives a ${distPct.toFixed(2)}% ${dropOrRise} (fork-verified).`);
  }

  console.log(header(SEPARATOR) + "\n");
}

// ============ Main export ============

export function printForkLiquidationReport(result: ForkLiquidationResult): void {
  printHeader(result);
  printPosition(result);
  printLiquidationComparison(result);
  printPriceSweep(result);
  printCascadeEvents(result);
  printPerformance(result);
  printSummary(result);
}
