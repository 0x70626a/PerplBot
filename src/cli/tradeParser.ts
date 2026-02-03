/**
 * Natural language parser for /perpl-type skill
 * Converts plain English into CLI commands (trades, queries, account management)
 */

export type Market = "btc" | "eth" | "sol" | "mon" | "zec";

export interface ParsedTrade {
  action: "open" | "close";
  market: Market;
  side: "long" | "short";
  size: number;
  sizeIsUsd?: boolean; // true if size is in USD (e.g., "$100 of btc")
  price: number | "market";
  leverage?: number;
  options: {
    ioc: boolean;
    postOnly: boolean;
  };
}

export interface ParsedCommand {
  type: "trade" | "status" | "markets" | "book" | "trades" | "deposit" | "withdraw" | "cancel" | "cancel-all" | "close-position" | "close-all" | "orders" | "help";
  trade?: ParsedTrade;
  market?: Market;
  amount?: number;
  orderId?: string;
}

export interface ParseResult {
  success: boolean;
  trade?: ParsedTrade;
  parsed?: ParsedCommand;
  command?: string;
  description?: string;
  error?: string;
}

const MARKET_ALIASES: Record<string, Market> = {
  btc: "btc",
  bitcoin: "btc",
  eth: "eth",
  ethereum: "eth",
  sol: "sol",
  solana: "sol",
  mon: "mon",
  monad: "mon",
  zec: "zec",
  zcash: "zec",
};

const LONG_KEYWORDS = ["long", "buy", "go long", "enter long"];
const SHORT_KEYWORDS = ["short", "sell", "go short", "enter short"];
const CLOSE_KEYWORDS = ["close", "exit", "close out", "flatten"];
const MARKET_ORDER_KEYWORDS = ["at market", "market order", "market price", "immediately", "market long", "market short", "market buy", "market sell"];
const POST_ONLY_KEYWORDS = ["maker only", "post only", "post-only", "maker"];

// Command detection keywords
const STATUS_KEYWORDS = ["status", "account", "balance", "positions", "my positions", "portfolio", "account info", "show me my"];
const MARKETS_KEYWORDS = ["markets", "prices", "market prices", "funding", "all markets", "list markets"];
const BOOK_KEYWORDS = ["order book", "orderbook", "book", "depth", "bids", "asks"];
const TRADES_KEYWORDS = ["recent trades", "trades", "trade history", "last trades"];
const DEPOSIT_KEYWORDS = ["deposit"];
const WITHDRAW_KEYWORDS = ["withdraw", "withdrawal"];
const CANCEL_ALL_KEYWORDS = ["cancel all", "cancel-all"];
// Single order cancel - just needs "cancel" and an order ID (but not "cancel all")
const CANCEL_SINGLE_PATTERN = /cancel.*(?:order|#)\s*(\d+)|cancel.*(\d+)/i;
// Close all positions and orders - nuclear option
const CLOSE_ALL_KEYWORDS = ["close all", "close-all", "close everything", "flatten all", "exit all", "liquidate all"];
// Close position on specific market
const CLOSE_POSITION_KEYWORDS = ["close position", "close my position", "flatten position", "exit position"];
// View open orders
const ORDERS_KEYWORDS = ["my orders", "open orders", "show orders", "list orders", "orders"];
// Help
const HELP_KEYWORDS = ["help", "commands", "what can you do", "how to use"];

/**
 * Find a market in the input text
 */
function findMarket(text: string): Market | undefined {
  for (const [alias, market] of Object.entries(MARKET_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, "i");
    if (regex.test(text)) {
      return market;
    }
  }
  return undefined;
}

/**
 * Parse any natural language command into a CLI command
 */
export function parseCommand(input: string): ParseResult {
  const text = input.toLowerCase().trim();

  if (!text) {
    return { success: false, error: "Empty input" };
  }

  // Check for help command
  if (HELP_KEYWORDS.some((k) => text.includes(k))) {
    return {
      success: true,
      parsed: { type: "help" },
      command: "help",
      description: "Show available commands",
    };
  }

  // Check for status/account commands
  if (STATUS_KEYWORDS.some((k) => text.includes(k))) {
    return {
      success: true,
      parsed: { type: "status" },
      command: "manage status",
      description: "Show account balance and positions",
    };
  }

  // Check for markets command
  if (MARKETS_KEYWORDS.some((k) => text.includes(k)) && !BOOK_KEYWORDS.some((k) => text.includes(k))) {
    return {
      success: true,
      parsed: { type: "markets" },
      command: "manage markets",
      description: "Show all markets with prices and funding rates",
    };
  }

  // Check for order book command
  if (BOOK_KEYWORDS.some((k) => text.includes(k))) {
    const market = findMarket(text);
    if (!market) {
      return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
    }
    return {
      success: true,
      parsed: { type: "book", market },
      command: `show book --perp ${market}`,
      description: `Show ${market.toUpperCase()} order book`,
    };
  }

  // Check for recent trades command
  if (TRADES_KEYWORDS.some((k) => text.includes(k))) {
    const market = findMarket(text);
    if (!market) {
      return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
    }
    return {
      success: true,
      parsed: { type: "trades", market },
      command: `show trades --perp ${market}`,
      description: `Show recent ${market.toUpperCase()} trades`,
    };
  }

  // Check for open orders command
  if (ORDERS_KEYWORDS.some((k) => text.includes(k)) && !text.includes("cancel")) {
    const market = findMarket(text);
    if (!market) {
      return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
    }
    return {
      success: true,
      parsed: { type: "orders", market },
      command: `show orders --perp ${market}`,
      description: `Show open ${market.toUpperCase()} orders`,
    };
  }

  // Check for deposit command
  if (DEPOSIT_KEYWORDS.some((k) => text.includes(k))) {
    const amountMatch = text.match(/(\d+\.?\d*)/);
    if (!amountMatch) {
      return { success: false, error: "Please specify an amount to deposit" };
    }
    const amount = parseFloat(amountMatch[1]);
    return {
      success: true,
      parsed: { type: "deposit", amount },
      command: `manage deposit --amount ${amount}`,
      description: `Deposit ${amount} USD`,
    };
  }

  // Check for withdraw command
  if (WITHDRAW_KEYWORDS.some((k) => text.includes(k))) {
    const amountMatch = text.match(/(\d+\.?\d*)/);
    if (!amountMatch) {
      return { success: false, error: "Please specify an amount to withdraw" };
    }
    const amount = parseFloat(amountMatch[1]);
    return {
      success: true,
      parsed: { type: "withdraw", amount },
      command: `manage withdraw --amount ${amount}`,
      description: `Withdraw ${amount} USD`,
    };
  }

  // Check for close all command (closes all positions and cancels all orders across all markets)
  if (CLOSE_ALL_KEYWORDS.some((k) => text.includes(k))) {
    const market = findMarket(text);
    // If market specified, close just that market; otherwise close everything
    return {
      success: true,
      parsed: { type: "close-all", market },
      command: market ? `close-all --perp ${market}` : "close-all",
      description: market
        ? `Close all ${market.toUpperCase()} positions and cancel orders`
        : "Close all positions and cancel all orders",
    };
  }

  // Check for close position command (close position on specific market)
  if (CLOSE_POSITION_KEYWORDS.some((k) => text.includes(k))) {
    const market = findMarket(text);
    if (!market) {
      return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
    }
    return {
      success: true,
      parsed: { type: "close-position", market },
      command: `close-position --perp ${market}`,
      description: `Close ${market.toUpperCase()} position`,
    };
  }

  // Check for cancel all orders command
  if (CANCEL_ALL_KEYWORDS.some((k) => text.includes(k))) {
    const market = findMarket(text);
    if (!market) {
      return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
    }
    return {
      success: true,
      parsed: { type: "cancel-all", market },
      command: `trade cancel-all --perp ${market}`,
      description: `Cancel all ${market.toUpperCase()} orders`,
    };
  }

  // Check for cancel single order command (has "cancel" + order ID, but not "cancel all")
  if (text.includes("cancel") && !CANCEL_ALL_KEYWORDS.some((k) => text.includes(k))) {
    const orderIdMatch = text.match(/(?:order|id|#)\s*(\d+)/i) || text.match(/\b(\d+)\b/);
    if (orderIdMatch) {
      const market = findMarket(text);
      if (!market) {
        return { success: false, error: "Please specify a market (btc, eth, sol, mon, zec)" };
      }
      const orderId = orderIdMatch[1];
      return {
        success: true,
        parsed: { type: "cancel", market, orderId },
        command: `trade cancel --perp ${market} --order-id ${orderId}`,
        description: `Cancel ${market.toUpperCase()} order #${orderId}`,
      };
    }
    // "cancel" without order ID - give helpful error
    if (text.includes("order")) {
      return { success: false, error: "Please specify an order ID (e.g., 'cancel btc order 123')" };
    }
  }

  // If no query command matched, try to parse as a trade
  return parseTrade(input);
}

/**
 * Parse natural language trade description into structured trade object
 */
export function parseTrade(input: string): ParseResult {
  const text = input.toLowerCase().trim();

  if (!text) {
    return { success: false, error: "Empty input" };
  }

  try {
    const trade: Partial<ParsedTrade> = {
      options: { ioc: false, postOnly: false },
    };

    // Determine action (open vs close)
    trade.action = CLOSE_KEYWORDS.some((k) => text.includes(k)) ? "close" : "open";

    // Determine side (long vs short)
    const isLong = LONG_KEYWORDS.some((k) => text.includes(k));
    const isShort = SHORT_KEYWORDS.some((k) => text.includes(k));

    if (isLong && isShort) {
      return { success: false, error: "Ambiguous side: found both long and short keywords" };
    }
    if (!isLong && !isShort) {
      return { success: false, error: "Could not determine side (long/short)" };
    }
    trade.side = isLong ? "long" : "short";

    // Determine market
    let foundMarket: ParsedTrade["market"] | undefined;
    for (const [alias, market] of Object.entries(MARKET_ALIASES)) {
      // Match whole word only
      const regex = new RegExp(`\\b${alias}\\b`, "i");
      if (regex.test(text)) {
        foundMarket = market;
        break;
      }
    }
    if (!foundMarket) {
      return { success: false, error: "Could not determine market (btc, eth, sol, mon, zec)" };
    }
    trade.market = foundMarket;

    // First check for USD amounts ("$100", "100 usd", "100 dollars")
    // But NOT "$X" that appears after "at" or "@" (those are prices)
    let sizeIsUsd = false;
    let size: number | undefined;

    // Check for "100 usd" or "100 dollars" first (unambiguous)
    const usdSuffixMatch = text.match(/(\d+\.?\d*)\s*(?:usd|dollars?)\b/i);
    if (usdSuffixMatch) {
      size = parseFloat(usdSuffixMatch[1]);
      sizeIsUsd = true;
    }

    // Check for "$X" that is NOT a price (not preceded by "at" or "@")
    if (!size) {
      const dollarMatches = text.matchAll(/\$\s*(\d+\.?\d*)/gi);
      for (const match of dollarMatches) {
        const dollarIndex = match.index!;
        const beforeDollar = text.substring(Math.max(0, dollarIndex - 5), dollarIndex).trim();
        // Skip if preceded by "at" or "@" (it's a price, not a size)
        if (beforeDollar.endsWith("at") || beforeDollar.endsWith("@")) {
          continue;
        }
        size = parseFloat(match[1]);
        sizeIsUsd = true;
        break;
      }
    }

    // If no USD amount, look for size in native units
    if (!size) {
      const sizePatterns = [
        // "0.01 btc", "1 eth", "100 sol"
        new RegExp(`(\\d+\\.?\\d*)\\s*(?:${Object.keys(MARKET_ALIASES).join("|")})`, "i"),
        // "for 0.01", "for 0.01 btc" (e.g., "long btc for 0.01")
        /\bfor\s+(\d+\.?\d*)/i,
        // "size 0.01", "size: 0.01"
        /size[:\s]+(\d+\.?\d*)/i,
        // standalone number before "at" (e.g., "long 0.01 at 78000")
        /(?:long|short|buy|sell)\s+(\d+\.?\d*)\s+(?:at|@)/i,
        // standalone number after side keyword
        /(?:long|short|buy|sell)\s+(\d+\.?\d*)/i,
      ];

      for (const pattern of sizePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          size = parseFloat(match[1]);
          break;
        }
      }
    }

    if (!size || isNaN(size) || size <= 0) {
      return { success: false, error: "Could not determine trade size" };
    }
    trade.size = size;
    trade.sizeIsUsd = sizeIsUsd;

    // Extract price - look for "at $X", "@ X", "price X"
    const isMarketOrder = MARKET_ORDER_KEYWORDS.some((k) => text.includes(k));

    if (isMarketOrder) {
      trade.price = "market";
      trade.options!.ioc = true;
    } else {
      const pricePatterns = [
        // "at $78000", "at 78000", "@ 78000" - but NOT "at 3x" (leverage)
        /(?:at|@)\s*\$?(\d+\.?\d*)(?!x)/i,
        // "price 78000", "price: 78000"
        /price[:\s]+\$?(\d+\.?\d*)/i,
      ];

      let price: number | undefined;
      for (const pattern of pricePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const potentialPrice = parseFloat(match[1]);
          // Skip if this looks like leverage (small number followed by x)
          if (potentialPrice < 100 && text.includes(`${match[1]}x`)) {
            continue;
          }
          price = potentialPrice;
          break;
        }
      }
      if (!price || isNaN(price) || price <= 0) {
        return { success: false, error: "Could not determine price (use 'at market' for market orders)" };
      }
      trade.price = price;
    }

    // Extract leverage (only for open orders)
    if (trade.action === "open") {
      const leveragePatterns = [
        // "10x leverage", "10x", "leverage 10"
        /(\d+\.?\d*)x\s*(?:leverage)?/i,
        /leverage[:\s]+(\d+\.?\d*)/i,
        /with\s+(\d+\.?\d*)x/i,
      ];

      let leverage: number | undefined;
      for (const pattern of leveragePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          leverage = parseFloat(match[1]);
          break;
        }
      }
      trade.leverage = leverage || 1; // Default to 1x if not specified
    }

    // Check for post-only
    if (POST_ONLY_KEYWORDS.some((k) => text.includes(k))) {
      trade.options!.postOnly = true;
      trade.options!.ioc = false; // Post-only and IOC are mutually exclusive
    }

    // Build command string
    const command = buildCommand(trade as ParsedTrade);

    return {
      success: true,
      trade: trade as ParsedTrade,
      command,
    };
  } catch (err) {
    return {
      success: false,
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build CLI command string from parsed trade
 */
export function buildCommand(trade: ParsedTrade): string {
  const parts = ["trade", trade.action];

  parts.push("--perp", trade.market);
  parts.push("--side", trade.side);
  parts.push("--size", String(trade.size));

  if (trade.price === "market") {
    // For market orders, we need a price (will be used as limit)
    // The skill should fetch current price, but we'll use a placeholder
    parts.push("--price", "MARKET_PRICE");
  } else {
    parts.push("--price", String(trade.price));
  }

  if (trade.action === "open" && trade.leverage) {
    parts.push("--leverage", String(trade.leverage));
  }

  if (trade.options.ioc) {
    parts.push("--ioc");
  }

  if (trade.options.postOnly) {
    parts.push("--post-only");
  }

  return parts.join(" ");
}

/**
 * Format trade for display/confirmation
 */
export function formatTrade(trade: ParsedTrade): string {
  const action = trade.action.toUpperCase();
  const side = trade.side.toUpperCase();
  const market = trade.market.toUpperCase();
  const size = trade.size;
  const price = trade.price === "market" ? "MARKET" : `$${trade.price.toLocaleString()}`;
  const leverage = trade.leverage ? ` (${trade.leverage}x leverage)` : "";
  const flags = [];

  if (trade.options.ioc) flags.push("IOC");
  if (trade.options.postOnly) flags.push("POST-ONLY");

  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

  return `${action} ${side} ${size} ${market} @ ${price}${leverage}${flagStr}`;
}
