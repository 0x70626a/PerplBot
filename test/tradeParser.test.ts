/**
 * Tests for natural language parser (/perpl-type skill)
 */

import { describe, it, expect } from "vitest";
import {
  parseCommand,
  parseTrade,
  buildCommand,
  formatTrade,
  ParsedTrade,
} from "../src/cli/tradeParser.js";

describe("parseCommand", () => {
  describe("Status Commands", () => {
    it("parses 'show me my account'", () => {
      const result = parseCommand("show me my account");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage status");
      expect(result.parsed?.type).toBe("status");
    });

    it("parses 'what is my balance'", () => {
      const result = parseCommand("what is my balance");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage status");
    });

    it("parses 'show my positions'", () => {
      const result = parseCommand("show my positions");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage status");
    });

    it("parses 'account info'", () => {
      const result = parseCommand("account info");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage status");
    });

    it("parses 'portfolio'", () => {
      const result = parseCommand("portfolio");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage status");
    });
  });

  describe("Markets Commands", () => {
    it("parses 'show markets'", () => {
      const result = parseCommand("show markets");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage markets");
      expect(result.parsed?.type).toBe("markets");
    });

    it("parses 'what are the prices'", () => {
      const result = parseCommand("what are the prices");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage markets");
    });

    it("parses 'show funding rates'", () => {
      const result = parseCommand("show funding rates");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage markets");
    });

    it("parses 'list markets'", () => {
      const result = parseCommand("list markets");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage markets");
    });
  });

  describe("Order Book Commands", () => {
    it("parses 'show btc order book'", () => {
      const result = parseCommand("show btc order book");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show book --perp btc");
      expect(result.parsed?.type).toBe("book");
      expect(result.parsed?.market).toBe("btc");
    });

    it("parses 'eth orderbook'", () => {
      const result = parseCommand("eth orderbook");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show book --perp eth");
    });

    it("parses 'show sol depth'", () => {
      const result = parseCommand("show sol depth");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show book --perp sol");
    });

    it("parses 'bitcoin book'", () => {
      const result = parseCommand("bitcoin book");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show book --perp btc");
    });

    it("returns error when market not specified", () => {
      const result = parseCommand("show order book");
      expect(result.success).toBe(false);
      expect(result.error).toContain("specify a market");
    });
  });

  describe("Recent Trades Commands", () => {
    it("parses 'recent btc trades'", () => {
      const result = parseCommand("recent btc trades");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show trades --perp btc");
      expect(result.parsed?.type).toBe("trades");
    });

    it("parses 'show eth trades'", () => {
      const result = parseCommand("show eth trades");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show trades --perp eth");
    });

    it("parses 'solana trade history'", () => {
      const result = parseCommand("solana trade history");
      expect(result.success).toBe(true);
      expect(result.command).toBe("show trades --perp sol");
    });
  });

  describe("Deposit Commands", () => {
    it("parses 'deposit 100'", () => {
      const result = parseCommand("deposit 100");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage deposit --amount 100");
      expect(result.parsed?.type).toBe("deposit");
      expect(result.parsed?.amount).toBe(100);
    });

    it("parses 'deposit 50.5 usd'", () => {
      const result = parseCommand("deposit 50.5 usd");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage deposit --amount 50.5");
    });

    it("returns error when amount not specified", () => {
      const result = parseCommand("deposit");
      expect(result.success).toBe(false);
      expect(result.error).toContain("specify an amount");
    });
  });

  describe("Withdraw Commands", () => {
    it("parses 'withdraw 100'", () => {
      const result = parseCommand("withdraw 100");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage withdraw --amount 100");
      expect(result.parsed?.type).toBe("withdraw");
      expect(result.parsed?.amount).toBe(100);
    });

    it("parses 'withdrawal 25'", () => {
      const result = parseCommand("withdrawal 25");
      expect(result.success).toBe(true);
      expect(result.command).toBe("manage withdraw --amount 25");
    });
  });

  describe("Cancel All Orders Commands", () => {
    it("parses 'cancel all btc orders'", () => {
      const result = parseCommand("cancel all btc orders");
      expect(result.success).toBe(true);
      expect(result.command).toBe("trade cancel-all --perp btc");
      expect(result.parsed?.type).toBe("cancel-all");
      expect(result.parsed?.market).toBe("btc");
    });

    it("parses 'cancel-all eth'", () => {
      const result = parseCommand("cancel-all eth");
      expect(result.success).toBe(true);
      expect(result.command).toBe("trade cancel-all --perp eth");
    });
  });

  describe("Cancel Single Order Commands", () => {
    it("parses 'cancel btc order 123'", () => {
      const result = parseCommand("cancel btc order 123");
      expect(result.success).toBe(true);
      expect(result.command).toBe("trade cancel --perp btc --order-id 123");
      expect(result.parsed?.type).toBe("cancel");
      expect(result.parsed?.orderId).toBe("123");
    });

    it("parses 'cancel my order #456 on eth'", () => {
      const result = parseCommand("cancel my order #456 on eth");
      expect(result.success).toBe(true);
      expect(result.command).toBe("trade cancel --perp eth --order-id 456");
    });
  });

  describe("Falls Back to Trade Parsing", () => {
    it("parses trade when no query command matches", () => {
      const result = parseCommand("long 0.01 btc at 78000 5x");
      expect(result.success).toBe(true);
      expect(result.command).toBe("trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5");
      expect(result.trade).toBeDefined();
    });
  });
});

describe("parseTrade", () => {
  describe("Basic Open Long Orders", () => {
    it("parses 'long 0.01 btc at 78000 with 5x leverage'", () => {
      const result = parseTrade("long 0.01 btc at 78000 with 5x leverage");

      expect(result.success).toBe(true);
      expect(result.trade).toEqual({
        action: "open",
        market: "btc",
        side: "long",
        size: 0.01,
        sizeIsUsd: false,
        price: 78000,
        leverage: 5,
        options: { ioc: false, postOnly: false },
      });
    });

    it("parses 'buy 1 eth at 2500 10x'", () => {
      const result = parseTrade("buy 1 eth at 2500 10x");

      expect(result.success).toBe(true);
      expect(result.trade?.action).toBe("open");
      expect(result.trade?.market).toBe("eth");
      expect(result.trade?.side).toBe("long");
      expect(result.trade?.size).toBe(1);
      expect(result.trade?.price).toBe(2500);
      expect(result.trade?.leverage).toBe(10);
    });

    it("parses 'go long 10 sol at $105 with 3x leverage'", () => {
      const result = parseTrade("go long 10 sol at $105 with 3x leverage");

      expect(result.success).toBe(true);
      expect(result.trade?.market).toBe("sol");
      expect(result.trade?.side).toBe("long");
      expect(result.trade?.size).toBe(10);
      expect(result.trade?.price).toBe(105);
      expect(result.trade?.leverage).toBe(3);
    });

    it("defaults leverage to 1 if not specified", () => {
      const result = parseTrade("long 0.1 btc at 75000");

      expect(result.success).toBe(true);
      expect(result.trade?.leverage).toBe(1);
    });
  });

  describe("Basic Open Short Orders", () => {
    it("parses 'short 0.5 btc at 80000 5x'", () => {
      const result = parseTrade("short 0.5 btc at 80000 5x");

      expect(result.success).toBe(true);
      expect(result.trade?.action).toBe("open");
      expect(result.trade?.side).toBe("short");
      expect(result.trade?.size).toBe(0.5);
      expect(result.trade?.price).toBe(80000);
      expect(result.trade?.leverage).toBe(5);
    });

    it("parses 'sell 2 eth at 3000 with 2x leverage'", () => {
      const result = parseTrade("sell 2 eth at 3000 with 2x leverage");

      expect(result.success).toBe(true);
      expect(result.trade?.side).toBe("short");
      expect(result.trade?.market).toBe("eth");
    });

    it("parses 'go short 100 mon at 0.02 10x'", () => {
      const result = parseTrade("go short 100 mon at 0.02 10x");

      expect(result.success).toBe(true);
      expect(result.trade?.market).toBe("mon");
      expect(result.trade?.side).toBe("short");
      expect(result.trade?.size).toBe(100);
      expect(result.trade?.price).toBe(0.02);
    });
  });

  describe("Close Orders", () => {
    it("parses 'close my btc long 0.01 at 80000'", () => {
      const result = parseTrade("close my btc long 0.01 at 80000");

      expect(result.success).toBe(true);
      expect(result.trade?.action).toBe("close");
      expect(result.trade?.side).toBe("long");
      expect(result.trade?.market).toBe("btc");
      expect(result.trade?.size).toBe(0.01);
      expect(result.trade?.price).toBe(80000);
    });

    it("parses 'exit short 1 eth at 2200'", () => {
      const result = parseTrade("exit short 1 eth at 2200");

      expect(result.success).toBe(true);
      expect(result.trade?.action).toBe("close");
      expect(result.trade?.side).toBe("short");
    });

    it("parses 'close out sol long 5 at 110'", () => {
      const result = parseTrade("close out sol long 5 at 110");

      expect(result.success).toBe(true);
      expect(result.trade?.action).toBe("close");
      expect(result.trade?.market).toBe("sol");
    });
  });

  describe("Market Orders", () => {
    it("parses 'long 0.1 btc at market'", () => {
      const result = parseTrade("long 0.1 btc at market");

      expect(result.success).toBe(true);
      expect(result.trade?.price).toBe("market");
      expect(result.trade?.options.ioc).toBe(true);
    });

    it("parses 'buy 1 eth market order 5x'", () => {
      const result = parseTrade("buy 1 eth market order 5x");

      expect(result.success).toBe(true);
      expect(result.trade?.price).toBe("market");
      expect(result.trade?.options.ioc).toBe(true);
      expect(result.trade?.leverage).toBe(5);
    });

    it("parses 'short 0.5 btc immediately 10x'", () => {
      const result = parseTrade("short 0.5 btc immediately 10x");

      expect(result.success).toBe(true);
      expect(result.trade?.price).toBe("market");
      expect(result.trade?.options.ioc).toBe(true);
    });
  });

  describe("Post-Only Orders", () => {
    it("parses 'long 0.1 btc at 75000 5x maker only'", () => {
      const result = parseTrade("long 0.1 btc at 75000 5x maker only");

      expect(result.success).toBe(true);
      expect(result.trade?.options.postOnly).toBe(true);
      expect(result.trade?.options.ioc).toBe(false);
    });

    it("parses 'short 1 eth at 2800 post-only 3x'", () => {
      const result = parseTrade("short 1 eth at 2800 post-only 3x");

      expect(result.success).toBe(true);
      expect(result.trade?.options.postOnly).toBe(true);
    });
  });

  describe("Market Aliases", () => {
    it("recognizes 'bitcoin' as btc", () => {
      const result = parseTrade("long 0.1 bitcoin at 78000 5x");
      expect(result.trade?.market).toBe("btc");
    });

    it("recognizes 'ethereum' as eth", () => {
      const result = parseTrade("long 1 ethereum at 2500 5x");
      expect(result.trade?.market).toBe("eth");
    });

    it("recognizes 'solana' as sol", () => {
      const result = parseTrade("short 10 solana at 110 3x");
      expect(result.trade?.market).toBe("sol");
    });

    it("recognizes 'monad' as mon", () => {
      const result = parseTrade("long 1000 monad at 0.02 10x");
      expect(result.trade?.market).toBe("mon");
    });

    it("recognizes 'zcash' as zec", () => {
      const result = parseTrade("short 5 zcash at 300 2x");
      expect(result.trade?.market).toBe("zec");
    });
  });

  describe("Price Formats", () => {
    it("handles price with dollar sign", () => {
      const result = parseTrade("long 0.1 btc at $78000 5x");
      expect(result.trade?.price).toBe(78000);
    });

    it("handles price without dollar sign", () => {
      const result = parseTrade("long 0.1 btc at 78000 5x");
      expect(result.trade?.price).toBe(78000);
    });

    it("handles @ symbol", () => {
      const result = parseTrade("long 0.1 btc @ 78000 5x");
      expect(result.trade?.price).toBe(78000);
    });

    it("handles decimal prices", () => {
      const result = parseTrade("long 1000 mon at 0.025 5x");
      expect(result.trade?.price).toBe(0.025);
    });
  });

  describe("Leverage Formats", () => {
    it("handles Xx format", () => {
      const result = parseTrade("long 0.1 btc at 78000 10x");
      expect(result.trade?.leverage).toBe(10);
    });

    it("handles Xx leverage format", () => {
      const result = parseTrade("long 0.1 btc at 78000 10x leverage");
      expect(result.trade?.leverage).toBe(10);
    });

    it("handles 'with Xx' format", () => {
      const result = parseTrade("long 0.1 btc at 78000 with 10x");
      expect(result.trade?.leverage).toBe(10);
    });

    it("handles 'leverage X' format", () => {
      const result = parseTrade("long 0.1 btc at 78000 leverage 10");
      expect(result.trade?.leverage).toBe(10);
    });

    it("handles fractional leverage", () => {
      const result = parseTrade("long 0.1 btc at 78000 1.5x");
      expect(result.trade?.leverage).toBe(1.5);
    });
  });

  describe("Size Extraction", () => {
    it("extracts size before market name", () => {
      const result = parseTrade("long 0.001 btc at 78000 5x");
      expect(result.trade?.size).toBe(0.001);
    });

    it("extracts small decimal sizes", () => {
      const result = parseTrade("long 0.00001 btc at 78000 5x");
      expect(result.trade?.size).toBe(0.00001);
    });

    it("extracts whole number sizes", () => {
      const result = parseTrade("long 100 sol at 105 5x");
      expect(result.trade?.size).toBe(100);
    });

    it("extracts large sizes", () => {
      const result = parseTrade("long 10000 mon at 0.02 5x");
      expect(result.trade?.size).toBe(10000);
    });
  });

  describe("Error Cases", () => {
    it("returns error for empty input", () => {
      const result = parseTrade("");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Empty input");
    });

    it("returns error when side is ambiguous", () => {
      const result = parseTrade("long short 0.1 btc at 78000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Ambiguous side");
    });

    it("returns error when side is missing", () => {
      const result = parseTrade("0.1 btc at 78000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not determine side");
    });

    it("returns error when market is missing", () => {
      const result = parseTrade("long 0.1 at 78000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not determine market");
    });

    it("returns error when size is missing", () => {
      const result = parseTrade("long btc at 78000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not determine trade size");
    });

    it("returns error when price is missing", () => {
      const result = parseTrade("long 0.1 btc 5x");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not determine price");
    });
  });

  describe("Case Insensitivity", () => {
    it("handles uppercase input", () => {
      const result = parseTrade("LONG 0.1 BTC AT 78000 5X");
      expect(result.success).toBe(true);
      expect(result.trade?.market).toBe("btc");
    });

    it("handles mixed case input", () => {
      const result = parseTrade("Long 0.1 Btc At 78000 5x");
      expect(result.success).toBe(true);
    });
  });
});

describe("buildCommand", () => {
  it("builds open long command", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "btc",
      side: "long",
      size: 0.01,
      price: 78000,
      leverage: 5,
      options: { ioc: false, postOnly: false },
    };

    const command = buildCommand(trade);
    expect(command).toBe("trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5");
  });

  it("builds open short command with IOC", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "eth",
      side: "short",
      size: 1,
      price: "market",
      leverage: 10,
      options: { ioc: true, postOnly: false },
    };

    const command = buildCommand(trade);
    expect(command).toBe("trade open --perp eth --side short --size 1 --price MARKET_PRICE --leverage 10 --ioc");
  });

  it("builds close command", () => {
    const trade: ParsedTrade = {
      action: "close",
      market: "btc",
      side: "long",
      size: 0.01,
      price: 80000,
      options: { ioc: false, postOnly: false },
    };

    const command = buildCommand(trade);
    expect(command).toBe("trade close --perp btc --side long --size 0.01 --price 80000");
  });

  it("builds command with post-only flag", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "sol",
      side: "long",
      size: 10,
      price: 105,
      leverage: 3,
      options: { ioc: false, postOnly: true },
    };

    const command = buildCommand(trade);
    expect(command).toContain("--post-only");
  });

  it("does not include leverage for close orders", () => {
    const trade: ParsedTrade = {
      action: "close",
      market: "btc",
      side: "long",
      size: 0.01,
      price: 80000,
      leverage: 5, // Should be ignored
      options: { ioc: false, postOnly: false },
    };

    const command = buildCommand(trade);
    expect(command).not.toContain("--leverage");
  });
});

describe("formatTrade", () => {
  it("formats open long trade", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "btc",
      side: "long",
      size: 0.01,
      price: 78000,
      leverage: 5,
      options: { ioc: false, postOnly: false },
    };

    const formatted = formatTrade(trade);
    expect(formatted).toBe("OPEN LONG 0.01 BTC @ $78,000 (5x leverage)");
  });

  it("formats market order", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "eth",
      side: "short",
      size: 1,
      price: "market",
      leverage: 10,
      options: { ioc: true, postOnly: false },
    };

    const formatted = formatTrade(trade);
    expect(formatted).toBe("OPEN SHORT 1 ETH @ MARKET (10x leverage) [IOC]");
  });

  it("formats close order", () => {
    const trade: ParsedTrade = {
      action: "close",
      market: "sol",
      side: "long",
      size: 5,
      price: 110,
      options: { ioc: false, postOnly: false },
    };

    const formatted = formatTrade(trade);
    expect(formatted).toBe("CLOSE LONG 5 SOL @ $110");
  });

  it("formats post-only order", () => {
    const trade: ParsedTrade = {
      action: "open",
      market: "btc",
      side: "long",
      size: 0.1,
      price: 75000,
      leverage: 5,
      options: { ioc: false, postOnly: true },
    };

    const formatted = formatTrade(trade);
    expect(formatted).toContain("[POST-ONLY]");
  });
});

describe("End-to-End Parsing and Command Building", () => {
  const testCases = [
    {
      input: "long 0.01 btc at 78000 with 5x leverage",
      expectedCommand: "trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5",
    },
    {
      input: "short 1 eth at market 10x",
      expectedCommand: "trade open --perp eth --side short --size 1 --price MARKET_PRICE --leverage 10 --ioc",
    },
    {
      input: "close my btc long 0.001 at 80000",
      expectedCommand: "trade close --perp btc --side long --size 0.001 --price 80000",
    },
    {
      input: "buy 10 sol at 105 3x maker only",
      expectedCommand: "trade open --perp sol --side long --size 10 --price 105 --leverage 3 --post-only",
    },
    {
      input: "sell 100 mon at 0.025 5x",
      expectedCommand: "trade open --perp mon --side short --size 100 --price 0.025 --leverage 5",
    },
    {
      input: "exit short 2 zec at 290",
      expectedCommand: "trade close --perp zec --side short --size 2 --price 290",
    },
  ];

  testCases.forEach(({ input, expectedCommand }) => {
    it(`parses "${input}" to correct command`, () => {
      const result = parseTrade(input);
      expect(result.success).toBe(true);
      expect(result.command).toBe(expectedCommand);
    });
  });
});
