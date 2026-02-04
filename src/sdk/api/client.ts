/**
 * Perpl REST API Client
 */

import type {
  ApiConfig,
  AuthState,
  AuthPayloadResponse,
  AuthConnectResponse,
  Context,
  CandleSeries,
  AccountHistoryPage,
  FillHistoryPage,
  OrderHistoryPage,
  PositionHistoryPage,
  RefCode,
  ContactInfo,
  AnnouncementsResponse,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class PerplApiClient {
  private config: ApiConfig;
  private authState: AuthState | null = null;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  // === Auth ===

  /**
   * Authenticate with the API using wallet signature
   * @param address Wallet address
   * @param signMessage Function to sign the SIWE message
   * @returns Auth nonce for authenticated requests
   */
  async authenticate(
    address: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<string> {
    // Step 1: Get payload
    const payload = await this.post<AuthPayloadResponse>("/v1/auth/payload", {
      chain_id: this.config.chainId,
      address,
    });

    // Step 2: Sign the SIWE message
    const signature = await signMessage(payload.message);

    // Step 3: Connect with signature
    const { response, data } = await this.requestWithResponse<AuthConnectResponse>(
      "POST",
      "/v1/auth/connect",
      {
        chain_id: this.config.chainId,
        address,
        message: payload.message,
        nonce: payload.nonce,
        issued_at: payload.issued_at,
        mac: payload.mac,
        signature,
      }
    );

    // Capture cookies
    const setCookies = response.headers.getSetCookie?.() || [];
    const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

    this.authState = {
      nonce: data.nonce,
      cookies,
      authenticated: true,
    };

    return data.nonce;
  }

  /**
   * Check if client is authenticated
   */
  isAuthenticated(): boolean {
    return this.authState?.authenticated ?? false;
  }

  /**
   * Get the auth nonce (for WebSocket authentication)
   */
  getAuthNonce(): string | null {
    return this.authState?.nonce ?? null;
  }

  /**
   * Get the auth cookies (for WebSocket authentication)
   */
  getAuthCookies(): string | null {
    return this.authState?.cookies ?? null;
  }

  /**
   * Clear authentication state
   */
  clearAuth(): void {
    this.authState = null;
  }

  // === Public Endpoints ===

  /**
   * Get protocol context (markets, tokens, chain config)
   */
  async getContext(): Promise<Context> {
    return this.get<Context>("/v1/pub/context");
  }

  /**
   * Get OHLCV candles
   * @param marketId Market ID (e.g., 16 for BTC)
   * @param resolution Candle resolution in seconds
   * @param from Start timestamp (ms)
   * @param to End timestamp (ms)
   */
  async getCandles(
    marketId: number,
    resolution: number,
    from: number,
    to: number
  ): Promise<CandleSeries> {
    return this.get<CandleSeries>(
      `/v1/market-data/${marketId}/candles/${resolution}/${from}-${to}`
    );
  }

  /**
   * Get announcements (works without auth)
   */
  async getAnnouncements(): Promise<AnnouncementsResponse> {
    return this.get<AnnouncementsResponse>("/v1/profile/announcements");
  }

  // === Authenticated Endpoints ===

  /**
   * Get account history (deposits, withdrawals, settlements, etc.)
   */
  async getAccountHistory(page?: string, count = 50): Promise<AccountHistoryPage> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set("page", page);
    return this.get<AccountHistoryPage>(`/v1/trading/account-history?${params}`);
  }

  /**
   * Get all account history (auto-paginate)
   */
  async getAllAccountHistory(maxPages = 100): Promise<AccountHistoryPage["d"]> {
    const events: AccountHistoryPage["d"] = [];
    let page: string | undefined;
    let pageCount = 0;

    do {
      const result = await this.getAccountHistory(page, 100);
      events.push(...result.d);
      page = result.np;
      pageCount++;
    } while (page && pageCount < maxPages);

    return events;
  }

  /**
   * Get order fill history
   */
  async getFills(page?: string, count = 50): Promise<FillHistoryPage> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set("page", page);
    return this.get<FillHistoryPage>(`/v1/trading/fills?${params}`);
  }

  /**
   * Get all fills (auto-paginate)
   */
  async getAllFills(maxPages = 100): Promise<FillHistoryPage["d"]> {
    const fills: FillHistoryPage["d"] = [];
    let page: string | undefined;
    let pageCount = 0;

    do {
      const result = await this.getFills(page, 100);
      fills.push(...result.d);
      page = result.np;
      pageCount++;
    } while (page && pageCount < maxPages);

    return fills;
  }

  /**
   * Get order history
   */
  async getOrderHistory(page?: string, count = 50): Promise<OrderHistoryPage> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set("page", page);
    return this.get<OrderHistoryPage>(`/v1/trading/order-history?${params}`);
  }

  /**
   * Get all order history (auto-paginate)
   */
  async getAllOrderHistory(maxPages = 100): Promise<OrderHistoryPage["d"]> {
    const orders: OrderHistoryPage["d"] = [];
    let page: string | undefined;
    let pageCount = 0;

    do {
      const result = await this.getOrderHistory(page, 100);
      orders.push(...result.d);
      page = result.np;
      pageCount++;
    } while (page && pageCount < maxPages);

    return orders;
  }

  /**
   * Get position history
   */
  async getPositionHistory(page?: string, count = 50): Promise<PositionHistoryPage> {
    this.requireAuth();
    const params = new URLSearchParams({ count: String(count) });
    if (page) params.set("page", page);
    return this.get<PositionHistoryPage>(`/v1/trading/position-history?${params}`);
  }

  /**
   * Get all position history (auto-paginate)
   */
  async getAllPositionHistory(maxPages = 100): Promise<PositionHistoryPage["d"]> {
    const positions: PositionHistoryPage["d"] = [];
    let page: string | undefined;
    let pageCount = 0;

    do {
      const result = await this.getPositionHistory(page, 100);
      positions.push(...result.d);
      page = result.np;
      pageCount++;
    } while (page && pageCount < maxPages);

    return positions;
  }

  /**
   * Get referral code
   */
  async getRefCode(): Promise<RefCode | null> {
    this.requireAuth();
    try {
      return await this.get<RefCode>("/v1/profile/ref-code");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get contact info
   */
  async getContactInfo(): Promise<ContactInfo> {
    this.requireAuth();
    return this.get<ContactInfo>("/v1/profile/contact-info");
  }

  /**
   * Update contact info
   */
  async updateContactInfo(info: ContactInfo): Promise<void> {
    this.requireAuth();
    await this.post("/v1/profile/contact-info", info);
  }

  // === HTTP Helpers ===

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { data } = await this.requestWithResponse<T>(method, path, body);
    return data;
  }

  private async requestWithResponse<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ response: Response; data: T }> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authState) {
      headers["X-Auth-Nonce"] = this.authState.nonce;
      if (this.authState.cookies) {
        headers["Cookie"] = this.authState.cookies;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      this.authState = null;
      throw new ApiError("Unauthorized", 401);
    }

    if (response.status === 418) {
      throw new ApiError("Access code required", 418);
    }

    if (response.status === 423) {
      throw new ApiError("Access code invalid or exhausted", 423);
    }

    if (response.status === 429) {
      throw new ApiError("Rate limited", 429);
    }

    if (response.status === 404) {
      throw new ApiError("Not found", 404);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(`API error: ${response.status}`, response.status, text);
    }

    const data = (await response.json()) as T;
    return { response, data };
  }

  private requireAuth(): void {
    if (!this.authState) {
      throw new Error("Not authenticated. Call authenticate() first.");
    }
  }
}
