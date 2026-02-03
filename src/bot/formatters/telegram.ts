/**
 * Telegram message formatters
 * Format data for Telegram markdown display
 */

import type { ParsedTrade } from "../../cli/tradeParser.js";

/**
 * Account status for formatting
 */
export interface AccountStatus {
  address: string;
  accountId: bigint;
  balance: number;
  locked: number;
  available: number;
  walletEth: number;
  walletUsdc: number;
}

/**
 * Position data for formatting
 */
export interface PositionData {
  symbol: string;
  type: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
}

/**
 * Market data for formatting
 */
export interface MarketData {
  symbol: string;
  markPrice: number;
  oraclePrice: number;
  fundingRate: number;
  longOI: number;
  shortOI: number;
  paused: boolean;
}

/**
 * Trade result for formatting
 */
export interface TradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Escape special markdown characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

/**
 * Format account status for Telegram
 */
export function formatStatus(
  account: AccountStatus | null,
  positions: PositionData[]
): string {
  if (!account) {
    return "No exchange account found\\.\nUse deposit to create one\\.";
  }

  const lines: string[] = [];

  lines.push("*Exchange Account*");
  lines.push(`Account ID: \`${account.accountId}\``);
  lines.push(`Balance: $${escapeMarkdown(account.balance.toFixed(2))}`);
  lines.push(`Locked: $${escapeMarkdown(account.locked.toFixed(2))}`);
  lines.push(`Available: $${escapeMarkdown(account.available.toFixed(2))}`);

  if (positions.length > 0) {
    lines.push("");
    lines.push("*Positions*");
    for (const pos of positions) {
      const pnlSign = pos.pnl >= 0 ? "\\+" : "";
      lines.push("");
      lines.push(`*${escapeMarkdown(pos.symbol)}* ${pos.type}`);
      lines.push(`  Size: ${escapeMarkdown(pos.size.toFixed(6))}`);
      lines.push(`  Entry: $${escapeMarkdown(pos.entryPrice.toFixed(2))}`);
      lines.push(`  Mark: $${escapeMarkdown(pos.markPrice.toFixed(2))}`);
      lines.push(`  PnL: ${pnlSign}$${escapeMarkdown(pos.pnl.toFixed(2))}`);
    }
  }

  lines.push("");
  lines.push("*Wallet*");
  lines.push(`ETH: ${escapeMarkdown(account.walletEth.toFixed(6))}`);
  lines.push(`USDC: $${escapeMarkdown(account.walletUsdc.toFixed(2))}`);

  return lines.join("\n");
}

/**
 * Format markets data for Telegram
 */
export function formatMarkets(markets: MarketData[]): string {
  if (markets.length === 0) {
    return "No markets found\\.";
  }

  const lines: string[] = [];
  lines.push("*Available Markets*");
  lines.push("");

  for (const m of markets) {
    const status = m.paused ? " \\(PAUSED\\)" : "";
    const fundingSign = m.fundingRate >= 0 ? "\\+" : "";
    const fundingPct = (m.fundingRate * 100).toFixed(4);

    lines.push(`*${escapeMarkdown(m.symbol)}*${status}`);
    lines.push(`  Mark: $${escapeMarkdown(m.markPrice.toLocaleString())}`);
    lines.push(`  Oracle: $${escapeMarkdown(m.oraclePrice.toLocaleString())}`);
    lines.push(`  Funding: ${fundingSign}${escapeMarkdown(fundingPct)}%/8h`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format trade preview for confirmation
 */
export function formatTradePreview(trade: ParsedTrade): string {
  const action = trade.action.toUpperCase();
  const side = trade.side.toUpperCase();
  const market = trade.market.toUpperCase();
  const price =
    trade.price === "market"
      ? "MARKET"
      : `$${escapeMarkdown(trade.price.toLocaleString())}`;

  const lines: string[] = [];
  lines.push("*Trade Preview*");
  lines.push("");
  lines.push(`${action} ${side} ${escapeMarkdown(trade.size.toString())} ${market} @ ${price}`);

  if (trade.leverage && trade.leverage > 1) {
    lines.push(`Leverage: ${trade.leverage}x`);
  }

  const flags: string[] = [];
  if (trade.options.ioc) flags.push("IOC");
  if (trade.options.postOnly) flags.push("POST\\-ONLY");
  if (flags.length > 0) {
    lines.push(`Flags: ${flags.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Format trade result
 */
export function formatTradeResult(result: TradeResult): string {
  if (result.success && result.txHash) {
    return `*Trade Submitted*\n\nTx: \`${result.txHash}\``;
  } else {
    const error = result.error ? escapeMarkdown(result.error) : "Unknown error";
    return `*Trade Failed*\n\n${error}`;
  }
}

/**
 * Format error message
 */
export function formatError(message: string): string {
  return `*Error*\n\n${escapeMarkdown(message)}`;
}

/**
 * Format help message
 */
export function formatHelp(): string {
  const lines: string[] = [
    "*PerplBot Commands*",
    "",
    "*Slash Commands*",
    "/status \\- Account balance and positions",
    "/markets \\- Current prices and funding rates",
    "/help \\- This message",
    "",
    "*Account \\& Market Info*",
    "• \"status\" or \"balance\" or \"positions\"",
    "• \"markets\" or \"prices\"",
    "• \"btc order book\" or \"eth book\"",
    "• \"btc trades\" or \"recent eth trades\"",
    "• \"my btc orders\" \\- view open orders",
    "",
    "*Trading \\(with confirmation\\)*",
    "• \"long 0\\.01 btc at 78000 5x\"",
    "• \"short 0\\.1 eth at 3000\"",
    "• \"buy 1 sol at market\"",
    "• \"long btc $100 at market 3x\" \\- USD amount",
    "",
    "*Order Management*",
    "• \"cancel btc order 123\"",
    "• \"cancel all btc orders\"",
    "",
    "*Position Management*",
    "• \"close position btc\" \\- close specific market",
    "• \"close all\" \\- cancel all orders \\+ close all positions",
    "• \"close all eth\" \\- cancel \\+ close for one market",
    "",
    "_Markets: btc, eth, sol, mon, zec_",
  ];
  return lines.join("\n");
}

/**
 * Format welcome message
 */
export function formatWelcome(): string {
  const lines: string[] = [
    "*Welcome to PerplBot\\!*",
    "",
    "Your personal trading assistant for Perpl\\.",
    "",
    "Just type naturally:",
    "• \"status\" \\- check your account",
    "• \"long 0\\.01 btc at 78000\" \\- trade",
    "• \"close all\" \\- exit everything",
    "",
    "Use /help for all commands\\.",
  ];
  return lines.join("\n");
}

/**
 * Order book level
 */
export interface OrderBookLevel {
  price: number;
  size: number;
}

/**
 * Order book data
 */
export interface OrderBookData {
  symbol: string;
  markPrice: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  blocksScanned: number;
  ordersFound: number;
}

/**
 * Format order book for Telegram
 */
export function formatOrderBook(book: OrderBookData): string {
  const lines: string[] = [];
  lines.push(`*${escapeMarkdown(book.symbol)} Order Book*`);
  lines.push(`Mark: $${escapeMarkdown(book.markPrice.toFixed(2))}`);
  lines.push("");

  if (book.asks.length === 0 && book.bids.length === 0) {
    lines.push("No resting orders found\\.");
  } else {
    // Show asks (reversed so highest is at top)
    lines.push("```");
    lines.push("     Price       Size");
    lines.push("─────────────────────");

    for (const ask of [...book.asks].reverse()) {
      const price = `$${ask.price.toFixed(2)}`.padStart(10);
      const size = ask.size.toFixed(6);
      lines.push(`ASK ${price}  ${size}`);
    }

    lines.push(`──── $${book.markPrice.toFixed(2).padStart(8)} ────`);

    for (const bid of book.bids) {
      const price = `$${bid.price.toFixed(2)}`.padStart(10);
      const size = bid.size.toFixed(6);
      lines.push(`BID ${price}  ${size}`);
    }
    lines.push("```");
  }

  lines.push("");
  lines.push(`Scanned ${book.blocksScanned} blocks, ${book.ordersFound} orders`);

  return lines.join("\n");
}

/**
 * Recent trade data
 */
export interface RecentTrade {
  blockNumber: bigint;
  price: number;
  size: number;
  makerAccountId: bigint;
}

/**
 * Format recent trades for Telegram
 */
export function formatRecentTrades(
  symbol: string,
  trades: RecentTrade[],
  blocksScanned: number
): string {
  const lines: string[] = [];
  lines.push(`*Recent ${escapeMarkdown(symbol)} Trades*`);
  lines.push("");

  if (trades.length === 0) {
    lines.push("No trades found in recent blocks\\.");
  } else {
    lines.push("```");
    lines.push("Block      Price       Size");
    lines.push("───────────────────────────");

    for (const trade of trades) {
      const block = trade.blockNumber.toString().padStart(8);
      const price = `$${trade.price.toFixed(2)}`.padStart(10);
      const size = trade.size.toFixed(6);
      lines.push(`${block} ${price}  ${size}`);
    }
    lines.push("```");
  }

  lines.push("");
  lines.push(`Scanned ${blocksScanned} blocks, ${trades.length} trades`);

  return lines.join("\n");
}

/**
 * Open order data
 */
export interface OpenOrder {
  orderId: bigint;
  orderType: string;
  price: number;
  size: number;
  leverage: number;
}

/**
 * Format open orders for Telegram
 */
export function formatOpenOrders(symbol: string, orders: OpenOrder[]): string {
  const lines: string[] = [];
  lines.push(`*${escapeMarkdown(symbol)} Open Orders*`);
  lines.push("");

  if (orders.length === 0) {
    lines.push("No open orders\\.");
  } else {
    for (const order of orders) {
      lines.push(`Order \\#${order.orderId}`);
      lines.push(`  Type: ${escapeMarkdown(order.orderType)}`);
      lines.push(`  Price: $${escapeMarkdown(order.price.toFixed(2))}`);
      lines.push(`  Size: ${escapeMarkdown(order.size.toFixed(6))}`);
      lines.push(`  Leverage: ${order.leverage}x`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Format cancel result
 */
export function formatCancelResult(
  success: boolean,
  orderId?: string,
  txHash?: string,
  error?: string
): string {
  if (success && txHash) {
    const orderText = orderId ? ` \\#${orderId}` : "";
    return `*Order${orderText} Cancelled*\n\nTx: \`${txHash}\``;
  } else {
    const errorMsg = error ? escapeMarkdown(error) : "Unknown error";
    return `*Cancel Failed*\n\n${errorMsg}`;
  }
}

/**
 * Format cancel all result
 */
export function formatCancelAllResult(
  cancelled: number,
  total: number,
  symbol: string
): string {
  if (total === 0) {
    return `No open ${escapeMarkdown(symbol)} orders to cancel\\.`;
  }
  return `*Cancelled ${cancelled}/${total} ${escapeMarkdown(symbol)} orders*`;
}
