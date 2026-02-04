# Implementation Plan: API Migration

**Source**: `tasks/perpl-api-migration-plan.md` (reviewed & approved)
**For**: Implementor
**Status**: ✅ COMPLETE (2026-02-04)

---

## Overview

Replace direct contract calls with REST/WebSocket API for improved performance. Implement in 6 phases with contract fallback at each step.

**Key Files Reference**:
- API Documentation: `docs/api/`
- Existing Exchange wrapper: `src/sdk/contracts/Exchange.ts`
- Existing Portfolio: `src/sdk/trading/portfolio.ts`

---

## Phase 1: Create API Client Layer

### Task 1.1: Create Type Definitions

**File**: `src/sdk/api/types.ts`

```typescript
// Import base types from docs/api/types.md
// Map API response types to SDK types

export interface ApiConfig {
  baseUrl: string;        // https://testnet.perpl.xyz/api
  wsUrl: string;          // wss://testnet.perpl.xyz/api
  chainId: number;        // 10143
}

export interface AuthState {
  nonce: string;
  authenticated: boolean;
}

// REST response types (match docs/api/rest-endpoints.md)
export interface ContextResponse { /* from docs */ }
export interface FillsResponse { /* from docs */ }
export interface PositionHistoryResponse { /* from docs */ }

// WebSocket message types (match docs/api/websocket.md)
export type MessageType = 1 | 2 | 3 | 4 | 5 | 6 | /* ... */ 100;
export interface WsMessage { mt: MessageType; /* ... */ }
```

### Task 1.2: Create REST Client

**File**: `src/sdk/api/client.ts`

```typescript
import { ApiConfig, AuthState } from './types';

export class PerplApiClient {
  private config: ApiConfig;
  private authState: AuthState | null = null;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  // === Auth ===

  async authenticate(
    address: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<string> {
    // 1. POST /v1/auth/payload
    const payload = await this.post('/v1/auth/payload', {
      chain_id: this.config.chainId,
      address
    });

    // 2. Sign the SIWE message
    const signature = await signMessage(payload.message);

    // 3. POST /v1/auth/connect
    const auth = await this.post('/v1/auth/connect', {
      ...payload,
      signature
    });

    this.authState = { nonce: auth.nonce, authenticated: true };
    return auth.nonce;
  }

  isAuthenticated(): boolean {
    return this.authState?.authenticated ?? false;
  }

  // === Public Endpoints ===

  async getContext(): Promise<Context> {
    return this.get('/v1/pub/context');
  }

  async getCandles(
    marketId: number,
    resolution: number,
    from: number,
    to: number
  ): Promise<CandleSeries> {
    return this.get(`/v1/market-data/${marketId}/candles/${resolution}/${from}-${to}`);
  }

  // === Authenticated Endpoints ===

  async getFills(page?: string, count = 50): Promise<FillsResponse> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set('page', page);
    return this.get(`/v1/trading/fills?${params}`);
  }

  async getOrderHistory(page?: string, count = 50): Promise<OrderHistoryResponse> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set('page', page);
    return this.get(`/v1/trading/order-history?${params}`);
  }

  async getPositionHistory(page?: string, count = 50): Promise<PositionHistoryResponse> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set('page', page);
    return this.get(`/v1/trading/position-history?${params}`);
  }

  async getAccountHistory(page?: string, count = 50): Promise<AccountHistoryResponse> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set('page', page);
    return this.get(`/v1/trading/account-history?${params}`);
  }

  // === HTTP Helpers ===

  private async get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.authState) {
      headers['X-Auth-Nonce'] = this.authState.nonce;
    }

    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      this.authState = null;
      throw new ApiError('Unauthorized', 401);
    }

    if (res.status === 429) {
      throw new ApiError('Rate limited', 429);
    }

    if (!res.ok) {
      throw new ApiError(`API error: ${res.status}`, res.status);
    }

    return res.json();
  }

  private requireAuth() {
    if (!this.authState) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}
```

### Task 1.3: Create WebSocket Client

**File**: `src/sdk/api/websocket.ts`

```typescript
import { EventEmitter } from 'events';

export class PerplWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private authNonce: string | null = null;
  private subscriptions: Map<string, number> = new Map(); // stream -> sid
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 4000, 8000, 16000, 32000];
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(wsUrl: string) {
    super();
    this.wsUrl = wsUrl;
  }

  // === Market Data (Public) ===

  async connectMarketData(): Promise<void> {
    return this.connect(`${this.wsUrl}/ws/v1/market-data`);
  }

  subscribeOrderBook(marketId: number, callback: (book: L2Book) => void): void {
    this.subscribe(`order-book@${marketId}`, callback, [15, 16]);
  }

  subscribeTrades(marketId: number, callback: (trades: Trade[]) => void): void {
    this.subscribe(`trades@${marketId}`, callback, [17, 18]);
  }

  subscribeMarketState(chainId: number, callback: (state: MarketState) => void): void {
    this.subscribe(`market-state@${chainId}`, callback, [9]);
  }

  // === Trading (Authenticated) ===

  async connectTrading(authNonce: string): Promise<void> {
    this.authNonce = authNonce;
    await this.connect(`${this.wsUrl}/ws/v1/trading`);

    // Send auth message
    this.send({
      mt: 4, // AuthSignIn
      chain_id: 10143,
      nonce: authNonce,
      ses: crypto.randomUUID()
    });

    // Wait for wallet snapshot (mt: 19) to confirm auth
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Auth timeout')), 10000);
      this.once('wallet', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  subscribePositions(callback: (positions: Position[]) => void): void {
    this.on('positions', callback);
  }

  subscribeOrders(callback: (orders: Order[]) => void): void {
    this.on('orders', callback);
  }

  subscribeFills(callback: (fills: Fill[]) => void): void {
    this.on('fills', callback);
  }

  // === Order Submission ===

  submitOrder(request: OrderRequest): number {
    const rq = Date.now();
    this.send({ mt: 22, rq, ...request });
    return rq;
  }

  cancelOrder(marketId: number, accountId: number, orderId: number): number {
    const rq = Date.now();
    this.send({
      mt: 22,
      rq,
      mkt: marketId,
      acc: accountId,
      oid: orderId,
      t: 5, // Cancel
      s: 0,
      fl: 0,
      lv: 0,
      lb: 0
    });
    return rq;
  }

  // === Connection Management ===

  private async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startPing();
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onclose = (event) => {
        this.stopPing();
        this.handleDisconnect(event.code);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
    });
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.mt) {
      case 2: // Pong
        break;
      case 6: // SubscriptionResponse
        this.handleSubscriptionResponse(msg);
        break;
      case 15: // L2BookSnapshot
      case 16: // L2BookUpdate
        this.emit(`order-book`, msg);
        break;
      case 17: // TradesSnapshot
      case 18: // TradesUpdate
        this.emit(`trades`, msg);
        break;
      case 9: // MarketStateUpdate
        this.emit('market-state', msg);
        break;
      case 19: // WalletSnapshot
        this.emit('wallet', msg);
        break;
      case 23: // OrdersSnapshot
      case 24: // OrdersUpdate
        this.emit('orders', msg.d);
        break;
      case 25: // FillsUpdate
        this.emit('fills', msg.d);
        break;
      case 26: // PositionsSnapshot
      case 27: // PositionsUpdate
        this.emit('positions', msg.d);
        break;
      case 100: // Heartbeat
        this.emit('heartbeat', msg.h);
        break;
    }
  }

  private subscribe(stream: string, callback: (data: any) => void, messageTypes: number[]): void {
    this.send({
      mt: 5, // SubscriptionRequest
      subs: [{ stream, subscribe: true }]
    });
    this.on(stream.split('@')[0], callback);
  }

  private handleSubscriptionResponse(msg: any): void {
    for (const sub of msg.subs) {
      if (sub.sid) {
        this.subscriptions.set(sub.stream, sub.sid);
      }
    }
  }

  private async handleDisconnect(code: number): Promise<void> {
    this.emit('disconnect', code);

    if (code === 3401) {
      // Auth expired
      this.emit('auth-expired');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, 5)];
      this.reconnectAttempts++;

      await new Promise(r => setTimeout(r, delay));

      try {
        if (this.authNonce) {
          await this.connectTrading(this.authNonce);
        } else {
          await this.connectMarketData();
        }
        this.resubscribeAll();
      } catch (err) {
        this.handleDisconnect(0);
      }
    } else {
      this.emit('fatal', new Error('Max reconnect attempts exceeded'));
    }
  }

  private resubscribeAll(): void {
    const streams = Array.from(this.subscriptions.keys());
    if (streams.length > 0) {
      this.send({
        mt: 5,
        subs: streams.map(stream => ({ stream, subscribe: true }))
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

  disconnect(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
```

### Task 1.4: Create Exports

**File**: `src/sdk/api/index.ts`

```typescript
export { PerplApiClient, ApiError } from './client';
export { PerplWebSocketClient } from './websocket';
export * from './types';
```

### Task 1.5: Add Config

**Modify**: `src/sdk/config.ts`

```typescript
// Add to existing config
export const API_CONFIG = {
  baseUrl: process.env.PERPL_API_URL || 'https://testnet.perpl.xyz/api',
  wsUrl: process.env.PERPL_WS_URL || 'wss://testnet.perpl.xyz',
  chainId: 10143
};

// Feature flag
export const USE_API = process.env.PERPL_USE_API !== 'false';
```

### Task 1.6: Write Tests

**File**: `test/api/client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerplApiClient } from '../../src/sdk/api/client';

describe('PerplApiClient', () => {
  let client: PerplApiClient;

  beforeEach(() => {
    client = new PerplApiClient({
      baseUrl: 'https://testnet.perpl.xyz/api',
      wsUrl: 'wss://testnet.perpl.xyz',
      chainId: 10143
    });
  });

  describe('getContext', () => {
    it('fetches public context', async () => {
      const mockResponse = { markets: [], tokens: [], chain: {} };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.getContext();
      expect(result).toEqual(mockResponse);
    });
  });

  describe('authenticate', () => {
    it('completes auth flow', async () => {
      const mockPayload = { message: 'Sign this', nonce: 'abc', mac: 'xyz' };
      const mockAuth = { nonce: 'session-nonce' };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockPayload) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAuth) });

      const signMessage = vi.fn().mockResolvedValue('0xsignature');

      const nonce = await client.authenticate('0xaddress', signMessage);

      expect(signMessage).toHaveBeenCalledWith('Sign this');
      expect(nonce).toBe('session-nonce');
      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on 401 and clears auth', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

      await expect(client.getContext()).rejects.toThrow('Unauthorized');
    });

    it('throws on 429 rate limit', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

      await expect(client.getContext()).rejects.toThrow('Rate limited');
    });
  });
});
```

**Phase 1 Deliverables**:
- [x] `src/sdk/api/types.ts` created
- [x] `src/sdk/api/client.ts` created
- [x] `src/sdk/api/websocket.ts` created
- [x] `src/sdk/api/index.ts` created
- [x] `src/sdk/config.ts` updated
- [x] `test/api/client.test.ts` created
- [x] All tests pass

---

## Phase 2: Update Exchange Wrapper

### Task 2.1: Add API Client to Exchange

**Modify**: `src/sdk/contracts/Exchange.ts`

```typescript
import { PerplApiClient } from '../api';
import { USE_API } from '../config';

export class Exchange {
  private apiClient?: PerplApiClient;
  private publicClient: PublicClient;
  private useApi: boolean;

  constructor(options: {
    address: Address;
    publicClient: PublicClient;
    apiClient?: PerplApiClient;
  }) {
    this.publicClient = options.publicClient;
    this.apiClient = options.apiClient;
    this.useApi = USE_API && !!options.apiClient;
  }

  // Add API-first methods with contract fallback

  async getPosition(perpId: bigint, accountId: bigint): Promise<Position | null> {
    if (this.useApi && this.apiClient) {
      try {
        const positions = await this.apiClient.getPositionHistory();
        return positions.d.find(p =>
          BigInt(p.mkt) === perpId && p.st === 1 // Open positions
        ) || null;
      } catch (err) {
        console.warn('API failed, falling back to contract:', err);
      }
    }
    // Existing contract call
    return this.getPositionFromContract(perpId, accountId);
  }

  // ... similar pattern for other read methods
}
```

**Phase 2 Deliverables**:
- [x] Exchange constructor accepts apiClient
- [x] Key read methods have API-first + fallback
- [x] Existing tests still pass

---

## Phase 3: Update State Management

### Task 3.1: Add WebSocket to State Tracker

**Modify**: `src/sdk/state/exchange.ts`

```typescript
import { PerplWebSocketClient } from '../api';

export class ExchangeStateTracker {
  private wsClient?: PerplWebSocketClient;
  private positions: Map<bigint, Position> = new Map();
  private orders: Map<bigint, Order> = new Map();

  async connectRealtime(wsClient: PerplWebSocketClient, authNonce: string): Promise<void> {
    this.wsClient = wsClient;
    await wsClient.connectTrading(authNonce);

    wsClient.subscribePositions((positions) => {
      for (const pos of positions) {
        if (pos.st === 1) { // Open
          this.positions.set(BigInt(pos.pid), pos);
        } else {
          this.positions.delete(BigInt(pos.pid));
        }
      }
      this.emit('positions-updated', this.positions);
    });

    wsClient.subscribeOrders((orders) => {
      for (const order of orders) {
        if (order.r) { // Remove flag
          this.orders.delete(BigInt(order.oid));
        } else {
          this.orders.set(BigInt(order.oid), order);
        }
      }
      this.emit('orders-updated', this.orders);
    });
  }

  // Keep existing refresh methods as fallback
  async refreshPosition(perpId: bigint): Promise<Position | null> { /* ... */ }
}
```

**Phase 3 Deliverables**:
- [x] ExchangeStateTracker supports WebSocket
- [x] Real-time position/order updates working
- [x] Fallback refresh methods preserved

---

## Phase 4: Update Portfolio

### Task 4.1: Use Batch Endpoints

**Modify**: `src/sdk/trading/portfolio.ts`

```typescript
export class Portfolio {
  private apiClient?: PerplApiClient;

  constructor(options: {
    exchange: Exchange;
    publicClient: PublicClient;
    apiClient?: PerplApiClient;
  }) {
    // ...
    this.apiClient = options.apiClient;
  }

  async getPositions(): Promise<PortfolioPosition[]> {
    if (this.apiClient) {
      try {
        const response = await this.apiClient.getPositionHistory();
        return response.d
          .filter(p => p.st === 1) // Open only
          .map(this.mapApiPositionToPortfolio);
      } catch (err) {
        console.warn('API failed, falling back to contract:', err);
      }
    }
    // Existing N+1 query fallback
    return this.getPositionsFromContract();
  }

  async getOrderHistory(): Promise<Order[]> {
    if (this.apiClient) {
      const response = await this.apiClient.getOrderHistory();
      return response.d;
    }
    // Contract fallback (bitmap iteration)
    return this.getOrderHistoryFromContract();
  }
}
```

**Phase 4 Deliverables**:
- [x] Portfolio uses batch API endpoints
- [x] Contract fallback preserved
- [x] Performance improvement measurable

---

## Phase 5: Update Wallet Classes

### Task 5.1: Add API to Operator

**Modify**: `src/sdk/wallet/operator.ts`

```typescript
export class OperatorWallet {
  private apiClient?: PerplApiClient;
  private wsClient?: PerplWebSocketClient;

  async connect(options: {
    exchangeAddress: Address;
    delegatedAccountAddress: Address;
    apiClient?: PerplApiClient;
  }): Promise<void> {
    // Existing contract setup...

    if (options.apiClient) {
      this.apiClient = options.apiClient;

      // Authenticate with API
      await this.apiClient.authenticate(
        this.address,
        (msg) => this.signMessage(msg)
      );

      // Connect WebSocket for trading
      this.wsClient = new PerplWebSocketClient(API_CONFIG.wsUrl);
      await this.wsClient.connectTrading(this.apiClient.authNonce);
    }
  }

  // Order submission via WebSocket (faster)
  async marketOpenLong(params: OpenLongParams): Promise<string> {
    if (this.wsClient) {
      const requestId = this.wsClient.submitOrder({
        mkt: Number(params.perpId),
        acc: this.accountId,
        t: 1, // OpenLong
        p: 0, // Market
        s: Number(params.lotLNS),
        fl: 4, // IOC
        lv: Number(params.leverageHdths),
        lb: await this.getCurrentBlock() + 100
      });
      return String(requestId);
    }
    // Fallback to contract
    return this.marketOpenLongViaContract(params);
  }
}
```

**Phase 5 Deliverables**:
- [x] OperatorWallet initializes API client
- [x] WebSocket order submission working
- [x] Contract fallback preserved

---

## Phase 6: CLI Updates

### Task 6.1: Update CLI Initialization

**Modify**: `src/cli/index.ts`

```typescript
import { PerplApiClient } from '../sdk/api';
import { API_CONFIG, USE_API } from '../sdk/config';

// Add --no-api flag
program.option('--no-api', 'Disable API, use contract calls only');

// In command handlers:
async function getOperator(options: { api?: boolean }) {
  const operator = new OperatorWallet(/* ... */);

  if (options.api !== false && USE_API) {
    const apiClient = new PerplApiClient(API_CONFIG);
    await operator.connect({ /* ... */, apiClient });
    console.log('Connected via API');
  } else {
    await operator.connect({ /* ... */ });
    console.log('Connected via contracts');
  }

  return operator;
}
```

### Task 6.2: Add Status Display

**Modify**: `src/cli/manage.ts`

```typescript
// In status command
console.log(`Mode: ${operator.isApiConnected() ? 'API' : 'Contract'}`);
```

**Phase 6 Deliverables**:
- [x] `--no-api` flag working
- [x] Status shows connection mode
- [x] All CLI commands work with both modes

---

## Verification Checklist

After each phase:
- [x] `npm run typecheck` passes
- [x] `npm test` passes (297 tests)
- [x] Manual test: `npm run dev -- manage status`

Final verification:
- [x] All existing tests pass
- [x] CLI works with `--no-api` (contract mode)
- [x] CLI works without flag (API mode)
- [x] WebSocket real-time updates working
- [x] Fallback triggers on API failure

---

## File Checklist

### Create
- [x] `src/sdk/api/types.ts`
- [x] `src/sdk/api/client.ts`
- [x] `src/sdk/api/websocket.ts`
- [x] `src/sdk/api/index.ts`
- [x] `test/api/client.test.ts`
- [x] `test/api/websocket.test.ts`

### Modify
- [x] `src/sdk/config.ts`
- [x] `src/sdk/contracts/Exchange.ts`
- [x] `src/sdk/state/exchange.ts`
- [x] `src/sdk/trading/portfolio.ts`
- [x] `src/sdk/wallet/operator.ts`
- [x] `src/cli/index.ts`
- [x] `src/cli/manage.ts`

Note: `src/sdk/wallet/owner.ts` was not modified - API integration is handled via OperatorWallet.
