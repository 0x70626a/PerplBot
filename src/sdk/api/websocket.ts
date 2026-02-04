/**
 * Perpl WebSocket Client
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import type {
  MessageType,
  WsMessage,
  L2Book,
  Trade,
  ApiMarketState,
  Position,
  Order,
  Fill,
  WalletAccount,
  OrderRequest,
  ApiOrderType,
  OrderFlags,
} from "./types.js";

// Re-export MessageType for consumers
export { MessageType } from "./types.js";

export interface WebSocketClientEvents {
  connect: [];
  disconnect: [code: number];
  error: [error: Error];
  "auth-expired": [];
  fatal: [error: Error];
  heartbeat: [blockNumber: number];
  "order-book": [book: L2Book];
  trades: [trades: Trade[]];
  "market-state": [state: Record<number, ApiMarketState | undefined>];
  wallet: [accounts: WalletAccount[]];
  positions: [positions: Position[]];
  orders: [orders: Order[]];
  fills: [fills: Fill[]];
}

export class PerplWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private chainId: number;
  private authNonce: string | null = null;
  private subscriptions: Map<string, number> = new Map(); // stream -> sid
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private currentUrl: string | null = null;

  constructor(wsUrl: string, chainId = 10143) {
    super();
    this.wsUrl = wsUrl;
    this.chainId = chainId;
  }

  // === Market Data (Public) ===

  /**
   * Connect to market data WebSocket (no auth required)
   */
  async connectMarketData(): Promise<void> {
    return this.connect(`${this.wsUrl}/ws/v1/market-data`);
  }

  /**
   * Subscribe to order book updates
   */
  subscribeOrderBook(marketId: number): void {
    this.subscribe(`order-book@${marketId}`);
  }

  /**
   * Subscribe to trade updates
   */
  subscribeTrades(marketId: number): void {
    this.subscribe(`trades@${marketId}`);
  }

  /**
   * Subscribe to market state updates
   */
  subscribeMarketState(): void {
    this.subscribe(`market-state@${this.chainId}`);
  }

  /**
   * Subscribe to candle updates
   */
  subscribeCandles(marketId: number, resolution: number): void {
    this.subscribe(`candles@${marketId}*${resolution}`);
  }

  /**
   * Subscribe to heartbeat
   */
  subscribeHeartbeat(): void {
    this.subscribe(`heartbeat@${this.chainId}`);
  }

  /**
   * Subscribe to funding rate updates
   */
  subscribeFunding(): void {
    this.subscribe(`funding@${this.chainId}`);
  }

  // === Trading (Authenticated) ===

  /**
   * Connect to trading WebSocket (requires auth)
   * @param authNonce Auth nonce from REST API authentication
   * @param cookies Optional cookies from REST API authentication
   */
  async connectTrading(authNonce: string, cookies?: string): Promise<void> {
    this.authNonce = authNonce;
    await this.connect(`${this.wsUrl}/ws/v1/trading`, cookies);

    // Send auth message
    this.send({
      mt: 4, // AuthSignIn
      chain_id: this.chainId,
      nonce: authNonce,
      ses: crypto.randomUUID(),
    });

    // Wait for wallet snapshot (mt: 19) to confirm auth
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Trading WebSocket auth timeout"));
      }, 10000);

      const handler = () => {
        clearTimeout(timeout);
        this.off("wallet", handler);
        resolve();
      };

      this.once("wallet", handler);
    });
  }

  /**
   * Submit an order via WebSocket
   * @returns Request ID
   */
  submitOrder(request: Omit<OrderRequest, "mt">): number {
    const rq = request.rq || Date.now();
    this.send({ mt: 22, ...request, rq });
    return rq;
  }

  /**
   * Open a long position
   */
  openLong(params: {
    marketId: number;
    accountId: number;
    size: number;
    price?: number;
    leverage: number;
    lastBlock: number;
    flags?: OrderFlags;
  }): number {
    return this.submitOrder({
      rq: Date.now(),
      mkt: params.marketId,
      acc: params.accountId,
      t: 1 as ApiOrderType, // OpenLong
      p: params.price ?? 0,
      s: params.size,
      fl: params.flags ?? (params.price ? 0 : 4), // GTC for limit, IOC for market
      lv: params.leverage,
      lb: params.lastBlock,
    });
  }

  /**
   * Open a short position
   */
  openShort(params: {
    marketId: number;
    accountId: number;
    size: number;
    price?: number;
    leverage: number;
    lastBlock: number;
    flags?: OrderFlags;
  }): number {
    return this.submitOrder({
      rq: Date.now(),
      mkt: params.marketId,
      acc: params.accountId,
      t: 2 as ApiOrderType, // OpenShort
      p: params.price ?? 0,
      s: params.size,
      fl: params.flags ?? (params.price ? 0 : 4),
      lv: params.leverage,
      lb: params.lastBlock,
    });
  }

  /**
   * Close a long position
   */
  closeLong(params: {
    marketId: number;
    accountId: number;
    positionId: number;
    size: number;
    price?: number;
    lastBlock: number;
    flags?: OrderFlags;
  }): number {
    return this.submitOrder({
      rq: Date.now(),
      mkt: params.marketId,
      acc: params.accountId,
      t: 3 as ApiOrderType, // CloseLong
      p: params.price ?? 0,
      s: params.size,
      fl: params.flags ?? (params.price ? 0 : 4),
      lp: params.positionId,
      lv: 0,
      lb: params.lastBlock,
    });
  }

  /**
   * Close a short position
   */
  closeShort(params: {
    marketId: number;
    accountId: number;
    positionId: number;
    size: number;
    price?: number;
    lastBlock: number;
    flags?: OrderFlags;
  }): number {
    return this.submitOrder({
      rq: Date.now(),
      mkt: params.marketId,
      acc: params.accountId,
      t: 4 as ApiOrderType, // CloseShort
      p: params.price ?? 0,
      s: params.size,
      fl: params.flags ?? (params.price ? 0 : 4),
      lp: params.positionId,
      lv: 0,
      lb: params.lastBlock,
    });
  }

  /**
   * Cancel an order
   */
  cancelOrder(marketId: number, accountId: number, orderId: number, lastBlock: number): number {
    return this.submitOrder({
      rq: Date.now(),
      mkt: marketId,
      acc: accountId,
      oid: orderId,
      t: 5 as ApiOrderType, // Cancel
      s: 0,
      fl: 0 as OrderFlags,
      lv: 0,
      lb: lastBlock,
    });
  }

  // === Connection Management ===

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.currentUrl = null;
  }

  private cookies?: string;

  private async connect(url: string, cookies?: string): Promise<void> {
    this.currentUrl = url;
    if (cookies) this.cookies = cookies;

    return new Promise((resolve, reject) => {
      const options = cookies ? { headers: { Cookie: cookies } } : undefined;
      this.ws = new WebSocket(url, options);

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.startPing();
        this.emit("connect");
        resolve();
      });

      this.ws.on("error", (err: Error) => {
        this.emit("error", err);
        reject(err);
      });

      this.ws.on("close", (code: number) => {
        this.stopPing();
        this.handleDisconnect(code);
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WsMessage;
          this.handleMessage(msg);
        } catch (err) {
          this.emit("error", err as Error);
        }
      });
    });
  }

  private handleMessage(msg: WsMessage): void {
    const mt = msg.mt as number;

    switch (mt) {
      case 2: // Pong
        break;

      case 6: // SubscriptionResponse
        this.handleSubscriptionResponse(msg as any);
        break;

      case 15: // L2BookSnapshot
      case 16: // L2BookUpdate
        this.emit("order-book", msg as L2Book);
        break;

      case 17: // TradesSnapshot
      case 18: // TradesUpdate
        this.emit("trades", (msg as any).d as Trade[]);
        break;

      case 9: // MarketStateUpdate
        this.emit("market-state", (msg as any).d);
        break;

      case 19: // WalletSnapshot
        this.emit("wallet", (msg as any).as as WalletAccount[]);
        break;

      case 23: // OrdersSnapshot
      case 24: // OrdersUpdate
        this.emit("orders", (msg as any).d as Order[]);
        break;

      case 25: // FillsUpdate
        this.emit("fills", (msg as any).d as Fill[]);
        break;

      case 26: // PositionsSnapshot
      case 27: // PositionsUpdate
        this.emit("positions", (msg as any).d as Position[]);
        break;

      case 100: // Heartbeat
        this.emit("heartbeat", (msg as any).h as number);
        break;
    }
  }

  private subscribe(stream: string): void {
    this.send({
      mt: 5, // SubscriptionRequest
      subs: [{ stream, subscribe: true }],
    });
  }

  private handleSubscriptionResponse(msg: { subs: Array<{ stream: string; sid?: number }> }): void {
    for (const sub of msg.subs) {
      if (sub.sid) {
        this.subscriptions.set(sub.stream, sub.sid);
      }
    }
  }

  private async handleDisconnect(code: number): Promise<void> {
    this.emit("disconnect", code);

    if (code === 3401) {
      // Auth expired
      this.emit("auth-expired");
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts && this.currentUrl) {
      const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)];
      this.reconnectAttempts++;

      await new Promise((r) => setTimeout(r, delay));

      try {
        if (this.authNonce && this.currentUrl.includes("trading")) {
          await this.connectTrading(this.authNonce);
        } else {
          await this.connect(this.currentUrl);
        }
        this.resubscribeAll();
      } catch {
        this.handleDisconnect(0);
      }
    } else {
      this.emit("fatal", new Error("Max reconnect attempts exceeded"));
    }
  }

  private resubscribeAll(): void {
    const streams = Array.from(this.subscriptions.keys());
    if (streams.length > 0) {
      this.send({
        mt: 5,
        subs: streams.map((stream) => ({ stream, subscribe: true })),
      });
    }
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ mt: 1, t: Date.now() });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

// Type-safe event emitter overrides
export interface PerplWebSocketClient {
  on<E extends keyof WebSocketClientEvents>(event: E, listener: (...args: WebSocketClientEvents[E]) => void): this;
  once<E extends keyof WebSocketClientEvents>(event: E, listener: (...args: WebSocketClientEvents[E]) => void): this;
  off<E extends keyof WebSocketClientEvents>(event: E, listener: (...args: WebSocketClientEvents[E]) => void): this;
  emit<E extends keyof WebSocketClientEvents>(event: E, ...args: WebSocketClientEvents[E]): boolean;
}
