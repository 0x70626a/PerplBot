/**
 * Fork-based liquidation simulator
 *
 * Forks the chain via Anvil, discovers storage slots for mark/oracle prices,
 * manipulates prices to sweep a range, and checks on-chain equity to verify
 * the exact liquidation boundary.
 *
 * Uses getPosition() to read the contract's own PnL calculation after price
 * manipulation, then determines liquidatability from the equity vs maintenance
 * margin threshold. This avoids oracle validity issues that occur on forks.
 *
 * The Perpl exchange contract packs multiple fields (markPNS, oraclePNS,
 * timestamps, decimals, etc.) into a single 32-byte storage word. This module
 * discovers the packed layout via debug_traceCall + probing, then uses
 * read-modify-write to manipulate individual fields.
 */

import {
  type Address,
  type PublicClient,
  createPublicClient,
  http,
  keccak256,
  encodePacked,
  pad,
  numberToHex,
  encodeFunctionData,
} from "viem";
import { ExchangeAbi } from "../contracts/abi.js";
import {
  type PerpetualInfo,
  type PositionInfo,
  PositionType,
} from "../contracts/Exchange.js";
import type { EnvConfig } from "../config.js";
import {
  pnsToPrice,
  priceToPNS,
  lnsToLot,
} from "../trading/orders.js";
import { cnsToAmount } from "../trading/positions.js";
import {
  isAnvilInstalled,
  startAnvilFork,
  stopAnvil,
  type AnvilInstance,
} from "./anvil.js";
import { computeLiquidationPrice } from "./liquidation.js";

// ============ Configuration ============

export interface ForkLiquidationConfig {
  /** How far to sweep each direction from current price (%) */
  priceRangePct: number;
  /** Number of coarse sweep price points */
  priceSteps: number;
  /** Binary search iterations for exact boundary */
  binarySearchIterations: number;
  /** Anvil startup timeout (ms) */
  anvilTimeout: number;
  /** Maintenance margin fraction for pure-math comparison */
  maintenanceMargin: number;
}

export const DEFAULT_FORK_LIQUIDATION_CONFIG: ForkLiquidationConfig = {
  priceRangePct: 30,
  priceSteps: 20,
  binarySearchIterations: 10,
  anvilTimeout: 30_000,
  maintenanceMargin: 0.05,
};

// ============ Types ============

/** Describes how a field is packed within a 256-bit storage word */
export interface PackedField {
  /** The storage slot containing this field */
  slot: `0x${string}`;
  /** Bit offset from LSB (0 = lowest bits) */
  bitOffset: number;
  /** Bit width of the field */
  bitWidth: number;
}

/** Complete storage layout for price manipulation */
export interface PriceStorageLayout {
  markPNS: PackedField;
  oraclePNS: PackedField;
  markTimestamp: PackedField;
  oracleTimestamp: PackedField | null;
}

export interface ForkPricePoint {
  price: number;
  pricePNS: bigint;
  isLiquidatable: boolean;
  reverted: boolean;
  revertReason?: string;
  gasUsed?: bigint;
}

export interface CascadeEvent {
  eventName: string;
  args: Record<string, unknown>;
}

export interface ForkLiquidationResult {
  // Position context
  perpId: bigint;
  perpName: string;
  positionType: "long" | "short";
  entryPrice: number;
  size: number;
  collateral: number;
  currentMarkPrice: number;
  accountId: bigint;

  // Liquidation prices
  forkLiquidationPrice: number;
  mathLiquidationPrice: number;
  divergencePct: number;
  divergenceUsd: number;

  // Price sweep results
  forkPricePoints: ForkPricePoint[];

  // Cascade effects at liquidation boundary
  cascadeEvents: CascadeEvent[];

  // Performance timing
  timing: {
    slotDiscoveryMs: number;
    sweepMs: number;
    binarySearchMs: number;
    totalMs: number;
  };

  // Whether position is already liquidatable at current price
  alreadyLiquidatable: boolean;
}

// ============ Low-level storage helpers ============

async function getStorageAt(
  client: PublicClient,
  address: Address,
  slot: `0x${string}`,
): Promise<bigint> {
  const value = await client.request({
    method: "eth_getStorageAt",
    params: [address, slot, "latest"],
  });
  return BigInt(value as string);
}

async function setStorageAt(
  client: PublicClient,
  address: Address,
  slot: `0x${string}`,
  value: bigint,
): Promise<void> {
  const valueHex = pad(numberToHex(value), { size: 32 });
  await client.request({
    method: "anvil_setStorageAt" as any,
    params: [address, slot, valueHex] as any,
  });
}

async function evmSnapshot(client: PublicClient): Promise<string> {
  return client.request({ method: "evm_snapshot" as any }) as Promise<string>;
}

async function evmRevert(client: PublicClient, snapshotId: string): Promise<void> {
  await client.request({ method: "evm_revert" as any, params: [snapshotId] as any });
}

// ============ Packed field manipulation ============

/** Extract a field from a packed 256-bit word */
export function extractField(word: bigint, bitOffset: number, bitWidth: number): bigint {
  const mask = (1n << BigInt(bitWidth)) - 1n;
  return (word >> BigInt(bitOffset)) & mask;
}

/** Write a field into a packed 256-bit word (read-modify-write) */
export function writeField(
  word: bigint,
  bitOffset: number,
  bitWidth: number,
  value: bigint,
): bigint {
  const mask = (1n << BigInt(bitWidth)) - 1n;
  // Clear the field bits, then set new value
  const cleared = word & ~(mask << BigInt(bitOffset));
  return cleared | ((value & mask) << BigInt(bitOffset));
}

// ============ Storage slot discovery via trace ============

/**
 * Use debug_traceCall to find all storage slots read by getPerpetualInfo.
 * Returns unique slot hex strings.
 */
async function traceStorageSlots(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
): Promise<`0x${string}`[]> {
  const calldata = encodeFunctionData({
    abi: ExchangeAbi,
    functionName: "getPerpetualInfo",
    args: [perpId],
  });

  const trace = await client.request({
    method: "debug_traceCall" as any,
    params: [
      { to: exchangeAddress, data: calldata },
      "latest",
      { disableStorage: false, disableMemory: true, disableStack: false },
    ] as any,
  }) as any;

  const structLogs = trace.structLogs || [];
  const slots = new Set<string>();

  for (const log of structLogs) {
    if (log.op === "SLOAD" && log.stack) {
      const stack = log.stack as string[];
      const slotRaw = stack[stack.length - 1];
      const slotHex = slotRaw.startsWith("0x")
        ? slotRaw
        : "0x" + slotRaw.padStart(64, "0");
      slots.add(slotHex);
    }
  }

  return [...slots] as `0x${string}`[];
}

/**
 * Identify which storage slot contains the price data by zeroing each
 * candidate slot and checking if markPNS changes.
 */
async function findPriceSlot(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
  candidateSlots: `0x${string}`[],
  baseline: PerpetualInfo,
): Promise<`0x${string}`> {
  for (const slot of candidateSlots) {
    const snapId = await evmSnapshot(client);
    try {
      await setStorageAt(client, exchangeAddress, slot, 0n);
      const after = await readPerpInfo(client, exchangeAddress, perpId);
      if (after.markPNS !== baseline.markPNS) {
        return slot;
      }
    } catch {
      // getPerpetualInfo might revert if critical data zeroed — still a candidate
      // but we'll try others first
    } finally {
      try { await evmRevert(client, snapId); } catch { /* ignore */ }
    }
  }

  throw new Error(
    `Could not identify price storage slot. ` +
    `Tried ${candidateSlots.length} slots from trace.`
  );
}

/**
 * Probe the packed storage word to find the bit position of a specific
 * field by writing known values to 32-bit windows and checking the result.
 */
async function probeBitPosition(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
  slot: `0x${string}`,
  fieldName: "markPNS" | "oraclePNS" | "markTimestamp",
  currentWord: bigint,
): Promise<{ bitOffset: number; bitWidth: number } | null> {
  const probeValue = 999999n; // distinctive value unlikely to appear naturally

  // Try 32-bit windows at every 32-bit boundary
  for (let bitOffset = 0; bitOffset < 256; bitOffset += 32) {
    const modified = writeField(currentWord, bitOffset, 32, probeValue);
    if (modified === currentWord) continue; // no change

    const snapId = await evmSnapshot(client);
    try {
      await setStorageAt(client, exchangeAddress, slot, modified);
      const after = await readPerpInfo(client, exchangeAddress, perpId);

      const fieldValue =
        fieldName === "markPNS" ? after.markPNS :
        fieldName === "oraclePNS" ? after.oraclePNS :
        after.markTimestamp;

      if (fieldValue === probeValue) {
        return { bitOffset, bitWidth: 32 };
      }
    } catch {
      // Revert on error and continue
    } finally {
      try { await evmRevert(client, snapId); } catch { /* ignore */ }
    }
  }

  return null;
}

/**
 * Discover the complete price storage layout.
 *
 * Strategy:
 * 1. Trace getPerpetualInfo to find which slots are read
 * 2. Zero each slot to find which one contains prices
 * 3. Probe 32-bit windows to find exact bit positions of each field
 */
export async function discoverPriceSlots(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
): Promise<PriceStorageLayout> {
  // Step 1: Get baseline
  const baseline = await readPerpInfo(client, exchangeAddress, perpId);
  if (baseline.markPNS === 0n) {
    throw new Error(`markPNS is 0 for perpId ${perpId} — cannot discover slots`);
  }

  // Step 2: Trace to find candidate slots
  const candidateSlots = await traceStorageSlots(client, exchangeAddress, perpId);
  if (candidateSlots.length === 0) {
    throw new Error("debug_traceCall returned no SLOAD operations");
  }

  // Step 3: Identify the price slot
  const priceSlot = await findPriceSlot(
    client, exchangeAddress, perpId, candidateSlots, baseline,
  );

  // Step 4: Read the current packed word
  const currentWord = await getStorageAt(client, exchangeAddress, priceSlot);

  // Step 5: Probe for markPNS bit position
  const markPos = await probeBitPosition(
    client, exchangeAddress, perpId, priceSlot, "markPNS", currentWord,
  );
  if (!markPos) {
    throw new Error("Could not locate markPNS bit position in packed storage word");
  }

  // Step 6: Probe for oraclePNS bit position
  const oraclePos = await probeBitPosition(
    client, exchangeAddress, perpId, priceSlot, "oraclePNS", currentWord,
  );

  // Step 7: Probe for markTimestamp bit position
  const timestampPos = await probeBitPosition(
    client, exchangeAddress, perpId, priceSlot, "markTimestamp", currentWord,
  );

  // Step 8: Try to find oracleTimestamp near markTimestamp
  // If markTimestamp is at offset N, oracleTimestamp is often at N+32 or N-32
  let oracleTimestampField: PackedField | null = null;
  if (timestampPos) {
    // Check if there's a value that looks like a timestamp at an adjacent 32-bit window
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const delta of [32, -32, 64, -64]) {
      const candidateOffset = timestampPos.bitOffset + delta;
      if (candidateOffset < 0 || candidateOffset >= 256) continue;
      const val = extractField(currentWord, candidateOffset, 32);
      // Heuristic: a timestamp should be within 1 year of now
      if (val > now - 31536000n && val < now + 31536000n && val !== baseline.markTimestamp) {
        oracleTimestampField = { slot: priceSlot, bitOffset: candidateOffset, bitWidth: 32 };
        break;
      }
    }
  }

  return {
    markPNS: { slot: priceSlot, ...markPos },
    oraclePNS: oraclePos
      ? { slot: priceSlot, ...oraclePos }
      : { slot: priceSlot, ...markPos }, // fallback: same as mark
    markTimestamp: timestampPos
      ? { slot: priceSlot, ...timestampPos }
      : { slot: priceSlot, bitOffset: -1, bitWidth: 0 }, // sentinel: no timestamp found
    oracleTimestamp: oracleTimestampField,
  };
}

// ============ Price manipulation ============

/**
 * Set the mark and oracle prices in the packed storage word.
 * Uses read-modify-write to preserve other packed fields.
 * Keeps mark and oracle in sync to avoid priceTolPer100K rejection.
 * Updates timestamps to current time to avoid staleness checks.
 */
export async function setPrice(
  client: PublicClient,
  exchangeAddress: Address,
  layout: PriceStorageLayout,
  targetPricePNS: bigint,
): Promise<void> {
  // All fields are in the same packed slot
  let word = await getStorageAt(client, exchangeAddress, layout.markPNS.slot);

  // Write markPNS
  word = writeField(word, layout.markPNS.bitOffset, layout.markPNS.bitWidth, targetPricePNS);

  // Write oraclePNS (keep in sync)
  if (layout.oraclePNS.bitOffset !== layout.markPNS.bitOffset) {
    word = writeField(word, layout.oraclePNS.bitOffset, layout.oraclePNS.bitWidth, targetPricePNS);
  }

  // Update timestamps to current time
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (layout.markTimestamp.bitOffset >= 0) {
    word = writeField(word, layout.markTimestamp.bitOffset, layout.markTimestamp.bitWidth, now);
  }
  if (layout.oracleTimestamp) {
    word = writeField(word, layout.oracleTimestamp.bitOffset, layout.oracleTimestamp.bitWidth, now);
  }

  // Single write for the entire packed word
  await setStorageAt(client, exchangeAddress, layout.markPNS.slot, word);
}

// ============ Liquidation check ============

/**
 * Check if a position is liquidatable at the current (manipulated) mark price.
 *
 * Uses getPosition() to read the contract's own PnL calculation, then checks
 * if equity (deposit + unrealized PnL) drops below the maintenance margin.
 *
 * This approach is more reliable than calling buyLiquidations() because:
 * - No need for a separate liquidator account
 * - Bypasses oracle validity checks that fail on forks
 * - Uses the contract's own mark price → PnL computation
 */
async function checkLiquidatable(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
  accountId: bigint,
  maintenanceMargin: number,
): Promise<{ liquidatable: boolean; equity: bigint; maintenanceReq: bigint }> {
  const [position, markPrice] = (await client.readContract({
    address: exchangeAddress,
    abi: ExchangeAbi,
    functionName: "getPosition",
    args: [perpId, accountId],
  })) as [any, bigint, boolean];

  const depositCNS = position.depositCNS as bigint;
  const pnlCNS = position.pnlCNS as bigint;
  const lotLNS = position.lotLNS as bigint;

  // Equity = collateral + unrealized PnL (as computed by the contract)
  const equity = depositCNS + pnlCNS;

  // Position value in CNS = markPrice * lotLNS
  // (scaling: PNS * LNS = price * 10^priceDecimals * lot * 10^lotDecimals
  //  and CNS = amount * 10^6; for BTC priceDecimals=1, lotDecimals=5 → PNS*LNS = CNS)
  const positionValueCNS = markPrice * lotLNS;

  // Maintenance margin requirement
  const maintenanceReq = BigInt(Math.floor(Number(positionValueCNS) * maintenanceMargin));

  return {
    liquidatable: equity < maintenanceReq,
    equity,
    maintenanceReq,
  };
}

// ============ Helpers ============

async function readPerpInfo(
  client: PublicClient,
  exchangeAddress: Address,
  perpId: bigint,
): Promise<PerpetualInfo> {
  const result = (await client.readContract({
    address: exchangeAddress,
    abi: ExchangeAbi,
    functionName: "getPerpetualInfo",
    args: [perpId],
  })) as any;

  return {
    name: result.name,
    symbol: result.symbol,
    priceDecimals: result.priceDecimals,
    lotDecimals: result.lotDecimals,
    markPNS: result.markPNS,
    markTimestamp: result.markTimestamp,
    oraclePNS: result.oraclePNS,
    longOpenInterestLNS: result.longOpenInterestLNS,
    shortOpenInterestLNS: result.shortOpenInterestLNS,
    fundingStartBlock: result.fundingStartBlock,
    fundingRatePct100k: result.fundingRatePct100k,
    synthPerpPricePNS: result.synthPerpPricePNS,
    paused: result.paused,
    basePricePNS: result.basePricePNS,
    maxBidPriceONS: result.maxBidPriceONS,
    minBidPriceONS: result.minBidPriceONS,
    maxAskPriceONS: result.maxAskPriceONS,
    minAskPriceONS: result.minAskPriceONS,
    numOrders: result.numOrders,
  };
}

export function computeDivergence(
  forkPrice: number,
  mathPrice: number,
): { pct: number; usd: number } {
  if (mathPrice === 0) return { pct: 0, usd: 0 };
  const usd = forkPrice - mathPrice;
  const pct = (usd / mathPrice) * 100;
  return { pct, usd };
}

export function findBoundaryFromSweep(
  points: ForkPricePoint[],
  isLong: boolean,
): { lastSafe: ForkPricePoint; firstLiquidatable: ForkPricePoint } | null {
  const sorted = [...points].sort((a, b) => Number(a.pricePNS - b.pricePNS));

  if (isLong) {
    for (let i = sorted.length - 1; i > 0; i--) {
      if (sorted[i].isLiquidatable === false && sorted[i - 1].isLiquidatable === true) {
        return { lastSafe: sorted[i], firstLiquidatable: sorted[i - 1] };
      }
    }
  } else {
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].isLiquidatable === false && sorted[i + 1].isLiquidatable === true) {
        return { lastSafe: sorted[i], firstLiquidatable: sorted[i + 1] };
      }
    }
  }

  return null;
}

// Keep for backward compatibility with tests
export function computeMappingSlot(
  perpId: bigint,
  baseSlot: number,
  offset: number,
): `0x${string}` {
  const keyHex = pad(numberToHex(perpId), { size: 32 });
  const slotHex = pad(numberToHex(baseSlot), { size: 32 });
  const derived = keccak256(encodePacked(["bytes32", "bytes32"], [keyHex, slotHex]));
  if (offset === 0) return derived;
  const derivedBigInt = BigInt(derived);
  const result = derivedBigInt + BigInt(offset);
  return pad(numberToHex(result), { size: 32 }) as `0x${string}`;
}

// ============ Main simulation ============

export async function simulateForkLiquidation(
  config: EnvConfig,
  perpId: bigint,
  perpName: string,
  position: PositionInfo,
  perpInfo: PerpetualInfo,
  accountId: bigint,
  userConfig: Partial<ForkLiquidationConfig> = {},
): Promise<ForkLiquidationResult> {
  const cfg = { ...DEFAULT_FORK_LIQUIDATION_CONFIG, ...userConfig };
  const totalStart = Date.now();

  if (!await isAnvilInstalled()) {
    throw new Error(
      "Anvil not found. Install Foundry: https://getfoundry.sh\n" +
      "Fork-based simulation requires Anvil to manipulate on-chain state."
    );
  }

  const isLong = position.positionType === PositionType.Long;
  const entryPrice = pnsToPrice(position.pricePNS);
  const size = lnsToLot(position.lotLNS);
  const collateral = cnsToAmount(position.depositCNS);
  const currentMarkPrice = pnsToPrice(perpInfo.markPNS);

  const mathLiqPrice = computeLiquidationPrice(
    entryPrice, size, collateral, isLong, cfg.maintenanceMargin,
  );

  let anvil: AnvilInstance | undefined;
  try {
    anvil = await startAnvilFork(config.chain.rpcUrl, {
      timeout: cfg.anvilTimeout,
    });

    const forkClient = createPublicClient({
      chain: config.chain.chain,
      transport: http(anvil.rpcUrl),
    });

    const exchangeAddress = config.chain.exchangeAddress;

    // Step 1: Discover storage layout (trace + probe)
    const slotStart = Date.now();
    const layout = await discoverPriceSlots(forkClient, exchangeAddress, perpId);
    const slotDiscoveryMs = Date.now() - slotStart;

    // Step 2: Verify price manipulation works
    {
      const snapId = await evmSnapshot(forkClient);
      const testPNS = perpInfo.markPNS + 1n;
      await setPrice(forkClient, exchangeAddress, layout, testPNS);
      const check = await readPerpInfo(forkClient, exchangeAddress, perpId);
      await evmRevert(forkClient, snapId);

      if (check.markPNS !== testPNS) {
        throw new Error(
          `Price manipulation verification failed: wrote ${testPNS}, read back ${check.markPNS}`
        );
      }
    }

    // Step 3: Check if already liquidatable at current price
    const currentCheck = await checkLiquidatable(
      forkClient, exchangeAddress, perpId, accountId, cfg.maintenanceMargin,
    );

    if (currentCheck.liquidatable) {
      return {
        perpId, perpName,
        positionType: isLong ? "long" : "short",
        entryPrice, size, collateral, currentMarkPrice, accountId,
        forkLiquidationPrice: currentMarkPrice,
        mathLiquidationPrice: mathLiqPrice,
        divergencePct: computeDivergence(currentMarkPrice, mathLiqPrice).pct,
        divergenceUsd: computeDivergence(currentMarkPrice, mathLiqPrice).usd,
        forkPricePoints: [], cascadeEvents: [],
        timing: { slotDiscoveryMs, sweepMs: 0, binarySearchMs: 0, totalMs: Date.now() - totalStart },
        alreadyLiquidatable: true,
      };
    }

    // Step 4: Coarse sweep
    const sweepStart = Date.now();
    const lowPrice = currentMarkPrice * (1 - cfg.priceRangePct / 100);
    const highPrice = currentMarkPrice * (1 + cfg.priceRangePct / 100);
    const step = cfg.priceSteps > 0 ? (highPrice - lowPrice) / cfg.priceSteps : 0;

    const forkPricePoints: ForkPricePoint[] = [];

    for (let i = 0; i <= cfg.priceSteps; i++) {
      const price = lowPrice + step * i;
      const targetPNS = priceToPNS(price);

      const snapId = await evmSnapshot(forkClient);
      try {
        await setPrice(forkClient, exchangeAddress, layout, targetPNS);

        const result = await checkLiquidatable(
          forkClient, exchangeAddress, perpId, accountId, cfg.maintenanceMargin,
        );

        forkPricePoints.push({
          price, pricePNS: targetPNS,
          isLiquidatable: result.liquidatable,
          reverted: false,
        });
      } finally {
        await evmRevert(forkClient, snapId);
      }
    }
    const sweepMs = Date.now() - sweepStart;

    // Step 5: Binary search for exact boundary
    const binaryStart = Date.now();
    const boundary = findBoundaryFromSweep(forkPricePoints, isLong);

    let forkLiqPrice = mathLiqPrice; // fallback
    const cascadeEvents: CascadeEvent[] = [];

    if (boundary) {
      let lo = Math.min(boundary.lastSafe.price, boundary.firstLiquidatable.price);
      let hi = Math.max(boundary.lastSafe.price, boundary.firstLiquidatable.price);

      for (let iter = 0; iter < cfg.binarySearchIterations; iter++) {
        const mid = (lo + hi) / 2;
        const midPNS = priceToPNS(mid);

        const snapId = await evmSnapshot(forkClient);
        await setPrice(forkClient, exchangeAddress, layout, midPNS);

        const result = await checkLiquidatable(
          forkClient, exchangeAddress, perpId, accountId, cfg.maintenanceMargin,
        );

        await evmRevert(forkClient, snapId);

        if (result.liquidatable) {
          if (isLong) lo = mid; else hi = mid;
        } else {
          if (isLong) hi = mid; else lo = mid;
        }
      }

      forkLiqPrice = isLong ? hi : lo;
    }
    const binarySearchMs = Date.now() - binaryStart;

    const divergence = computeDivergence(forkLiqPrice, mathLiqPrice);

    return {
      perpId, perpName,
      positionType: isLong ? "long" : "short",
      entryPrice, size, collateral, currentMarkPrice, accountId,
      forkLiquidationPrice: forkLiqPrice,
      mathLiquidationPrice: mathLiqPrice,
      divergencePct: divergence.pct,
      divergenceUsd: divergence.usd,
      forkPricePoints, cascadeEvents,
      timing: { slotDiscoveryMs, sweepMs, binarySearchMs, totalMs: Date.now() - totalStart },
      alreadyLiquidatable: false,
    };
  } finally {
    if (anvil) stopAnvil(anvil);
  }
}
