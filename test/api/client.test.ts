import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PerplApiClient, ApiError } from "../../src/sdk/api/client.js";
import type { ApiConfig } from "../../src/sdk/api/types.js";

const mockConfig: ApiConfig = {
  baseUrl: "https://testnet.perpl.xyz/api",
  wsUrl: "wss://testnet.perpl.xyz",
  chainId: 10143,
};

describe("PerplApiClient", () => {
  let client: PerplApiClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new PerplApiClient(mockConfig);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates client with config", () => {
      expect(client).toBeDefined();
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe("getContext", () => {
    it("fetches public context", async () => {
      const mockResponse = {
        chain: { chain_id: 10143, name: "Monad Testnet" },
        markets: [{ id: 16, symbol: "BTC" }],
        tokens: [],
        instances: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getContext();

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://testnet.perpl.xyz/api/v1/pub/context",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("getCandles", () => {
    it("fetches candles with correct URL", async () => {
      const mockCandles = {
        mt: 11,
        at: { b: 1000, t: Date.now() },
        r: 3600,
        d: [{ t: Date.now(), o: 100, c: 101, h: 102, l: 99, v: "1000", n: 10 }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockCandles),
      });

      const from = 1700000000000;
      const to = 1700003600000;
      const result = await client.getCandles(16, 3600, from, to);

      expect(result).toEqual(mockCandles);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://testnet.perpl.xyz/api/v1/market-data/16/candles/3600/${from}-${to}`,
        expect.any(Object)
      );
    });
  });

  describe("authenticate", () => {
    it("completes auth flow successfully", async () => {
      const mockPayload = {
        message: "Sign this message",
        nonce: "random-nonce",
        issued_at: Date.now(),
        mac: "mac-value",
      };

      const mockAuth = {
        nonce: "session-nonce-123",
      };

      const mockHeaders = new Headers();
      mockHeaders.append("Set-Cookie", "jwt=token123; Path=/");

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPayload),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockAuth),
          headers: {
            getSetCookie: () => ["jwt=token123; Path=/"],
          },
        });

      const signMessage = vi.fn().mockResolvedValue("0xsignature");

      const nonce = await client.authenticate("0x1234", signMessage);

      expect(signMessage).toHaveBeenCalledWith("Sign this message");
      expect(nonce).toBe("session-nonce-123");
      expect(client.isAuthenticated()).toBe(true);
      expect(client.getAuthNonce()).toBe("session-nonce-123");
    });

    it("handles 418 access code required", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            message: "Sign",
            nonce: "n",
            issued_at: 1,
            mac: "m",
          }),
      }).mockResolvedValueOnce({
        ok: false,
        status: 418,
      });

      const signMessage = vi.fn().mockResolvedValue("0xsig");

      await expect(client.authenticate("0x1234", signMessage)).rejects.toThrow(
        "Access code required"
      );
    });
  });

  describe("authenticated endpoints", () => {
    beforeEach(async () => {
      // Set up authenticated client
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              message: "Sign",
              nonce: "n",
              issued_at: 1,
              mac: "m",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ nonce: "auth-nonce" }),
          headers: { getSetCookie: () => ["jwt=tok"] },
        });

      await client.authenticate("0x1234", () => Promise.resolve("0xsig"));
    });

    it("getFills includes auth headers", async () => {
      const mockFills = {
        d: [{ mkt: 16, acc: 1, oid: 100, t: 1, l: 2, s: 1000, f: "100" }],
        np: "",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockFills),
      });

      await client.getFills();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/trading/fills"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Auth-Nonce": "auth-nonce",
          }),
        })
      );
    });

    it("getAccountHistory paginates correctly", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ d: [], np: "cursor123" }),
      });

      await client.getAccountHistory("prev-cursor", 100);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://testnet.perpl.xyz/api/v1/trading/account-history?count=100&page=prev-cursor",
        expect.any(Object)
      );
    });

    it("getPositionHistory works", async () => {
      const mockPositions = {
        d: [{ mkt: 16, acc: 1, pid: 100, st: 1, sd: 1, s: 1000 }],
        np: "",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPositions),
      });

      const result = await client.getPositionHistory();
      expect(result.d).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("throws ApiError on 401 and clears auth", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(client.getContext()).rejects.toThrow(ApiError);
      await expect(client.getContext()).rejects.toThrow("Unauthorized");
    });

    it("throws ApiError on 429 rate limit", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      await expect(client.getContext()).rejects.toThrow("Rate limited");
    });

    it("throws ApiError on 404", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(client.getContext()).rejects.toThrow("Not found");
    });

    it("throws on unauthenticated access to protected endpoint", async () => {
      await expect(client.getFills()).rejects.toThrow(
        "Not authenticated"
      );
    });
  });

  describe("clearAuth", () => {
    it("clears authentication state", async () => {
      // Authenticate first
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ message: "S", nonce: "n", issued_at: 1, mac: "m" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: "auth" }),
          headers: { getSetCookie: () => [] },
        });

      await client.authenticate("0x1", () => Promise.resolve("0x"));
      expect(client.isAuthenticated()).toBe(true);

      client.clearAuth();
      expect(client.isAuthenticated()).toBe(false);
      expect(client.getAuthNonce()).toBeNull();
    });
  });

  describe("getAllFills", () => {
    it("auto-paginates through all pages", async () => {
      // Set up authenticated client
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ message: "S", nonce: "n", issued_at: 1, mac: "m" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: "auth" }),
          headers: { getSetCookie: () => [] },
        })
        // Page 1
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              d: [{ mkt: 16 }, { mkt: 16 }],
              np: "page2",
            }),
        })
        // Page 2
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              d: [{ mkt: 16 }],
              np: "", // No more pages
            }),
        });

      await client.authenticate("0x1", () => Promise.resolve("0x"));
      const fills = await client.getAllFills();

      expect(fills).toHaveLength(3);
    });

    it("respects maxPages limit", async () => {
      // Set up authenticated client
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ message: "S", nonce: "n", issued_at: 1, mac: "m" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: "auth" }),
          headers: { getSetCookie: () => [] },
        })
        // Always return a next page
        .mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              d: [{ mkt: 16 }],
              np: "next",
            }),
        });

      await client.authenticate("0x1", () => Promise.resolve("0x"));
      const fills = await client.getAllFills(2); // Max 2 pages

      expect(fills).toHaveLength(2);
    });
  });
});
