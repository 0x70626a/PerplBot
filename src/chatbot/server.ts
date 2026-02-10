/**
 * HTTP server with Anthropic streaming + tool-use loop
 * GET /  → serves chat UI
 * POST /api/chat → SSE-streamed Claude responses with tool execution
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SYSTEM_PROMPT = `You are PerplBot, a trading terminal for Perpl DEX on Monad testnet. You ONLY execute Perpl commands. You do NOT answer general questions, chat, or do anything unrelated to Perpl trading.

If the user asks something unrelated to Perpl, respond: "I only handle Perpl commands. Type **help** to see what I can do."

## Commands

When user types "help" or asks what you can do, show this EXACT list:

**Portfolio**
- \`show account\` — balance, equity, margin, PnL
- \`show positions\` — all open positions with PnL
- \`show markets\` — prices, funding rates, open interest
- \`show orders\` / \`show btc orders\` — open resting orders

**Analysis**
- \`btc liquidation analysis\` — liquidation price, distance, funding impact
- \`eth funding rate\` — funding rate and time to next funding
- \`btc fees\` — maker and taker fee percentages
- \`btc orderbook\` — on-chain order book (bids/asks)
- \`recent btc trades\` — recent fills from on-chain events

**Trading** *(confirms before executing)*
- \`long 0.01 btc at 78000 5x\` — open long position
- \`short 1 eth at market 10x\` — open short at market price
- \`close my btc position\` — close entire position
- \`close 0.05 btc at 72000\` — partial close at limit price
- \`cancel btc order 123\` — cancel a resting order
- \`cancel all btc orders\` — cancel all orders for a market

**Simulation**
- \`dry run long 0.01 btc at 78000 5x\` — simulate trade without executing
- \`simulate grid btc 5 levels 100 spacing 0.001 size 2x\` — grid strategy dry-run
- \`simulate mm btc 0.001 size 0.1% spread 2x\` — market maker dry-run
- \`debug 0x...\` — replay and analyze a transaction

**Shorthand**: long/buy, short/sell, close/exit | btc, eth, sol, mon, zec | "at 78000", "@ market" | "5x" | "maker only"

**Not available here**: deposit, withdraw (require wallet signing via CLI)

## Style

- Extremely concise. No filler.
- Tables for multi-row data.
- Emoji: green_circle profit/long, red_circle loss/short, white_check_mark success, x error, warning risk.
- Format: $XX,XXX.XX for USD, percentages with %.
- Positions: "BTC LONG 0.21 @ $68,798 | PnL: green_circle +$321.22 (+11.1%) | 5x"
- Trades: "LONG 0.01 BTC @ $78,000 (5x) — Proceed?"
- Never repeat raw tool data. Summarize visually.
- Errors: one line + fix suggestion.

## Rules

- ALWAYS use tools. Never guess or calculate when a tool exists.
- Liquidation → get_liquidation_analysis. Fees → get_trading_fees. Positions → get_positions. Risk → get_liquidation_analysis + get_positions.
- Orderbook → get_orderbook. Recent trades → get_recent_trades. Debug tx → debug_transaction.
- "dry run" / "simulate trade" → dry_run_trade. "simulate grid/mm" → simulate_strategy.
- Read queries: execute immediately.
- Write ops: ONE line description + "Proceed?" BEFORE calling tool.
- "at market": call get_markets for price, add 1-2% slippage, is_market_order=true.
- Note: debug_transaction, simulate_strategy require Anvil. If they fail with an Anvil error, tell the user Anvil is not installed.
- dry_run_trade works without Anvil (basic pass/fail) but gives richer results with Anvil.

## Markets

BTC=16, ETH=32, SOL=48, MON=64, ZEC=256

## Architecture

Collateral: USDC (6 dec). Close positions use on-chain data (authoritative).`;

const MODEL = process.env.CHATBOT_MODEL || "claude-sonnet-4-5-20250929";

let anthropic: Anthropic;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic(); // Uses ANTHROPIC_API_KEY env var
  }
  return anthropic;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlock[];
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sseWrite(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Handle the /api/chat endpoint with streaming tool-use loop.
 */
async function handleChat(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const requestStart = Date.now();

  let body: { messages: ChatMessage[] };
  try {
    const raw = await parseBody(req);
    body = JSON.parse(raw);
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request body: " + (err as Error).message }));
    return;
  }

  // Log the user's latest message
  const lastMsg = body.messages[body.messages.length - 1];
  const userText = typeof lastMsg?.content === "string" ? lastMsg.content : "[structured]";
  console.log(`\n[req] POST /api/chat — "${userText}" (${body.messages.length} messages)`);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const client = getAnthropicClient();
  // Build message history for Anthropic
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const fullText = await streamWithToolLoop(client, messages, res);
    // Send the full assistant text (including tool context) for client-side history
    sseWrite(res, "assistant_message", { text: fullText });
  } catch (err) {
    console.error("[req] Error:", err);
    sseWrite(res, "error", { error: (err as Error).message });
  }

  const elapsed = Date.now() - requestStart;
  console.log(`[req] Done (${elapsed}ms)`);
  sseWrite(res, "done", {});
  res.end();
}

/**
 * Stream Claude's response, executing tools in a loop until we get a final text response.
 * Returns the full assistant text for the client to store in conversation history.
 */
async function streamWithToolLoop(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  res: ServerResponse,
): Promise<string> {
  const MAX_TOOL_ROUNDS = 10;
  // Accumulate ALL text across tool rounds for the client's history
  const allTextParts: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Accumulate response content blocks
    let currentText = "";
    const contentBlocks: Anthropic.ContentBlock[] = [];
    let stopReason: string | null = null;

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          currentText = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          currentText += event.delta.text;
          sseWrite(res, "text", { text: event.delta.text });
        }
      }
    }

    // Get the final message
    const finalMessage = await stream.finalMessage();
    stopReason = finalMessage.stop_reason;

    // Collect content blocks
    for (const block of finalMessage.content) {
      contentBlocks.push(block);
    }

    // Collect text from this round
    const textBlocks = contentBlocks
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textBlocks.length > 0) {
      allTextParts.push(...textBlocks);
    }

    // If no tool use, we're done
    if (stopReason !== "tool_use") {
      break;
    }

    // Execute tool calls
    const toolUseBlocks = contentBlocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) break;

    // Add assistant message with all content blocks
    messages.push({ role: "assistant", content: contentBlocks });

    // Execute each tool and build tool_result messages
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      sseWrite(res, "tool_call", { name: toolUse.name, input: toolUse.input });

      const resultStr = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

      sseWrite(res, "tool_result", { name: toolUse.name, result: JSON.parse(resultStr) });

      // Include tool context in the text history so Claude remembers what happened
      allTextParts.push(`[Called ${toolUse.name}: ${resultStr}]`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultStr,
      });
    }

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });
  }

  return allTextParts.join("\n\n");
}

/**
 * Serve the static HTML file.
 */
async function serveHTML(_req: IncomingMessage, res: ServerResponse) {
  try {
    const htmlPath = join(__dirname, "public", "index.html");
    const html = await readFile(htmlPath, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Failed to load index.html");
  }
}

/**
 * Start the HTTP server.
 */
export function startServer(port: number) {
  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (url === "/api/chat") {
      await handleChat(req, res);
    } else if (url === "/" || url === "/index.html") {
      await serveHTML(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  server.listen(port, () => {
    console.log(`[chatbot] Server listening on http://localhost:${port}`);
  });

  return server;
}
