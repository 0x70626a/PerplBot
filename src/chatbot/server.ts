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

// Compact system prompt — sent with every request, cached via cache_control
const SYSTEM_PROMPT = `PerplBot: Perpl DEX terminal on Monad testnet. ONLY Perpl commands. Non-Perpl → "I only handle Perpl commands. Type **help** to see what I can do."

On "help", show EXACT list:
**Portfolio**: \`show account\` \`show positions\` \`show markets\` \`show orders\`
**Analysis**: \`btc liquidation analysis\` \`eth funding rate\` \`btc fees\` \`btc orderbook\` \`recent btc trades\`
**Trading** *(confirms first)*: \`long 0.01 btc at 78000 5x\` \`short 1 eth at market 10x\` \`close my btc\` \`cancel btc order 123\`
**Simulation**: \`dry run long 0.01 btc at 78000 5x\` \`simulate grid btc\` \`simulate mm btc\` \`debug 0x...\`
Shorthand: long/buy, short/sell, close/exit | btc,eth,sol,mon,zec | "at 78000"/"@ market" | "5x"
\`help trading\` \`help analysis\` \`help simulation\` \`help portfolio\` for detailed examples.
CLI-only: deposit, withdraw

Style: Concise. Tables for multi-row. $XX,XXX.XX for USD. Reports from analysis/sim tools display automatically — add 1-2 line takeaway only, never repeat report data.

Rules: ALWAYS use tools, never guess. After dry_run_trade → ask "Execute this trade?" On confirm → call open_position with same params (no re-confirm). Write ops: show full params then ask EXACTLY like this example: "LONG 0.01 BTC @ $78,000 (5x limit) — Proceed? Reply \`long 0.01 btc at 78000 5x\` to confirm." ALWAYS include the full executable command in backticks after "Reply" so it survives history trimming. "at market" → get_markets for price, +1-2% slippage, is_market_order=true. debug_transaction/simulate_strategy need Anvil.
After trade execution (open/close/cancel), ALWAYS show the tx hash and suggest: \`debug <txHash>\` to analyze it.
After get_liquidation_analysis, you MUST suggest TP/SL orders using size and entryPrice from result:
- SL: 5% above liq price (long) or 5% below (short), rounded to clean number
- TP: entry + 2×(entry - SL) for long, entry - 2×(SL - entry) for short, rounded
Show: **Suggested TP/SL:** with \`close <size> <market> at <slPrice>\` and \`close <size> <market> at <tpPrice>\` as clickable commands.
After simulate_strategy, list the generated orders and ask: "Place these N orders? Reply \`place orders\` to confirm." On confirm → call batch_open_positions with the orders from the sim result (no re-confirm).

Markets: BTC=16 ETH=32 SOL=48 MON=64 ZEC=256. Collateral: USDC (6 dec).`;

const MODEL = process.env.CHATBOT_MODEL || "claude-haiku-4-5-20251001";

// Max conversation history messages to send (keeps costs down)
const MAX_HISTORY = 6; // 3 exchanges
const MAX_HISTORY_CONTEXTUAL = 16; // for follow-up queries (yes/no/proceed)

let anthropic: Anthropic;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic(); // Uses ANTHROPIC_API_KEY env var
  }
  return anthropic;
}

// --- Dynamic max_tokens based on message type ---
function getMaxTokens(message: string): number {
  const lower = message.toLowerCase();
  // Help/docs need room for the full command list
  if (lower === "help" || lower.includes("help") || lower.includes("guide") || lower.includes("commands")) return 800;
  // Liquidation analysis includes TP/SL suggestions
  if (lower.includes("liquidation")) return 1000;
  // Strategy sim needs room to list orders and suggest batch placement
  if (lower.includes("simulate") || lower.includes("strategy") || lower.includes("grid") || lower.includes(" mm ")) return 1000;
  // Explanations
  if (lower.includes("explain") || lower.includes("how does") || lower.includes("what is")) return 600;
  // Most trading/query responses are short
  return 400;
}

// --- Smart history limiting ---
function trimHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length <= MAX_HISTORY) return messages;

  const lastUserMsg = messages[messages.length - 1];
  const text = typeof lastUserMsg?.content === "string" ? lastUserMsg.content.toLowerCase() : "";

  // Contextual follow-ups need more history
  const needsContext = /continue|earlier|as i said|same|again|yes|no|proceed|execute|confirm|place orders/.test(text);
  const limit = needsContext ? MAX_HISTORY_CONTEXTUAL : MAX_HISTORY;

  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

// --- Token usage tracking ---
let totalRequests = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheReadTokens = 0;
let totalCacheCreateTokens = 0;

function trackUsage(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) {
  totalRequests++;
  totalInputTokens += usage.input_tokens;
  totalOutputTokens += usage.output_tokens;
  totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
  totalCacheCreateTokens += usage.cache_creation_input_tokens ?? 0;

  // Log every 10 requests
  if (totalRequests % 10 === 0) {
    const inputCost = (totalInputTokens / 1_000_000) * 0.80;
    const outputCost = (totalOutputTokens / 1_000_000) * 4;
    const cacheReadCost = (totalCacheReadTokens / 1_000_000) * 0.08;
    const cacheCreateCost = (totalCacheCreateTokens / 1_000_000) * 1;
    const total = inputCost + outputCost + cacheReadCost + cacheCreateCost;
    console.log(
      `[cost] ${totalRequests} API calls | ${totalInputTokens} in / ${totalOutputTokens} out | ` +
      `cache: ${totalCacheReadTokens} read, ${totalCacheCreateTokens} create | $${total.toFixed(4)}`,
    );
  }
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
  // Build message history for Anthropic — trimmed to limit costs
  const allMessages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const messages = trimHistory(allMessages);

  // Dynamic max_tokens based on message type
  const maxTokens = getMaxTokens(userText);

  try {
    const fullText = await streamWithToolLoop(client, messages, res, maxTokens);
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
  maxTokens: number,
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
      max_tokens: maxTokens,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: tools.map((t, i) =>
        i === tools.length - 1
          ? { ...t, cache_control: { type: "ephemeral" as const } }
          : t,
      ),
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

    // Track token usage for cost monitoring
    trackUsage(finalMessage.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number });

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

      const { data: resultStr, report } = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

      // Send visual report to client (if available) before Claude's summary
      if (report) {
        sseWrite(res, "report", { html: report });
      }

      sseWrite(res, "tool_result", { name: toolUse.name, result: JSON.parse(resultStr) });

      // Include tool context in the text history so Claude remembers what happened.
      // For simulate_strategy, store only the compact batch orders (not the massive full result).
      if (toolUse.name === "simulate_strategy") {
        try {
          const parsed = JSON.parse(resultStr);
          const summary = {
            totalOrders: parsed.totalOrders,
            filledOrders: parsed.filledOrders,
            restingOrders: parsed.restingOrders,
            _batchOrders: parsed._batchOrders,
          };
          allTextParts.push(`[Called simulate_strategy: ${JSON.stringify(summary)}]`);
        } catch {
          allTextParts.push(`[Called ${toolUse.name}: ${resultStr}]`);
        }
      } else {
        allTextParts.push(`[Called ${toolUse.name}: ${resultStr}]`);
      }

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
