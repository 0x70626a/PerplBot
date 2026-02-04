/**
 * HybridClient - API-first reads with SDK/contract fallback
 *
 * This client wraps both the API client and Exchange contract to provide:
 * - Faster reads via REST API when available
 * - Automatic fallback to contract calls when API fails
 * - Writes always go through contract (on-chain tx required)
 */

import type { Address, Hash } from "viem";
import type { PerplApiClient } from "./client.js";
import type {
  Exchange,
  AccountInfo,
  PositionInfo,
  PerpetualInfo,
  OrderDesc,
} from "../contracts/Exchange.js";
import { USE_API, FALLBACK_CONFIG } from "../config.js";

/**
 * Open order returned from hybrid client
 */
export interface HybridOpenOrder {
  orderId: bigint;
  accountId: number;
  orderType: number;
  priceONS: number;
  lotLNS: bigint;
  leverageHdths: number;
}

/**
 * Position data with mark price
 */
export interface HybridPosition {
  position: PositionInfo;
  markPrice: bigint;
  markPriceValid: boolean;
}

/**
 * HybridClient options
 */
export interface HybridClientOptions {
  exchange: Exchange;
  apiClient?: PerplApiClient;
  useApi?: boolean;
}

/**
 * HybridClient - API-first with contract fallback
 *
 * Usage:
 * ```typescript
 * const client = new HybridClient({
 *   exchange,
 *   apiClient,
 *   useApi: true, // default from USE_API env
 * });
 *
 * // Reads try API first, fall back to contract
 * const position = await client.getPosition(perpId, accountId);
 *
 * // Writes always use contract
 * const txHash = await client.execOrder(orderDesc);
 * ```
 */
export class HybridClient {
  private exchange: Exchange;
  private apiClient?: PerplApiClient;
  private useApi: boolean;

  constructor(options: HybridClientOptions) {
    this.exchange = options.exchange;
    this.apiClient = options.apiClient;
    this.useApi = options.useApi ?? (USE_API && !!options.apiClient);
  }

  /**
   * Check if API mode is enabled
   */
  isApiEnabled(): boolean {
    return this.useApi && !!this.apiClient;
  }

  /**
   * Get the underlying Exchange instance
   */
  getExchange(): Exchange {
    return this.exchange;
  }

  /**
   * Get the API client (if configured)
   */
  getApiClient(): PerplApiClient | undefined {
    return this.apiClient;
  }

  // ============ Read Methods (API-first with fallback) ============

  /**
   * Get account info by address
   * Note: API doesn't have a direct equivalent, always uses contract
   */
  async getAccountByAddress(address: Address): Promise<AccountInfo> {
    return this.exchange.getAccountByAddress(address);
  }

  /**
   * Get account info by ID
   * Note: API doesn't have a direct equivalent, always uses contract
   */
  async getAccountById(accountId: bigint): Promise<AccountInfo> {
    return this.exchange.getAccountById(accountId);
  }

  /**
   * Get position for an account on a perpetual
   * Uses contract since API position history doesn't include real-time mark price
   */
  async getPosition(perpId: bigint, accountId: bigint): Promise<HybridPosition> {
    // Always use contract for positions - need real-time mark price
    return this.exchange.getPosition(perpId, accountId);
  }

  /**
   * Get perpetual contract information
   * Always uses contract since API context doesn't have full perpetual info
   */
  async getPerpetualInfo(perpId: bigint): Promise<PerpetualInfo> {
    // API context doesn't provide all perpetual fields (mark price, funding, etc.)
    // Always use contract for complete data
    return this.exchange.getPerpetualInfo(perpId);
  }

  /**
   * Get open orders for an account on a perpetual
   *
   * IMPORTANT: Always uses contract because API order IDs don't match contract order IDs.
   * The API returns global/composite order IDs, but the contract expects local bitmap-based IDs.
   * Using API order IDs for cancellation would fail with "execution reverted".
   */
  async getOpenOrders(perpId: bigint, accountId: bigint): Promise<HybridOpenOrder[]> {
    // Always use contract - API order IDs are incompatible with contract cancel operations
    return this.exchange.getOpenOrders(perpId, accountId);
  }

  /**
   * Get all open orders across all markets
   *
   * IMPORTANT: API order IDs don't match contract order IDs, so this method
   * cannot be used for cancellation operations. Use getOpenOrders() per market instead.
   */
  async getAllOpenOrders(_accountId: bigint): Promise<HybridOpenOrder[]> {
    // Cannot use API - order IDs are incompatible with contract operations
    // No efficient contract fallback for all markets - would need to iterate all perps
    console.warn("[HybridClient] getAllOpenOrders not supported - use getOpenOrders per market");
    return [];
  }

  /**
   * Get exchange info (always from contract)
   */
  async getExchangeInfo() {
    return this.exchange.getExchangeInfo();
  }

  /**
   * Get taker fee (always from contract)
   */
  async getTakerFee(perpId: bigint): Promise<bigint> {
    return this.exchange.getTakerFee(perpId);
  }

  /**
   * Get maker fee (always from contract)
   */
  async getMakerFee(perpId: bigint): Promise<bigint> {
    return this.exchange.getMakerFee(perpId);
  }

  // ============ Write Methods (always contract) ============

  /**
   * Execute an order (always through contract)
   */
  async execOrder(orderDesc: OrderDesc): Promise<Hash> {
    return this.exchange.execOrder(orderDesc);
  }

  /**
   * Execute multiple orders (always through contract)
   */
  async execOrders(orderDescs: OrderDesc[], revertOnFail = true): Promise<Hash> {
    return this.exchange.execOrders(orderDescs, revertOnFail);
  }

  /**
   * Deposit collateral (always through contract)
   */
  async depositCollateral(amountCNS: bigint): Promise<Hash> {
    return this.exchange.depositCollateral(amountCNS);
  }

  /**
   * Increase position collateral (always through contract)
   */
  async increasePositionCollateral(perpId: bigint, amountCNS: bigint): Promise<Hash> {
    return this.exchange.increasePositionCollateral(perpId, amountCNS);
  }

  // ============ API-only Methods ============

  /**
   * Get order history (API only - no contract equivalent)
   * Returns empty array if API not available
   */
  async getOrderHistory() {
    if (!this.apiClient?.isAuthenticated()) {
      return [];
    }
    try {
      const history = await this.withTimeout(this.apiClient.getAllOrderHistory());
      return history;
    } catch (error) {
      this.logFallback("getOrderHistory", error);
      return [];
    }
  }

  /**
   * Get position history (API only - no contract equivalent)
   * Returns empty array if API not available
   */
  async getPositionHistory() {
    if (!this.apiClient?.isAuthenticated()) {
      return [];
    }
    try {
      const history = await this.withTimeout(this.apiClient.getAllPositionHistory());
      return history;
    } catch (error) {
      this.logFallback("getPositionHistory", error);
      return [];
    }
  }

  /**
   * Get fill history (API only - no contract equivalent)
   * Returns empty array if API not available
   */
  async getFills() {
    if (!this.apiClient?.isAuthenticated()) {
      return [];
    }
    try {
      const fills = await this.withTimeout(this.apiClient.getAllFills());
      return fills;
    } catch (error) {
      this.logFallback("getFills", error);
      return [];
    }
  }

  // ============ Private Helpers ============

  /**
   * Add timeout to API calls
   */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("API timeout")),
        FALLBACK_CONFIG.apiTimeoutMs
      );
    });
    return Promise.race([promise, timeout]);
  }

  /**
   * Log fallback event
   */
  private logFallback(method: string, error: unknown): void {
    if (FALLBACK_CONFIG.logWarnings) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[HybridClient] API ${method} failed, using SDK fallback: ${message}`);
    }
  }

}
