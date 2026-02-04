import { describe, it, expect, vi, beforeEach } from "vitest";
import { HybridClient } from "../../src/sdk/api/hybrid.js";
import type { Exchange } from "../../src/sdk/contracts/Exchange.js";
import type { PerplApiClient } from "../../src/sdk/api/client.js";

describe("HybridClient", () => {
  let mockExchange: Partial<Exchange>;
  let mockApiClient: Partial<PerplApiClient>;

  beforeEach(() => {
    mockExchange = {
      getOpenOrders: vi.fn().mockResolvedValue([
        {
          orderId: 14n,
          accountId: 272,
          orderType: 0,
          priceONS: 75000000000000,
          lotLNS: 10000000000n,
          leverageHdths: 300,
        },
      ]),
      getPosition: vi.fn().mockResolvedValue({
        position: { lotLNS: 0n },
        markPrice: 75000000000000n,
        markPriceValid: true,
      }),
      getPerpetualInfo: vi.fn().mockResolvedValue({
        perpId: 16n,
        symbol: "BTC",
        priceDecimals: 18n,
        lotDecimals: 8n,
        markPNS: 75000000000000n,
      }),
      getAccountByAddress: vi.fn().mockResolvedValue({
        accountId: 272n,
        balanceCNS: 5000000000n,
      }),
    };

    mockApiClient = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getOrderHistory: vi.fn().mockResolvedValue({
        d: [
          {
            oid: 10631381024, // API order ID (incompatible with contract)
            mkt: 16,
            acc: 272,
            st: 2, // Open
            t: 1,
            p: 75000000000000,
            os: 10000000000,
            lv: 300,
          },
        ],
      }),
    };
  });

  describe("getOpenOrders", () => {
    it("always uses contract for order IDs, never API", async () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: true,
      });

      const orders = await client.getOpenOrders(16n, 272n);

      // Should use contract, not API
      expect(mockExchange.getOpenOrders).toHaveBeenCalledWith(16n, 272n);
      expect(mockApiClient.getOrderHistory).not.toHaveBeenCalled();

      // Should return contract order ID (14), not API order ID (10631381024)
      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe(14n);
    });

    it("returns contract order IDs even when API is enabled", async () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: true,
      });

      const orders = await client.getOpenOrders(32n, 272n);

      // Verify contract was called, not API
      expect(mockExchange.getOpenOrders).toHaveBeenCalled();
      expect(mockApiClient.getOrderHistory).not.toHaveBeenCalled();
    });

    it("works without API client configured", async () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        useApi: false,
      });

      const orders = await client.getOpenOrders(16n, 272n);

      expect(mockExchange.getOpenOrders).toHaveBeenCalledWith(16n, 272n);
      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe(14n);
    });
  });

  describe("getAllOpenOrders", () => {
    it("returns empty array and warns (not supported)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: true,
      });

      const orders = await client.getAllOpenOrders(272n);

      expect(orders).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("getAllOpenOrders not supported")
      );

      warnSpy.mockRestore();
    });
  });

  describe("isApiEnabled", () => {
    it("returns true when API client is configured and useApi is true", () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: true,
      });

      expect(client.isApiEnabled()).toBe(true);
    });

    it("returns false when useApi is false", () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: false,
      });

      expect(client.isApiEnabled()).toBe(false);
    });

    it("returns false when no API client configured", () => {
      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        useApi: true,
      });

      expect(client.isApiEnabled()).toBe(false);
    });
  });

  describe("execOrder", () => {
    it("always uses contract for order execution", async () => {
      mockExchange.execOrder = vi.fn().mockResolvedValue("0xabc123");

      const client = new HybridClient({
        exchange: mockExchange as Exchange,
        apiClient: mockApiClient as PerplApiClient,
        useApi: true,
      });

      const orderDesc = {
        orderDescId: 0n,
        perpId: 16n,
        orderType: 4, // Cancel
        orderId: 14n, // Contract order ID
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
      };

      const txHash = await client.execOrder(orderDesc);

      expect(mockExchange.execOrder).toHaveBeenCalledWith(orderDesc);
      expect(txHash).toBe("0xabc123");
    });
  });
});
