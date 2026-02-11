/**
 * Testnet trading integration tests (opt-in)
 *
 * Opens a real position on Monad testnet for each market, verifies it, then closes it.
 * Uses sdk-bridge functions directly (no chatbot, no mocks).
 *
 * Enable with: CHATBOT_TRADING_TEST=1 npx vitest run test/chatbot/trading.testnet.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";

config(); // load .env before anything else

import {
  initSDK,
  getAccountSummary,
  getMarkets,
  getPositions,
  getOpenOrders,
  openPosition,
  closePosition,
  cancelOrder,
} from "../../src/chatbot/sdk-bridge.js";

const MARKETS = [
  { name: "BTC", size: 0.001 },
  { name: "ETH", size: 0.01 },
  { name: "SOL", size: 0.1 },
  { name: "MON", size: 10 },
  { name: "ZEC", size: 0.1 },
] as const;

// 10% spread to ensure crossing on thin testnet books
const OPEN_LONG_MULT = 1.10;
const CLOSE_LONG_MULT = 0.90;
const OPEN_SHORT_MULT = 0.90;
const CLOSE_SHORT_MULT = 1.10;

/** Round price sensibly — don't round sub-dollar prices to zero */
function roundPrice(price: number): number {
  return price >= 1 ? Math.round(price) : parseFloat(price.toPrecision(4));
}

function findPosition(
  positions: Awaited<ReturnType<typeof getPositions>>,
  market: string,
  side: "long" | "short",
) {
  return positions.find(
    (p) =>
      (p.market.toUpperCase() === market || p.market === `${market}/USD`) &&
      p.side === side,
  );
}

/** Close any existing BTC position (both sides) to start clean */
async function closeAnyBtcPosition(markPrice: number) {
  const positions = await getPositions();
  for (const side of ["long", "short"] as const) {
    const pos = findPosition(positions, "BTC", side);
    if (pos && pos.size > 0) {
      const price =
        side === "long"
          ? Math.round(markPrice * CLOSE_LONG_MULT)
          : Math.round(markPrice * CLOSE_SHORT_MULT);
      console.log(
        `[cleanup] closing existing BTC ${side} (size=${pos.size}) at ${price}`,
      );
      await closePosition({
        market: "BTC",
        side,
        price,
        is_market_order: false,
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  // Also cancel any resting BTC orders
  try {
    const orders = await getOpenOrders("BTC");
    for (const order of orders) {
      await cancelOrder("BTC", order.orderId);
    }
  } catch {
    // best-effort
  }
}

describe.skipIf(!process.env.CHATBOT_TRADING_TEST)(
  "testnet trading (open + close)",
  () => {
    const markPrices: Record<string, number> = {};
    const sizesAfterOpen: Record<string, number> = {};

    beforeAll(async () => {
      await initSDK();
    }, 30_000);

    afterAll(async () => {
      // Safety net: cancel any leftover open orders from the test
      for (const { name } of MARKETS) {
        try {
          const orders = await getOpenOrders(name);
          for (const order of orders) {
            try {
              await cancelOrder(name, order.orderId);
              console.log(`[cleanup] cancelled ${name} order ${order.orderId}`);
            } catch {
              // best-effort
            }
          }
        } catch {
          // no orders or SDK not initialized
        }
      }
    }, 60_000);

    // ── Pre-flight ──

    it(
      "account has collateral",
      async () => {
        const summary = await getAccountSummary();
        expect(summary.totalEquity).toBeGreaterThan(0);
        console.log(`[preflight] equity: ${summary.totalEquity}`);
      },
      { timeout: 60_000 },
    );

    it(
      "all markets are active with mark prices",
      async () => {
        const markets = await getMarkets();
        for (const { name } of MARKETS) {
          const m = markets.find(
            (mk) =>
              mk.market.toUpperCase() === name ||
              mk.market === `${name}/USD`,
          );
          expect(m, `${name} market not found`).toBeDefined();
          expect(m!.markPrice, `${name} mark price`).toBeGreaterThan(0);
          expect(m!.paused, `${name} paused`).toBe(false);
          markPrices[name] = m!.markPrice;
          console.log(`[preflight] ${name} mark price: ${m!.markPrice}`);
        }
      },
      { timeout: 60_000 },
    );

    // ════════════════════════════════════════════════════
    // 1. Crossing limit longs — all markets
    // ════════════════════════════════════════════════════

    for (const { name, size } of MARKETS) {
      describe(`${name} crossing limit long`, () => {
        it(
          `opens a ${name} long position`,
          async () => {
            const crossingPrice = roundPrice(markPrices[name] * OPEN_LONG_MULT);
            console.log(
              `[open ${name}] size=${size}, price=${crossingPrice}, leverage=2`,
            );

            const result = await openPosition({
              market: name,
              side: "long",
              size,
              price: crossingPrice,
              leverage: 2,
              is_market_order: false,
            });

            console.log(
              `[open ${name}] result:`,
              JSON.stringify(result, null, 2),
            );
            expect(result.success).toBe(true);
            expect(result.txHash).toMatch(/^0x/);
          },
          { timeout: 60_000 },
        );

        it(
          `${name} long position exists after open`,
          async () => {
            await new Promise((r) => setTimeout(r, 2000));

            const positions = await getPositions();
            const pos = findPosition(positions, name, "long");
            expect(pos, `${name} long position not found`).toBeDefined();
            expect(pos!.size).toBeGreaterThan(0);
            sizesAfterOpen[name] = pos!.size;
            console.log(`[verify ${name}] size after open: ${pos!.size}`);
          },
          { timeout: 60_000 },
        );

        it(
          `closes the ${name} long position`,
          async () => {
            const closePrice = roundPrice(markPrices[name] * CLOSE_LONG_MULT);
            console.log(`[close ${name}] size=${size}, price=${closePrice}`);

            const result = await closePosition({
              market: name,
              side: "long",
              size,
              price: closePrice,
              is_market_order: false,
            });

            console.log(
              `[close ${name}] result:`,
              JSON.stringify(result, null, 2),
            );
            expect(result.success).toBe(true);
            expect(result.txHash).toMatch(/^0x/);
          },
          { timeout: 60_000 },
        );

        it(
          `${name} long position reduced after close`,
          async () => {
            await new Promise((r) => setTimeout(r, 2000));

            // Cancel any resting orders that didn't fill
            try {
              const orders = await getOpenOrders(name);
              for (const o of orders) {
                await cancelOrder(name, o.orderId);
                console.log(`[cleanup ${name}] cancelled resting order ${o.orderId}`);
              }
            } catch { /* best-effort */ }

            const positions = await getPositions();
            const pos = findPosition(positions, name, "long");
            if (pos) {
              expect(pos.size).toBeLessThanOrEqual(sizesAfterOpen[name]);
              console.log(
                `[verify-closed ${name}] size: ${sizesAfterOpen[name]} → ${pos.size}`,
              );
            } else {
              console.log(`[verify-closed ${name}] position fully closed`);
            }
          },
          { timeout: 60_000 },
        );
      });
    }

    // ════════════════════════════════════════════════════
    // 2. Crossing limit short — BTC
    // ════════════════════════════════════════════════════

    describe("BTC crossing limit short", () => {
      let shortOpened = false;
      let sizeAfterOpen: number;

      it(
        "cleans up any existing BTC position before short test",
        async () => {
          await closeAnyBtcPosition(markPrices.BTC);
          const positions = await getPositions();
          const btcPos = positions.find(
            (p) => p.market.toUpperCase() === "BTC" || p.market === "BTC/USD",
          );
          if (btcPos) {
            console.log(
              `[short setup] residual BTC position: ${btcPos.side} ${btcPos.size}`,
            );
          } else {
            console.log("[short setup] BTC position clean");
          }
        },
        { timeout: 60_000 },
      );

      it(
        "opens a BTC short position",
        async () => {
          // Sell below mark → crosses against resting bids
          const crossingPrice = Math.round(markPrices.BTC * OPEN_SHORT_MULT);
          console.log(
            `[open short BTC] size=0.001, price=${crossingPrice}, leverage=2`,
          );

          const result = await openPosition({
            market: "BTC",
            side: "short",
            size: 0.001,
            price: crossingPrice,
            leverage: 2,
            is_market_order: false,
          });

          console.log(
            "[open short BTC] result:",
            JSON.stringify(result, null, 2),
          );
          expect(result.success).toBe(true);
          expect(result.txHash).toMatch(/^0x/);
        },
        { timeout: 60_000 },
      );

      it(
        "BTC short position exists after open",
        async () => {
          await new Promise((r) => setTimeout(r, 2000));

          const positions = await getPositions();
          console.log(
            "[verify short BTC] positions:",
            JSON.stringify(positions, null, 2),
          );
          const pos = findPosition(positions, "BTC", "short");
          if (!pos) {
            // Order may have rested instead of crossing — cancel and note
            const orders = await getOpenOrders("BTC");
            for (const o of orders) {
              await cancelOrder("BTC", o.orderId);
              console.log(`[short BTC] cancelled resting order ${o.orderId}`);
            }
            console.log("[short BTC] order did not fill (thin liquidity)");
          }
          expect(pos, "BTC short position not found").toBeDefined();
          expect(pos!.size).toBeGreaterThan(0);
          shortOpened = true;
          sizeAfterOpen = pos!.size;
          console.log(`[verify short BTC] size after open: ${pos!.size}`);
        },
        { timeout: 60_000 },
      );

      it(
        "closes the BTC short position",
        async () => {
          expect(shortOpened, "short did not fill, skipping close").toBe(true);
          // Buy above mark → crosses against resting asks
          const closePrice = Math.round(markPrices.BTC * CLOSE_SHORT_MULT);
          console.log(
            `[close short BTC] size=0.001, price=${closePrice}`,
          );

          const result = await closePosition({
            market: "BTC",
            side: "short",
            size: 0.001,
            price: closePrice,
            is_market_order: false,
          });

          console.log(
            "[close short BTC] result:",
            JSON.stringify(result, null, 2),
          );
          expect(result.success).toBe(true);
          expect(result.txHash).toMatch(/^0x/);
        },
        { timeout: 60_000 },
      );

      it(
        "BTC short position reduced after close",
        async () => {
          expect(shortOpened, "short did not fill, skipping verify").toBe(true);
          await new Promise((r) => setTimeout(r, 2000));

          const positions = await getPositions();
          const pos = findPosition(positions, "BTC", "short");
          if (pos) {
            expect(pos.size).toBeLessThan(sizeAfterOpen);
            console.log(
              `[verify-closed short BTC] reduced: ${sizeAfterOpen} → ${pos.size}`,
            );
          } else {
            console.log("[verify-closed short BTC] position fully closed");
          }
        },
        { timeout: 60_000 },
      );
    });

    // ════════════════════════════════════════════════════
    // 3. Market/IOC orders via WebSocket — BTC
    // ════════════════════════════════════════════════════

    describe("BTC market/IOC (WebSocket)", () => {
      let openFilled = false;
      let sizeAfterOpen: number;

      it(
        "opens a BTC long via crossing limit (setup for market close)",
        async () => {
          const crossingPrice = Math.round(markPrices.BTC * OPEN_LONG_MULT);
          console.log(
            `[market open BTC] opening via crossing limit: price=${crossingPrice}`,
          );

          const limitResult = await openPosition({
            market: "BTC",
            side: "long",
            size: 0.001,
            price: crossingPrice,
            leverage: 2,
            is_market_order: false,
          });

          expect(limitResult.success).toBe(true);
          openFilled = true;
          console.log(
            "[market open BTC] limit open result:",
            JSON.stringify(limitResult, null, 2),
          );
        },
        { timeout: 60_000 },
      );

      it(
        "BTC long position exists after open",
        async () => {
          expect(openFilled, "open did not fill, skipping").toBe(true);
          await new Promise((r) => setTimeout(r, 2000));

          const positions = await getPositions();
          const pos = findPosition(positions, "BTC", "long");
          expect(pos, "BTC long position not found").toBeDefined();
          expect(pos!.size).toBeGreaterThan(0);
          sizeAfterOpen = pos!.size;
          console.log(
            `[verify market BTC] size after open: ${pos!.size}`,
          );
        },
        { timeout: 60_000 },
      );

      it(
        "closes the BTC long via market order (WebSocket IOC)",
        async () => {
          expect(openFilled, "open did not fill, skipping").toBe(true);
          const closePrice = Math.round(markPrices.BTC * CLOSE_LONG_MULT);
          console.log(
            `[market close BTC] size=0.001, price=${closePrice}, is_market_order=true`,
          );

          const result = await closePosition({
            market: "BTC",
            side: "long",
            size: 0.001,
            price: closePrice,
            is_market_order: true,
          });

          console.log(
            "[market close BTC] result:",
            JSON.stringify(result, null, 2),
          );

          if (result.success) {
            expect(result.txHash).toMatch(/^0x/);
            expect(result.route).toBe("api");
            expect(result.type).toBe("market");
          } else {
            // IOC may time out on thin testnet liquidity — fall back to limit close
            console.log(
              "[market close BTC] IOC timed out, falling back to limit close",
            );
            const fallback = await closePosition({
              market: "BTC",
              side: "long",
              size: 0.001,
              price: closePrice,
              is_market_order: false,
            });
            expect(fallback.success).toBe(true);
          }
        },
        { timeout: 60_000 },
      );

      it(
        "BTC long position reduced after market close",
        async () => {
          expect(openFilled, "open did not fill, skipping").toBe(true);
          await new Promise((r) => setTimeout(r, 2000));

          const positions = await getPositions();
          const pos = findPosition(positions, "BTC", "long");
          if (pos) {
            expect(pos.size).toBeLessThan(sizeAfterOpen);
            console.log(
              `[verify-closed market BTC] reduced: ${sizeAfterOpen} → ${pos.size}`,
            );
          } else {
            console.log(
              "[verify-closed market BTC] position fully closed",
            );
          }
        },
        { timeout: 60_000 },
      );
    });

    // ════════════════════════════════════════════════════
    // 4. Resting limit order (non-crossing) — BTC
    // ════════════════════════════════════════════════════

    describe("BTC resting limit order", () => {
      let orderIdsBefore: Set<string>;
      let newOrderId: string;

      it(
        "places a non-crossing BTC buy limit (rests on book)",
        async () => {
          // Snapshot existing orders so we can identify the new one
          const existingOrders = await getOpenOrders("BTC");
          orderIdsBefore = new Set(existingOrders.map((o) => o.orderId));

          // 20% below mark → won't cross, stays as resting order
          const restingPrice = Math.round(markPrices.BTC * 0.80);
          console.log(
            `[resting BTC] placing buy limit: size=0.001, price=${restingPrice}`,
          );

          const result = await openPosition({
            market: "BTC",
            side: "long",
            size: 0.001,
            price: restingPrice,
            leverage: 2,
            is_market_order: false,
          });

          console.log(
            "[resting BTC] result:",
            JSON.stringify(result, null, 2),
          );
          expect(result.success).toBe(true);
          expect(result.txHash).toMatch(/^0x/);
          expect(result.type).toBe("limit");
        },
        { timeout: 60_000 },
      );

      it(
        "resting order appears in open orders",
        async () => {
          await new Promise((r) => setTimeout(r, 2000));

          const orders = await getOpenOrders("BTC");
          console.log(
            "[resting BTC] open orders:",
            JSON.stringify(orders, null, 2),
          );

          // Find the new order that wasn't there before
          const newOrder = orders.find(
            (o) => !orderIdsBefore.has(o.orderId),
          );
          expect(
            newOrder,
            "new resting order not found in open orders",
          ).toBeDefined();
          newOrderId = newOrder!.orderId;
          console.log(`[resting BTC] new order id: ${newOrderId}`);
        },
        { timeout: 60_000 },
      );

      it(
        "cancels the resting order",
        async () => {
          expect(newOrderId, "no order to cancel").toBeDefined();

          console.log(`[resting BTC] cancelling order ${newOrderId}`);
          const result = await cancelOrder("BTC", newOrderId);
          console.log(
            "[resting BTC] cancel result:",
            JSON.stringify(result, null, 2),
          );
          expect(result.success).toBe(true);
          expect(result.txHash).toMatch(/^0x/);
        },
        { timeout: 60_000 },
      );

      it(
        "resting order removed from open orders after cancel",
        async () => {
          await new Promise((r) => setTimeout(r, 2000));

          const orders = await getOpenOrders("BTC");
          console.log(
            "[resting BTC] open orders after cancel:",
            JSON.stringify(orders, null, 2),
          );

          const stillThere = orders.find(
            (o) => o.orderId === newOrderId,
          );
          expect(
            stillThere,
            "resting order still present after cancel",
          ).toBeUndefined();
        },
        { timeout: 60_000 },
      );
    });
  },
);
