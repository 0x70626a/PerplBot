/**
 * Portfolio management and queries
 * Get positions, open orders, history, and market information
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
 */
export class Portfolio {
  private exchange: Exchange;
  private publicClient: PublicClient;
  private exchangeAddress: Address;
  private accountId?: bigint;

  constructor(
    exchange: Exchange,
    publicClient: PublicClient,
    exchangeAddress: Address
  ) {
    this.exchange = exchange;
    this.publicClient = publicClient;
    this.exchangeAddress = exchangeAddress;
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
   */
  async getPositions(perpIds: bigint[] = [0n, 1n, 2n]): Promise<PositionDisplay[]> {
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
}
