/**
 * Exchange contract wrapper
 * Handles trading operations on the Perpl DEX
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
} from "viem";
import { ExchangeAbi } from "./abi.js";
import type { PerplApiClient } from "../api/client.js";
import { USE_API } from "../config.js";

/**
 * Order type enum matching contract OrderDescEnum
 */
export enum OrderType {
  OpenLong = 0,
  OpenShort = 1,
  CloseLong = 2,
  CloseShort = 3,
  Cancel = 4,  // dex-sdk: 4 => Cancel
  Change = 5,  // dex-sdk: 5 => Change (modify order)
}

/**
 * Position type enum matching contract PositionEnum
 * Note: 0=Long, 1=Short based on actual exchange behavior
 */
export enum PositionType {
  Long = 0,
  Short = 1,
}

/**
 * Order descriptor for executing trades
 */
export interface OrderDesc {
  orderDescId: bigint;
  perpId: bigint;
  orderType: OrderType;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
}

/**
 * Order signature returned from execOrder
 */
export interface OrderSignature {
  perpId: bigint;
  orderId: bigint;
}

/**
 * Account information from the exchange
 */
export interface AccountInfo {
  accountId: bigint;
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  frozen: number;
  accountAddr: Address;
  positions: {
    bank1: bigint;
    bank2: bigint;
    bank3: bigint;
    bank4: bigint;
  };
}

/**
 * Position information from the exchange
 */
export interface PositionInfo {
  accountId: bigint;
  nextNodeId: bigint;
  prevNodeId: bigint;
  positionType: PositionType;
  depositCNS: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  entryBlock: bigint;
  pnlCNS: bigint;
  deltaPnlCNS: bigint;
  premiumPnlCNS: bigint;
}

/**
 * Perpetual contract information
 */
export interface PerpetualInfo {
  name: string;
  symbol: string;
  priceDecimals: bigint;
  lotDecimals: bigint;
  markPNS: bigint;
  markTimestamp: bigint;
  oraclePNS: bigint;
  longOpenInterestLNS: bigint;
  shortOpenInterestLNS: bigint;
  fundingStartBlock: bigint;
  fundingRatePct100k: number;
  synthPerpPricePNS: bigint;
  paused: boolean;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minBidPriceONS: bigint;
  maxAskPriceONS: bigint;
  minAskPriceONS: bigint;
  numOrders: bigint;
}

/**
 * Aggregate volume at a price level from getVolumeAtBookPrice
 */
export interface BookPriceVolume {
  bids: bigint;
  expBids: bigint;
  asks: bigint;
  expAsks: bigint;
}

/**
 * Individual order at a price level from getOrdersAtPriceLevel
 */
export interface PriceLevelOrder {
  accountId: number;
  orderType: number;
  priceONS: number;
  lotLNS: bigint;
  recycleFeeRaw: number;
  expiryBlock: number;
  leverageHdths: number;
  orderId: number;
  prevOrderId: number;
  nextOrderId: number;
}

/**
 * Exchange contract wrapper
 * Can be used directly or through a DelegatedAccount
 * Supports API-first queries with contract fallback
 */
export class Exchange {
  public readonly address: Address;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly delegatedAccount?: Address;
  private readonly apiClient?: PerplApiClient;
  private readonly useApi: boolean;

  constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient,
    delegatedAccount?: Address,
    apiClient?: PerplApiClient
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.delegatedAccount = delegatedAccount;
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
   * Get the API client (if configured)
   */
  getApiClient(): PerplApiClient | undefined {
    return this.apiClient;
  }

  /**
   * Create an Exchange instance that operates through a DelegatedAccount
   */
  static withDelegatedAccount(
    exchangeAddress: Address,
    delegatedAccountAddress: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient,
    apiClient?: PerplApiClient
  ): Exchange {
    return new Exchange(
      exchangeAddress,
      publicClient,
      walletClient,
      delegatedAccountAddress,
      apiClient
    );
  }

  /**
   * Get the address to call (DelegatedAccount if set, otherwise Exchange directly)
   */
  private getCallAddress(): Address {
    return this.delegatedAccount ?? this.address;
  }

  private ensureWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error("Wallet client required for write operations");
    }
    return this.walletClient;
  }

  /** Get the signer address (for nonce management). */
  getSignerAddress(): Address {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");
    return account.address;
  }

  // ============ Read Functions ============

  /**
   * Get account info by address
   */
  async getAccountByAddress(accountAddress: Address): Promise<AccountInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getAccountByAddr",
      args: [accountAddress],
    })) as any;

    return {
      accountId: result.accountId,
      balanceCNS: result.balanceCNS,
      lockedBalanceCNS: result.lockedBalanceCNS,
      frozen: result.frozen,
      accountAddr: result.accountAddr,
      positions: result.positions,
    };
  }

  /**
   * Get account info by ID
   */
  async getAccountById(accountId: bigint): Promise<AccountInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getAccountById",
      args: [accountId],
    })) as any;

    return {
      accountId: result.accountId,
      balanceCNS: result.balanceCNS,
      lockedBalanceCNS: result.lockedBalanceCNS,
      frozen: result.frozen,
      accountAddr: result.accountAddr,
      positions: result.positions,
    };
  }

  /**
   * Get position for an account on a perpetual
   */
  async getPosition(
    perpId: bigint,
    accountId: bigint
  ): Promise<{ position: PositionInfo; markPrice: bigint; markPriceValid: boolean }> {
    const [position, markPrice, markPriceValid] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getPosition",
      args: [perpId, accountId],
    })) as [any, bigint, boolean];

    return {
      position: {
        accountId: position.accountId,
        nextNodeId: position.nextNodeId,
        prevNodeId: position.prevNodeId,
        positionType: position.positionType as PositionType,
        depositCNS: position.depositCNS,
        pricePNS: position.pricePNS,
        lotLNS: position.lotLNS,
        entryBlock: position.entryBlock,
        pnlCNS: position.pnlCNS,
        deltaPnlCNS: position.deltaPnlCNS,
        premiumPnlCNS: position.premiumPnlCNS,
      },
      markPrice,
      markPriceValid,
    };
  }

  /**
   * Get perpetual contract information
   */
  async getPerpetualInfo(perpId: bigint): Promise<PerpetualInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
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

  /**
   * Get exchange info
   */
  async getExchangeInfo(): Promise<{
    balanceCNS: bigint;
    protocolBalanceCNS: bigint;
    recycleBalanceCNS: bigint;
    collateralDecimals: bigint;
    collateralToken: Address;
    verifierProxy: Address;
  }> {
    const [
      balanceCNS,
      protocolBalanceCNS,
      recycleBalanceCNS,
      collateralDecimals,
      collateralToken,
      verifierProxy,
    ] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getExchangeInfo",
    })) as [bigint, bigint, bigint, bigint, Address, Address];

    return {
      balanceCNS,
      protocolBalanceCNS,
      recycleBalanceCNS,
      collateralDecimals,
      collateralToken,
      verifierProxy,
    };
  }

  /**
   * Get taker fee for a perpetual
   */
  async getTakerFee(perpId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getTakerFee",
      args: [perpId],
    }) as Promise<bigint>;
  }

  /**
   * Get maker fee for a perpetual
   */
  async getMakerFee(perpId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getMakerFee",
      args: [perpId],
    }) as Promise<bigint>;
  }

  /**
   * Get order ID index for a perpetual (bitmap of active order IDs)
   */
  async getOrderIdIndex(perpId: bigint): Promise<{
    root: bigint;
    leaves: readonly bigint[];
    numOrders: bigint;
  }> {
    const [root, leaves, numOrders] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getOrderIdIndex",
      args: [perpId],
    })) as [bigint, readonly bigint[], bigint];

    return { root, leaves, numOrders };
  }

  /**
   * Get order details by ID
   */
  async getOrder(perpId: bigint, orderId: bigint): Promise<{
    accountId: number;
    orderType: number;
    priceONS: number;
    lotLNS: bigint;
    recycleFeeRaw: number;
    expiryBlock: number;
    leverageHdths: number;
    orderId: number;
    prevOrderId: number;
    nextOrderId: number;
  }> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getOrder",
      args: [perpId, orderId],
    })) as any;

    return {
      accountId: Number(result.accountId),
      orderType: Number(result.orderType),
      priceONS: Number(result.priceONS),
      lotLNS: BigInt(result.lotLNS),
      recycleFeeRaw: Number(result.recycleFeeRaw),
      expiryBlock: Number(result.expiryBlock),
      leverageHdths: Number(result.leverageHdths),
      orderId: Number(result.orderId),
      prevOrderId: Number(result.prevOrderId),
      nextOrderId: Number(result.nextOrderId),
    };
  }

  /**
   * Get aggregate volume at a book price level
   */
  async getVolumeAtBookPrice(perpId: bigint, priceONS: bigint): Promise<BookPriceVolume> {
    const [bids, expBids, asks, expAsks] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getVolumeAtBookPrice",
      args: [perpId, priceONS],
    })) as [bigint, bigint, bigint, bigint];

    return { bids, expBids, asks, expAsks };
  }

  /**
   * Get the next price below with resting orders (walk down the book)
   * Returns 0n when no more levels exist below.
   */
  async getNextPriceBelowWithOrders(perpId: bigint, priceONS: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getNextPriceBelowWithOrders",
      args: [perpId, priceONS],
    }) as Promise<bigint>;
  }

  /**
   * Get individual orders at a price level (paginated)
   */
  async getOrdersAtPriceLevel(
    perpId: bigint,
    priceONS: bigint,
    pageStartOrderId = 0n,
    ordersPerPage = 100n,
  ): Promise<{ orders: PriceLevelOrder[]; numOrders: bigint }> {
    const [ordersRaw, numOrders] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getOrdersAtPriceLevel",
      args: [perpId, priceONS, pageStartOrderId, ordersPerPage],
    })) as [any[], bigint];

    const orders: PriceLevelOrder[] = ordersRaw.map((o: any) => ({
      accountId: Number(o.accountId),
      orderType: Number(o.orderType),
      priceONS: Number(o.priceONS),
      lotLNS: BigInt(o.lotLNS),
      recycleFeeRaw: Number(o.recycleFeeRaw),
      expiryBlock: Number(o.expiryBlock),
      leverageHdths: Number(o.leverageHdths),
      orderId: Number(o.orderId),
      prevOrderId: Number(o.prevOrderId),
      nextOrderId: Number(o.nextOrderId),
    }));

    return { orders, numOrders };
  }

  /**
   * Get all open orders for an account on a perpetual
   * Always uses contract bitmap iteration because API order IDs are incompatible.
   *
   * IMPORTANT: The API returns global/composite order IDs that cannot be used for
   * contract operations like cancel. The contract expects local bitmap-based IDs.
   */
  async getOpenOrders(perpId: bigint, accountId: bigint): Promise<Array<{
    orderId: bigint;
    accountId: number;
    orderType: number;
    priceONS: number;
    lotLNS: bigint;
    leverageHdths: number;
  }>> {
    // Always use contract - API order IDs are incompatible with contract operations
    return this.getOpenOrdersFromContract(perpId, accountId);
  }

  /**
   * Get open orders via contract (bitmap iteration)
   * @internal
   */
  private async getOpenOrdersFromContract(perpId: bigint, accountId: bigint): Promise<Array<{
    orderId: bigint;
    accountId: number;
    orderType: number;
    priceONS: number;
    lotLNS: bigint;
    leverageHdths: number;
  }>> {
    const { leaves } = await this.getOrderIdIndex(perpId);
    const orders: Array<{
      orderId: bigint;
      accountId: number;
      orderType: number;
      priceONS: number;
      lotLNS: bigint;
      leverageHdths: number;
    }> = [];

    // Each leaf is a 256-bit bitmap where each set bit represents an order ID
    // The order ID is calculated as: leafIndex * 256 + bitPosition
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
      const leaf = leaves[leafIndex];
      if (leaf === 0n) continue;

      // Check each bit in the leaf
      for (let bit = 0; bit < 256; bit++) {
        if ((leaf >> BigInt(bit)) & 1n) {
          const orderId = BigInt(leafIndex * 256 + bit);
          try {
            const order = await this.getOrder(perpId, orderId);
            if (BigInt(order.accountId) === accountId && order.lotLNS > 0n) {
              orders.push({
                orderId,
                accountId: order.accountId,
                orderType: order.orderType,
                priceONS: order.priceONS,
                lotLNS: order.lotLNS,
                leverageHdths: order.leverageHdths,
              });
            }
          } catch {
            // Order may have been cancelled/filled between getting index and fetching
          }
        }
      }
    }

    return orders;
  }

  // ============ Write Functions ============
  // These go through the DelegatedAccount if set

  /**
   * Execute a single order
   */
  async execOrder(orderDesc: OrderDesc, nonce?: number): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    // Encode the function call
    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrder",
      args: [
        {
          orderDescId: orderDesc.orderDescId,
          perpId: orderDesc.perpId,
          orderType: orderDesc.orderType,
          orderId: orderDesc.orderId,
          pricePNS: orderDesc.pricePNS,
          lotLNS: orderDesc.lotLNS,
          expiryBlock: orderDesc.expiryBlock,
          postOnly: orderDesc.postOnly,
          fillOrKill: orderDesc.fillOrKill,
          immediateOrCancel: orderDesc.immediateOrCancel,
          maxMatches: orderDesc.maxMatches,
          leverageHdths: orderDesc.leverageHdths,
          lastExecutionBlock: orderDesc.lastExecutionBlock,
          amountCNS: orderDesc.amountCNS,
        },
      ],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
      ...(nonce !== undefined && { nonce }),
    });
  }

  /**
   * Execute multiple orders
   */
  async execOrders(orderDescs: OrderDesc[], revertOnFail = true): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrders",
      args: [
        orderDescs.map((od) => ({
          orderDescId: od.orderDescId,
          perpId: od.perpId,
          orderType: od.orderType,
          orderId: od.orderId,
          pricePNS: od.pricePNS,
          lotLNS: od.lotLNS,
          expiryBlock: od.expiryBlock,
          postOnly: od.postOnly,
          fillOrKill: od.fillOrKill,
          immediateOrCancel: od.immediateOrCancel,
          maxMatches: od.maxMatches,
          leverageHdths: od.leverageHdths,
          lastExecutionBlock: od.lastExecutionBlock,
          amountCNS: od.amountCNS,
        })),
        revertOnFail,
      ],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Deposit collateral to account
   */
  async depositCollateral(amountCNS: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "depositCollateral",
      args: [amountCNS],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Increase position collateral
   */
  async increasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "increasePositionCollateral",
      args: [perpId, amountCNS],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Request decrease position collateral (starts the timelock)
   */
  async requestDecreasePositionCollateral(perpId: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "requestDecreasePositionCollateral",
      args: [perpId],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Decrease position collateral (after timelock)
   */
  async decreasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint,
    clampToMaximum = false
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "decreasePositionCollateral",
      args: [perpId, amountCNS, clampToMaximum],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Allow or disallow order forwarding for this account
   */
  async allowOrderForwarding(allow: boolean): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "allowOrderForwarding",
      args: [allow],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }
}
