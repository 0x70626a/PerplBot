/**
 * Unified wallet for all trading operations
 * Single wallet class that trades directly on the Exchange
 * Supports WebSocket order submission with contract fallback
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Exchange, type OrderDesc, OrderType } from "../contracts/Exchange.js";
import { ERC20Abi } from "../contracts/abi.js";
import type { ChainConfig } from "../config.js";
import { PerplApiClient } from "../api/client.js";
import { PerplWebSocketClient } from "../api/websocket.js";
import { OrderFlags } from "../api/types.js";
import { API_CONFIG, USE_API } from "../config.js";

function toWsFlags(params: {
  postOnly?: boolean;
  fillOrKill?: boolean;
  immediateOrCancel?: boolean;
}): OrderFlags {
  if (params.immediateOrCancel) return OrderFlags.ImmediateOrCancel;
  if (params.fillOrKill) return OrderFlags.FillOrKill;
  if (params.postOnly) return OrderFlags.PostOnly;
  return OrderFlags.GoodTillCancel;
}

/**
 * Unified wallet for executing trades directly on the Exchange
 * Supports WebSocket order submission for faster execution
 */
export class Wallet {
  public readonly address: Address;
  public readonly publicClient: PublicClient;
  public readonly walletClient: WalletClient;
  private exchange?: Exchange;
  private apiClient?: PerplApiClient;
  private wsClient?: PerplWebSocketClient;
  private accountId?: number;
  private useApi: boolean = false;

  private constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient: WalletClient
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }

  /**
   * Create a Wallet from a private key
   */
  static fromPrivateKey(
    privateKey: `0x${string}`,
    chainConfig: ChainConfig
  ): Wallet {
    const account = privateKeyToAccount(privateKey);

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    return new Wallet(account.address, publicClient, walletClient);
  }

  /**
   * Connect to Exchange directly
   * Optionally enables API mode for faster order submission
   */
  connect(
    exchangeAddress: Address,
    options?: {
      enableApi?: boolean;
      apiClient?: PerplApiClient;
    }
  ): Exchange {
    // Create API client if enabled
    if (options?.enableApi !== false && USE_API) {
      this.apiClient = options?.apiClient ?? new PerplApiClient(API_CONFIG);
      this.useApi = true;
    }

    this.exchange = new Exchange(
      exchangeAddress,
      this.publicClient,
      this.walletClient,
      this.apiClient
    );
    return this.exchange;
  }

  /**
   * Authenticate with API and connect trading WebSocket
   * Required for WebSocket order submission
   */
  async connectApi(): Promise<void> {
    if (!this.apiClient) {
      throw new Error("API client not initialized. Call connect() with enableApi: true first.");
    }

    // Sign message for SIWE auth
    const signMessage = async (message: string) => {
      return this.walletClient.signMessage({
        account: this.walletClient.account!,
        message,
      });
    };

    // Authenticate
    const authNonce = await this.apiClient.authenticate(this.address, signMessage);
    const authCookies = this.apiClient.getAuthCookies();

    // Connect trading WebSocket
    this.wsClient = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);
    await this.wsClient.connectTrading(authNonce, authCookies || undefined);

    // Get account ID from wallet snapshot
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for wallet snapshot")), 10000);
      this.wsClient!.once("wallet", (accounts) => {
        clearTimeout(timeout);
        if (accounts.length > 0) {
          this.accountId = accounts[0].id;
        }
        resolve();
      });
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnectApi(): void {
    this.wsClient?.disconnect();
    this.wsClient = undefined;
    this.accountId = undefined;
  }

  /**
   * Check if API mode is connected
   */
  isApiConnected(): boolean {
    return this.wsClient?.isConnected() ?? false;
  }

  /**
   * Get the API client
   */
  getApiClient(): PerplApiClient | undefined {
    return this.apiClient;
  }

  /**
   * Get the WebSocket client
   */
  getWsClient(): PerplWebSocketClient | undefined {
    return this.wsClient;
  }

  /**
   * Set the account ID for WebSocket orders
   */
  setAccountId(accountId: number): void {
    this.accountId = accountId;
  }

  /**
   * Get current block number for WebSocket orders
   */
  private async getCurrentBlock(): Promise<number> {
    const block = await this.publicClient.getBlockNumber();
    return Number(block);
  }

  /**
   * Check if WebSocket is ready for order submission
   */
  private get wsReady(): boolean {
    return !!(this.wsClient?.isConnected() && this.accountId !== undefined);
  }

  /**
   * Get the connected Exchange
   */
  getExchange(): Exchange {
    if (!this.exchange) {
      throw new Error("Not connected to Exchange. Call connect() first.");
    }
    return this.exchange;
  }

  /**
   * Execute a single order
   */
  async execOrder(orderDesc: OrderDesc, nonce?: number): Promise<Hash> {
    return this.getExchange().execOrder(orderDesc, nonce);
  }

  /**
   * Execute multiple orders
   */
  async execOrders(orderDescs: OrderDesc[], revertOnFail = true): Promise<Hash> {
    return this.getExchange().execOrders(orderDescs, revertOnFail);
  }

  /**
   * Open a long position
   * Uses WebSocket if connected, falls back to RPC
   */
  async openLong(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
    nonce?: number;
  }): Promise<Hash | number> {
    if (this.wsReady) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.openLong({
          marketId: Number(params.perpId),
          accountId: this.accountId!,
          size: Number(params.lotLNS),
          price: Number(params.pricePNS),
          leverage: Number(params.leverageHdths),
          lastBlock: lastBlock + 100,
          flags: toWsFlags(params),
        });
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.OpenLong,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc, params.nonce);
  }

  /**
   * Open a short position
   * Uses WebSocket if connected, falls back to RPC
   */
  async openShort(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
    nonce?: number;
  }): Promise<Hash | number> {
    if (this.wsReady) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.openShort({
          marketId: Number(params.perpId),
          accountId: this.accountId!,
          size: Number(params.lotLNS),
          price: Number(params.pricePNS),
          leverage: Number(params.leverageHdths),
          lastBlock: lastBlock + 100,
          flags: toWsFlags(params),
        });
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.OpenShort,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc, params.nonce);
  }

  /**
   * Close a long position
   * Uses WebSocket if connected and positionId provided, falls back to RPC
   */
  async closeLong(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
    positionId?: number;
  }): Promise<Hash | number> {
    if (this.wsReady && params.positionId !== undefined) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.closeLong({
          marketId: Number(params.perpId),
          accountId: this.accountId!,
          positionId: params.positionId,
          size: Number(params.lotLNS),
          price: Number(params.pricePNS),
          lastBlock: lastBlock + 100,
          flags: toWsFlags(params),
        });
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.CloseLong,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: 100n, // Not used for close
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Close a short position
   * Uses WebSocket if connected and positionId provided, falls back to RPC
   */
  async closeShort(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
    positionId?: number;
  }): Promise<Hash | number> {
    if (this.wsReady && params.positionId !== undefined) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.closeShort({
          marketId: Number(params.perpId),
          accountId: this.accountId!,
          positionId: params.positionId,
          size: Number(params.lotLNS),
          price: Number(params.pricePNS),
          lastBlock: lastBlock + 100,
          flags: toWsFlags(params),
        });
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.CloseShort,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: 100n, // Not used for close
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Cancel an order
   * Uses WebSocket if connected, falls back to RPC
   */
  async cancelOrder(perpId: bigint, orderId: bigint): Promise<Hash | number> {
    if (this.wsReady) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.cancelOrder(
          Number(perpId),
          this.accountId!,
          Number(orderId),
          lastBlock + 100,
        );
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType: OrderType.Cancel,
      orderId,
      pricePNS: 0n,
      lotLNS: 0n,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 0n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Modify an existing order
   * Uses WebSocket if connected, falls back to RPC
   */
  async modifyOrder(params: {
    perpId: bigint;
    orderId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths?: bigint;
    postOnly?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash | number> {
    if (this.wsReady) {
      try {
        const lastBlock = await this.getCurrentBlock();
        return this.wsClient!.changeOrder({
          marketId: Number(params.perpId),
          accountId: this.accountId!,
          orderId: Number(params.orderId),
          size: Number(params.lotLNS),
          price: Number(params.pricePNS),
          leverage: Number(params.leverageHdths ?? 100n),
          lastBlock: lastBlock + 100,
          flags: params.postOnly ? OrderFlags.PostOnly : OrderFlags.GoodTillCancel,
        });
      } catch { /* fall through to RPC */ }
    }

    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.Change,
      orderId: params.orderId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths ?? 100n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
      maxSlippageBps: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Deposit collateral to account
   */
  async depositCollateral(amountCNS: bigint): Promise<Hash> {
    return this.getExchange().depositCollateral(amountCNS);
  }

  /**
   * Withdraw collateral from account
   */
  async withdrawCollateral(amountCNS: bigint): Promise<Hash> {
    return this.getExchange().withdrawCollateral(amountCNS);
  }

  /**
   * Increase position collateral
   */
  async increasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint
  ): Promise<Hash> {
    return this.getExchange().increasePositionCollateral(perpId, amountCNS);
  }

  /**
   * Request decrease position collateral
   */
  async requestDecreasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint,
    clampToMaximum = false,
  ): Promise<Hash> {
    return this.getExchange().requestDecreasePositionCollateral(perpId, amountCNS, clampToMaximum);
  }

  /**
   * Decrease position collateral
   */
  async decreasePositionCollateral(
    perpId: bigint,
    accountId: bigint,
    impactAdjPricePNS: number,
    borrowMarginFracHdths: number,
    positionType: number,
  ): Promise<Hash> {
    return this.getExchange().decreasePositionCollateral(
      perpId,
      accountId,
      impactAdjPricePNS,
      borrowMarginFracHdths,
      positionType,
    );
  }

  /**
   * Get ETH balance (for gas)
   */
  async getEthBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  /**
   * Get balance of a token
   */
  async getTokenBalance(tokenAddress: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20Abi,
      functionName: "balanceOf",
      args: [this.address],
    }) as Promise<bigint>;
  }

  // ============ Market Orders (IOC) ============

  /**
   * Market buy (open long with IOC)
   */
  async marketOpenLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    maxPricePNS: bigint;
  }): Promise<Hash | number> {
    return this.openLong({
      perpId: params.perpId,
      pricePNS: params.maxPricePNS,
      lotLNS: params.lotLNS,
      leverageHdths: params.leverageHdths,
      immediateOrCancel: true,
    });
  }

  /**
   * Market sell (open short with IOC)
   */
  async marketOpenShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    minPricePNS: bigint;
  }): Promise<Hash | number> {
    return this.openShort({
      perpId: params.perpId,
      pricePNS: params.minPricePNS,
      lotLNS: params.lotLNS,
      leverageHdths: params.leverageHdths,
      immediateOrCancel: true,
    });
  }

  /**
   * Market close long (with IOC)
   */
  async marketCloseLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    minPricePNS: bigint;
    positionId?: number;
  }): Promise<Hash | number> {
    return this.closeLong({
      perpId: params.perpId,
      pricePNS: params.minPricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: true,
      positionId: params.positionId,
    });
  }

  /**
   * Market close short (with IOC)
   */
  async marketCloseShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    maxPricePNS: bigint;
    positionId?: number;
  }): Promise<Hash | number> {
    return this.closeShort({
      perpId: params.perpId,
      pricePNS: params.maxPricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: true,
      positionId: params.positionId,
    });
  }

  // ============ Reduce Position ============

  /**
   * Reduce a long position by a specific amount
   */
  async reduceLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    pricePNS: bigint;
    immediateOrCancel?: boolean;
    positionId?: number;
  }): Promise<Hash | number> {
    return this.closeLong({
      perpId: params.perpId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: params.immediateOrCancel ?? false,
      positionId: params.positionId,
    });
  }

  /**
   * Reduce a short position by a specific amount
   */
  async reduceShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    pricePNS: bigint;
    immediateOrCancel?: boolean;
    positionId?: number;
  }): Promise<Hash | number> {
    return this.closeShort({
      perpId: params.perpId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: params.immediateOrCancel ?? false,
      positionId: params.positionId,
    });
  }

  // ============ Add Margin ============

  /**
   * Add margin to a position
   */
  async addMargin(perpId: bigint, amountCNS: bigint): Promise<Hash> {
    return this.increasePositionCollateral(perpId, amountCNS);
  }
}
