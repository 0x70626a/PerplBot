/**
 * Portfolio management and queries
 * Get positions, open orders, history, and market information
 * Supports API batch queries with contract fallback
 */

import type { Address, PublicClient } from "viem";
import {
  Exchange,
  type AccountInfo,
  type PositionInfo,
  type PerpetualInfo,
  PositionType,
} from "../contracts/Exchange.js";
import { ExchangeAbi } from "../contracts/abi.js";
import { pnsToPrice, lnsToLot, PRICE_DECIMALS, LOT_DECIMALS } from "./orders.js";
import { cnsToAmount, COLLATERAL_DECIMALS } from "./positions.js";
import type { PerplApiClient } from "../api/client.js";
import type { Position, Order, Fill } from "../api/types.js";
import { USE_API } from "../config.js";

/**
 * Market information for display
 */
export interface MarketInfo {
  perpId: bigint;
  name: string;
  symbol: string;
  priceDecimals: number;
  lotDecimals: number;
  markPrice: number;
  oraclePrice: number;
  fundingRate: number; // As percentage
  longOpenInterest: number;
  shortOpenInterest: number;
  paused: boolean;
}

/**
 * Position for display
 */
export interface PositionDisplay {
  perpId: bigint;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  margin: number;
  leverage: number;
}

/**
 * Open order for display
 */
export interface OpenOrder {
  perpId: bigint;
  orderId: bigint;
  symbol: string;
  side: "bid" | "ask";
  price: number;
  size: number;
  leverage: number;
  expiryBlock: bigint;
}

/**
 * Funding info
 */
export interface FundingInfo {
  perpId: bigint;
  symbol: string;
  currentRate: number; // Per 8h as percentage
  nextFundingTime: Date;
  timeUntilFunding: number; // In seconds
}

/**
 * Account summary
 */
export interface AccountSummary {
  accountId: bigint;
  balance: number;
  lockedBalance: number;
  availableBalance: number;
  totalEquity: number;
  unrealizedPnl: number;
  marginUsed: number;
  marginAvailable: number;
}

/**
 * Portfolio class for querying account and market state
 * Supports API batch queries with contract fallback
 */
export class Portfolio {
  private exchange: Exchange;
  private publicClient: PublicClient;
  private exchangeAddress: Address;
  private accountId?: bigint;
  private apiClient?: PerplApiClient;
  private useApi: boolean;

  constructor(
    exchange: Exchange,
    publicClient: PublicClient,
    exchangeAddress: Address,
    apiClient?: PerplApiClient
  ) {
    this.exchange = exchange;
    this.publicClient = publicClient;
    this.exchangeAddress = exchangeAddress;
    this.apiClient = apiClient;
    this.useApi = USE_API && !!apiClient;
  }

  /**
   * Check if API mode is enabled
   */
  isApiEnabled(): boolean {
    return this.useApi;
  }

  /**
   * Set the account to query
   */
  setAccountId(accountId: bigint): void {
    this.accountId = accountId;
  }

  /**
   * Set account by address (looks up account ID)
   */
  async setAccountByAddress(address: Address): Promise<void> {
    const account = await this.exchange.getAccountByAddress(address);
    this.accountId = account.accountId;
  }

  private ensureAccountId(): bigint {
    if (!this.accountId) {
      throw new Error("Account ID not set. Call setAccountId() first.");
    }
    return this.accountId;
  }

  // ============ Market Queries ============

  /**
   * Get all available markets
   */
  async getAvailableMarkets(perpIds: bigint[] = [0n, 1n, 2n]): Promise<MarketInfo[]> {
    const markets: MarketInfo[] = [];

    for (const perpId of perpIds) {
      try {
        const info = await this.exchange.getPerpetualInfo(perpId);
        markets.push({
          perpId,
          name: info.name,
          symbol: info.symbol,
          priceDecimals: Number(info.priceDecimals),
          lotDecimals: Number(info.lotDecimals),
          markPrice: pnsToPrice(info.markPNS, info.priceDecimals),
          oraclePrice: pnsToPrice(info.oraclePNS, info.priceDecimals),
          fundingRate: Number(info.fundingRatePct100k) / 1000, // Convert to percentage
          longOpenInterest: lnsToLot(info.longOpenInterestLNS, info.lotDecimals),
          shortOpenInterest: lnsToLot(info.shortOpenInterestLNS, info.lotDecimals),
          paused: info.paused,
        });
      } catch {
        // Perpetual doesn't exist, skip
      }
    }

    return markets;
  }

  /**
   * Get market info for a specific perpetual
   */
  async getMarket(perpId: bigint): Promise<MarketInfo> {
    const info = await this.exchange.getPerpetualInfo(perpId);
    return {
      perpId,
      name: info.name,
      symbol: info.symbol,
      priceDecimals: Number(info.priceDecimals),
      lotDecimals: Number(info.lotDecimals),
      markPrice: pnsToPrice(info.markPNS, info.priceDecimals),
      oraclePrice: pnsToPrice(info.oraclePNS, info.priceDecimals),
      fundingRate: Number(info.fundingRatePct100k) / 1000,
      longOpenInterest: lnsToLot(info.longOpenInterestLNS, info.lotDecimals),
      shortOpenInterest: lnsToLot(info.shortOpenInterestLNS, info.lotDecimals),
      paused: info.paused,
    };
  }

  // ============ Position Queries ============

  /**
   * Get all positions for the account
   * Uses API batch query if available, falls back to contract calls
   */
  async getPositions(perpIds: bigint[] = [0n, 1n, 2n]): Promise<PositionDisplay[]> {
    // Try API first if available and authenticated
    if (this.useApi && this.apiClient?.isAuthenticated()) {
      try {
        return await this.getPositionsFromApi();
      } catch (err) {
        console.warn("[Portfolio] API getPositions failed, using contract:", err);
      }
    }

    // Contract fallback
    return this.getPositionsFromContract(perpIds);
  }

  /**
   * Get positions from API (batch query)
   * @internal
   */
  private async getPositionsFromApi(): Promise<PositionDisplay[]> {
    if (!this.apiClient) throw new Error("API client not available");

    const response = await this.apiClient.getPositionHistory();
    const positions: PositionDisplay[] = [];

    // Filter for open positions (status 1 = Open)
    const openPositions = response.d.filter((p) => p.st === 1);

    for (const pos of openPositions) {
      // Get perpetual info for formatting
      try {
        const perpInfo = await this.exchange.getPerpetualInfo(BigInt(pos.mkt));
        const priceDecimals = perpInfo.priceDecimals;
        const lotDecimals = perpInfo.lotDecimals;

        const size = pos.s / Math.pow(10, Number(lotDecimals));
        const entryPrice = pos.ep / Math.pow(10, Number(priceDecimals));
        const margin = Number(pos.c) / 1e6; // Collateral is in CNS (6 decimals)

        // Get current mark price from contract for accurate PnL
        const { markPrice: markPricePNS } = await this.exchange.getPosition(
          BigInt(pos.mkt),
          BigInt(pos.acc)
        );
        const markPrice = pnsToPrice(markPricePNS, priceDecimals);

        // Calculate unrealized PnL
        const notional = entryPrice * size;
        const currentNotional = markPrice * size;
        const isLong = pos.sd === 1; // PositionSide.Long = 1
        const unrealizedPnl = isLong
          ? currentNotional - notional
          : notional - currentNotional;

        const unrealizedPnlPercent = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
        const leverage = margin > 0 ? notional / margin : 0;

        positions.push({
          perpId: BigInt(pos.mkt),
          symbol: perpInfo.symbol,
          side: isLong ? "long" : "short",
          size,
          entryPrice,
          markPrice,
          unrealizedPnl,
          unrealizedPnlPercent,
          margin,
          leverage,
        });
      } catch {
        // Skip positions we can't process
      }
    }

    return positions;
  }

  /**
   * Get positions from contract (N+1 queries)
   * @internal
   */
  private async getPositionsFromContract(perpIds: bigint[]): Promise<PositionDisplay[]> {
    const accountId = this.ensureAccountId();
    const positions: PositionDisplay[] = [];

    for (const perpId of perpIds) {
      try {
        const { position, markPrice } = await this.exchange.getPosition(
          perpId,
          accountId
        );

        if (position.lotLNS === 0n) {
          continue;
        }

        const perpInfo = await this.exchange.getPerpetualInfo(perpId);
        const priceDecimals = perpInfo.priceDecimals;
        const lotDecimals = perpInfo.lotDecimals;

        const size = lnsToLot(position.lotLNS, lotDecimals);
        const entryPrice = pnsToPrice(position.pricePNS, priceDecimals);
        const currentPrice = pnsToPrice(markPrice, priceDecimals);
        const margin = cnsToAmount(position.depositCNS);

        // Calculate unrealized PnL
        const notional = entryPrice * size;
        const currentNotional = currentPrice * size;
        const isLong = position.positionType === PositionType.Long;
        const unrealizedPnl = isLong
          ? currentNotional - notional
          : notional - currentNotional;

        const unrealizedPnlPercent = (unrealizedPnl / margin) * 100;
        const leverage = notional / margin;

        positions.push({
          perpId,
          symbol: perpInfo.symbol,
          side: isLong ? "long" : "short",
          size,
          entryPrice,
          markPrice: currentPrice,
          unrealizedPnl,
          unrealizedPnlPercent,
          margin,
          leverage,
        });
      } catch {
        // Skip errors
      }
    }

    return positions;
  }

  /**
   * Get a specific position
   */
  async getPosition(perpId: bigint): Promise<PositionDisplay | null> {
    const positions = await this.getPositions([perpId]);
    return positions[0] ?? null;
  }

  // ============ Account Queries ============

  /**
   * Get account summary
   */
  async getAccountSummary(): Promise<AccountSummary> {
    const accountId = this.ensureAccountId();
    const account = await this.exchange.getAccountById(accountId);
    const positions = await this.getPositions();

    const balance = cnsToAmount(account.balanceCNS);
    const lockedBalance = cnsToAmount(account.lockedBalanceCNS);
    const availableBalance = balance - lockedBalance;

    let unrealizedPnl = 0;
    let marginUsed = 0;

    for (const pos of positions) {
      unrealizedPnl += pos.unrealizedPnl;
      marginUsed += pos.margin;
    }

    const totalEquity = balance + unrealizedPnl;
    const marginAvailable = totalEquity - marginUsed;

    return {
      accountId,
      balance,
      lockedBalance,
      availableBalance,
      totalEquity,
      unrealizedPnl,
      marginUsed,
      marginAvailable,
    };
  }

  // ============ Funding Queries ============

  /**
   * Get funding info for a perpetual
   */
  async getFundingInfo(perpId: bigint): Promise<FundingInfo> {
    const info = await this.exchange.getPerpetualInfo(perpId);

    // Funding is typically every 8 hours
    // fundingStartBlock is when the current funding period started
    const currentBlock = await this.publicClient.getBlockNumber();
    const fundingStartBlock = info.fundingStartBlock;

    // Estimate blocks per second (Monad is ~500ms block time)
    const blocksPerSecond = 2;
    const fundingIntervalBlocks = 8 * 60 * 60 * blocksPerSecond; // 8 hours

    const blocksSinceFunding = Number(currentBlock) - Number(fundingStartBlock);
    const blocksUntilFunding = fundingIntervalBlocks - (blocksSinceFunding % fundingIntervalBlocks);
    const secondsUntilFunding = blocksUntilFunding / blocksPerSecond;

    const nextFundingTime = new Date(Date.now() + secondsUntilFunding * 1000);

    return {
      perpId,
      symbol: info.symbol,
      currentRate: Number(info.fundingRatePct100k) / 1000, // Convert to percentage
      nextFundingTime,
      timeUntilFunding: secondsUntilFunding,
    };
  }

  /**
   * Get time until next funding in human readable format
   */
  async getTimeUntilFunding(perpId: bigint): Promise<string> {
    const info = await this.getFundingInfo(perpId);
    const seconds = Math.floor(info.timeUntilFunding);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  // ============ Fee Queries ============

  /**
   * Get trading fees for a perpetual
   */
  async getTradingFees(perpId: bigint): Promise<{
    takerFee: number;
    makerFee: number;
    takerFeePercent: number;
    makerFeePercent: number;
  }> {
    const [takerFee, makerFee] = await Promise.all([
      this.exchange.getTakerFee(perpId),
      this.exchange.getMakerFee(perpId),
    ]);

    return {
      takerFee: Number(takerFee),
      makerFee: Number(makerFee),
      takerFeePercent: Number(takerFee) / 1000, // Convert from per 100k to percent
      makerFeePercent: Number(makerFee) / 1000,
    };
  }

  // ============ API History Queries ============

  /**
   * Get order history from API
   * Requires API client and authentication
   */
  async getOrderHistory(maxPages = 10): Promise<Order[]> {
    if (!this.apiClient?.isAuthenticated()) {
      throw new Error("API client required and must be authenticated for order history");
    }
    return this.apiClient.getAllOrderHistory(maxPages);
  }

  /**
   * Get fill history from API
   * Requires API client and authentication
   */
  async getFills(maxPages = 10): Promise<Fill[]> {
    if (!this.apiClient?.isAuthenticated()) {
      throw new Error("API client required and must be authenticated for fills");
    }
    return this.apiClient.getAllFills(maxPages);
  }

  /**
   * Get position history from API
   * Requires API client and authentication
   */
  async getPositionHistory(maxPages = 10): Promise<Position[]> {
    if (!this.apiClient?.isAuthenticated()) {
      throw new Error("API client required and must be authenticated for position history");
    }
    return this.apiClient.getAllPositionHistory(maxPages);
  }

  /**
   * Get open orders for a market (uses Exchange with API fallback)
   */
  async getOpenOrders(perpId: bigint): Promise<OpenOrder[]> {
    const accountId = this.ensureAccountId();
    const orders = await this.exchange.getOpenOrders(perpId, accountId);

    // Get perpetual info for formatting
    const perpInfo = await this.exchange.getPerpetualInfo(perpId);

    return orders.map((o) => ({
      perpId,
      orderId: o.orderId,
      symbol: perpInfo.symbol,
      side: o.orderType === 0 || o.orderType === 2 ? "bid" : "ask", // OpenLong/CloseLong = bid, OpenShort/CloseShort = ask
      price: o.priceONS / Math.pow(10, Number(perpInfo.priceDecimals)),
      size: Number(o.lotLNS) / Math.pow(10, Number(perpInfo.lotDecimals)),
      leverage: o.leverageHdths / 100,
      expiryBlock: 0n, // Not available in compact response
    }));
  }

  /**
   * Get all open orders across all markets
   */
  async getAllOpenOrders(perpIds: bigint[] = [16n, 32n, 48n, 64n, 256n]): Promise<OpenOrder[]> {
    const allOrders: OpenOrder[] = [];

    for (const perpId of perpIds) {
      try {
        const orders = await this.getOpenOrders(perpId);
        allOrders.push(...orders);
      } catch {
        // Market may not exist or no orders
      }
    }

    return allOrders;
  }
}
