/**
 * Exchange state tracking
 * Caches and updates exchange state for efficient access
 */

import type { Address, PublicClient } from "viem";
import {
  Exchange,
  type AccountInfo,
  type PositionInfo,
  type PerpetualInfo,
} from "../contracts/Exchange.js";
import { getPositionSummary, type PositionSummary } from "../trading/positions.js";

/**
 * Known perpetual IDs
 * These are the perpetual contract IDs on Perpl
 */
export const PERPETUALS = {
  BTC: 0n,
  ETH: 1n,
  SOL: 2n,
  MON: 3n,
  ZEC: 4n,
} as const;

/**
 * Cached exchange state
 */
export interface ExchangeState {
  /** Account information */
  account?: AccountInfo;
  /** Positions by perpetual ID */
  positions: Map<bigint, { position: PositionInfo; markPrice: bigint }>;
  /** Perpetual info cache */
  perpetuals: Map<bigint, PerpetualInfo>;
  /** Last update timestamp */
  lastUpdate: number;
}

/**
 * Exchange state tracker
 * Maintains cached state and provides convenient access methods
 */
export class ExchangeStateTracker {
  private exchange: Exchange;
  private accountId?: bigint;
  private accountAddress?: Address;
  private state: ExchangeState;
  private publicClient: PublicClient;

  constructor(exchange: Exchange, publicClient: PublicClient) {
    this.exchange = exchange;
    this.publicClient = publicClient;
    this.state = {
      positions: new Map(),
      perpetuals: new Map(),
      lastUpdate: 0,
    };
  }

  /**
   * Set account to track by ID
   */
  setAccountId(accountId: bigint): void {
    this.accountId = accountId;
    this.accountAddress = undefined;
  }

  /**
   * Set account to track by address
   */
  setAccountAddress(address: Address): void {
    this.accountAddress = address;
    this.accountId = undefined;
  }

  /**
   * Refresh account information
   */
  async refreshAccount(): Promise<AccountInfo | undefined> {
    if (this.accountId !== undefined) {
      this.state.account = await this.exchange.getAccountById(this.accountId);
    } else if (this.accountAddress !== undefined) {
      this.state.account = await this.exchange.getAccountByAddress(
        this.accountAddress
      );
      this.accountId = this.state.account.accountId;
    }
    this.state.lastUpdate = Date.now();
    return this.state.account;
  }

  /**
   * Refresh position for a perpetual
   */
  async refreshPosition(perpId: bigint): Promise<{
    position: PositionInfo;
    markPrice: bigint;
  } | undefined> {
    if (this.accountId === undefined) {
      await this.refreshAccount();
    }

    if (this.accountId === undefined || this.accountId === 0n) {
      return undefined;
    }

    const result = await this.exchange.getPosition(perpId, this.accountId);
    this.state.positions.set(perpId, {
      position: result.position,
      markPrice: result.markPrice,
    });
    this.state.lastUpdate = Date.now();

    return {
      position: result.position,
      markPrice: result.markPrice,
    };
  }

  /**
   * Refresh perpetual info
   */
  async refreshPerpetual(perpId: bigint): Promise<PerpetualInfo> {
    const info = await this.exchange.getPerpetualInfo(perpId);
    this.state.perpetuals.set(perpId, info);
    return info;
  }

  /**
   * Get cached account info
   */
  getAccount(): AccountInfo | undefined {
    return this.state.account;
  }

  /**
   * Get account balance in human-readable format
   */
  getBalanceUsdc(): number {
    if (!this.state.account) return 0;
    return Number(this.state.account.balanceCNS) / 1e6;
  }

  /**
   * Get locked balance in human-readable format
   */
  getLockedBalanceUsdc(): number {
    if (!this.state.account) return 0;
    return Number(this.state.account.lockedBalanceCNS) / 1e6;
  }

  /**
   * Get available balance (balance - locked)
   */
  getAvailableBalanceUsdc(): number {
    return this.getBalanceUsdc() - this.getLockedBalanceUsdc();
  }

  /**
   * Get cached position for a perpetual
   */
  getPosition(perpId: bigint): {
    position: PositionInfo;
    markPrice: bigint;
  } | undefined {
    return this.state.positions.get(perpId);
  }

  /**
   * Get position summary for display
   */
  getPositionSummary(perpId: bigint): PositionSummary | undefined {
    const data = this.state.positions.get(perpId);
    if (!data) return undefined;

    const perpInfo = this.state.perpetuals.get(perpId);
    const priceDecimals = perpInfo?.priceDecimals ?? 6n;
    const lotDecimals = perpInfo?.lotDecimals ?? 8n;

    return getPositionSummary(
      data.position,
      data.markPrice,
      0.05, // 5% maintenance margin
      priceDecimals,
      lotDecimals
    );
  }

  /**
   * Get cached perpetual info
   */
  getPerpetual(perpId: bigint): PerpetualInfo | undefined {
    return this.state.perpetuals.get(perpId);
  }

  /**
   * Refresh all tracked state
   */
  async refreshAll(perpIds: bigint[] = [0n, 1n]): Promise<void> {
    await this.refreshAccount();

    await Promise.all([
      ...perpIds.map((id) => this.refreshPosition(id)),
      ...perpIds.map((id) => this.refreshPerpetual(id)),
    ]);
  }

  /**
   * Get a summary of all positions
   */
  getAllPositionSummaries(): Map<bigint, PositionSummary> {
    const summaries = new Map<bigint, PositionSummary>();

    for (const [perpId, _] of this.state.positions) {
      const summary = this.getPositionSummary(perpId);
      if (summary && summary.type !== "none") {
        summaries.set(perpId, summary);
      }
    }

    return summaries;
  }

  /**
   * Calculate total unrealized PnL across all positions
   */
  getTotalUnrealizedPnL(): number {
    let total = 0;
    for (const [perpId, _] of this.state.positions) {
      const summary = this.getPositionSummary(perpId);
      if (summary) {
        total += summary.unrealizedPnL;
      }
    }
    return total;
  }

  /**
   * Get total account equity (balance + unrealized PnL)
   */
  getTotalEquity(): number {
    return this.getBalanceUsdc() + this.getTotalUnrealizedPnL();
  }

  /**
   * Check if any position is at liquidation risk
   */
  hasLiquidationRisk(): boolean {
    for (const [perpId, _] of this.state.positions) {
      const summary = this.getPositionSummary(perpId);
      if (summary?.isAtRisk) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get state age in milliseconds
   */
  getStateAge(): number {
    return Date.now() - this.state.lastUpdate;
  }

  /**
   * Check if state is stale
   */
  isStale(maxAgeMs: number = 30000): boolean {
    return this.getStateAge() > maxAgeMs;
  }
}
