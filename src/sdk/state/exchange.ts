/**
 * Exchange state tracking
 * Caches and updates exchange state for efficient access
 * Supports real-time WebSocket updates with contract fallback
 */

import { EventEmitter } from "events";
import type { Address, PublicClient } from "viem";
import {
  Exchange,
  type AccountInfo,
  type PositionInfo,
  type PerpetualInfo,
} from "../contracts/Exchange.js";
import { getPositionSummary, type PositionSummary } from "../trading/positions.js";
import type { PerplWebSocketClient } from "../api/websocket.js";
import type { Position, Order, WalletAccount } from "../api/types.js";

/**
 * Known perpetual IDs from dex-sdk testnet config
 * https://github.com/PerplFoundation/dex-sdk/blob/main/crates/sdk/src/lib.rs
 *
 * Note: Market symbols are determined on-chain via getPerpetualInfo()
 * These IDs may need updating as the exchange evolves
 */
export const PERPETUALS = {
  // IDs from dex-sdk testnet: [16, 32, 48, 64, 256]
  BTC: 16n,
  ETH: 32n,
  SOL: 48n,
  MON: 64n,
  ZEC: 256n,
} as const;

/**
 * All known perpetual IDs to scan
 */
export const ALL_PERP_IDS = [16n, 32n, 48n, 64n, 256n] as const;

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
 * Real-time state from WebSocket
 */
export interface RealtimeState {
  /** Wallet accounts from WebSocket */
  walletAccounts: WalletAccount[];
  /** Open positions from WebSocket (API format) */
  apiPositions: Map<number, Position>;
  /** Open orders from WebSocket (API format) */
  apiOrders: Map<number, Order>;
  /** WebSocket connected */
  connected: boolean;
  /** Last WebSocket update */
  lastWsUpdate: number;
}

export interface StateTrackerEvents {
  "positions-updated": [positions: Map<number, Position>];
  "orders-updated": [orders: Map<number, Order>];
  "wallet-updated": [accounts: WalletAccount[]];
  "realtime-connected": [];
  "realtime-disconnected": [code: number];
  "auth-expired": [];
}

/**
 * Exchange state tracker
 * Maintains cached state and provides convenient access methods
 * Supports real-time WebSocket updates with contract fallback
 */
export class ExchangeStateTracker extends EventEmitter {
  private exchange: Exchange;
  private accountId?: bigint;
  private accountAddress?: Address;
  private state: ExchangeState;
  private realtimeState: RealtimeState;
  private publicClient: PublicClient;
  private wsClient?: PerplWebSocketClient;

  constructor(exchange: Exchange, publicClient: PublicClient) {
    super();
    this.exchange = exchange;
    this.publicClient = publicClient;
    this.state = {
      positions: new Map(),
      perpetuals: new Map(),
      lastUpdate: 0,
    };
    this.realtimeState = {
      walletAccounts: [],
      apiPositions: new Map(),
      apiOrders: new Map(),
      connected: false,
      lastWsUpdate: 0,
    };
  }

  /**
   * Connect to WebSocket for real-time updates
   * @param wsClient WebSocket client instance
   * @param authNonce Auth nonce from REST authentication
   * @param authCookies Auth cookies from REST authentication
   */
  async connectRealtime(
    wsClient: PerplWebSocketClient,
    authNonce: string,
    authCookies?: string
  ): Promise<void> {
    this.wsClient = wsClient;

    // Set up event handlers before connecting
    wsClient.on("wallet", (accounts: WalletAccount[]) => {
      this.realtimeState.walletAccounts = accounts;
      this.realtimeState.lastWsUpdate = Date.now();
      this.emit("wallet-updated", accounts);
    });

    wsClient.on("positions", (positions: Position[]) => {
      for (const pos of positions) {
        if (pos.st === 1) {
          // Open position
          this.realtimeState.apiPositions.set(pos.pid, pos);
        } else {
          // Closed/liquidated - remove from map
          this.realtimeState.apiPositions.delete(pos.pid);
        }
      }
      this.realtimeState.lastWsUpdate = Date.now();
      this.emit("positions-updated", this.realtimeState.apiPositions);
    });

    wsClient.on("orders", (orders: Order[]) => {
      for (const order of orders) {
        if (order.r) {
          // Remove flag set
          this.realtimeState.apiOrders.delete(order.oid);
        } else if (order.st === 2 || order.st === 3) {
          // Open or PartiallyFilled
          this.realtimeState.apiOrders.set(order.oid, order);
        } else {
          // Filled, Cancelled, Rejected, Expired
          this.realtimeState.apiOrders.delete(order.oid);
        }
      }
      this.realtimeState.lastWsUpdate = Date.now();
      this.emit("orders-updated", this.realtimeState.apiOrders);
    });

    wsClient.on("disconnect", (code: number) => {
      this.realtimeState.connected = false;
      this.emit("realtime-disconnected", code);
    });

    wsClient.on("auth-expired", () => {
      this.realtimeState.connected = false;
      this.emit("auth-expired");
    });

    // Connect
    await wsClient.connectTrading(authNonce, authCookies);
    this.realtimeState.connected = true;
    this.emit("realtime-connected");
  }

  /**
   * Disconnect WebSocket
   */
  disconnectRealtime(): void {
    this.wsClient?.disconnect();
    this.wsClient = undefined;
    this.realtimeState.connected = false;
  }

  /**
   * Check if real-time updates are connected
   */
  isRealtimeConnected(): boolean {
    return this.realtimeState.connected;
  }

  /**
   * Get open positions from real-time state
   */
  getRealtimePositions(): Map<number, Position> {
    return this.realtimeState.apiPositions;
  }

  /**
   * Get open orders from real-time state
   */
  getRealtimeOrders(): Map<number, Order> {
    return this.realtimeState.apiOrders;
  }

  /**
   * Get wallet accounts from real-time state
   */
  getRealtimeWalletAccounts(): WalletAccount[] {
    return this.realtimeState.walletAccounts;
  }

  /**
   * Get real-time state age in milliseconds
   */
  getRealtimeStateAge(): number {
    return Date.now() - this.realtimeState.lastWsUpdate;
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

// Type-safe event emitter overrides
export interface ExchangeStateTracker {
  on<E extends keyof StateTrackerEvents>(
    event: E,
    listener: (...args: StateTrackerEvents[E]) => void
  ): this;
  once<E extends keyof StateTrackerEvents>(
    event: E,
    listener: (...args: StateTrackerEvents[E]) => void
  ): this;
  off<E extends keyof StateTrackerEvents>(
    event: E,
    listener: (...args: StateTrackerEvents[E]) => void
  ): this;
  emit<E extends keyof StateTrackerEvents>(
    event: E,
    ...args: StateTrackerEvents[E]
  ): boolean;
}
