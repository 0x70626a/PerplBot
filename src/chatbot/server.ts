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
import { getLastBatchOrders, clearLastBatchOrders, batchOpenPositions, setStopLoss, setTakeProfit } from "./sdk-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compact system prompt — sent with every request, cached via cache_control
const SYSTEM_PROMPT = `PerplBot: Perpl DEX terminal on Monad testnet. ONLY Perpl commands. Non-Perpl → "I only handle Perpl commands. Type **help** to see what I can do."

On "help", show EXACT list:
**Portfolio**: \`show account\` \`show positions\` \`show markets\` \`show orders\`
**Analysis**: \`btc liquidation analysis\` \`eth funding rate\` \`btc fees\` \`btc orderbook\` \`recent btc trades\`
**Trading** *(confirms first)*: \`long 0.01 btc at 78000 5x\` \`short 1 eth at market 10x\` \`close my btc\` \`cancel btc order 123\` \`sl btc at 92000\` \`tp btc at 110000\`
**Simulation**: \`dry run long 0.01 btc at 78000 5x\` \`simulate grid btc\` \`simulate mm btc\` \`debug 0x...\`
Shorthand: long/buy, short/sell, close/exit, sl/stop-loss, tp/take-profit | btc,eth,sol,mon,zec | "at 78000"/"@ market" | "5x"
\`help trading\` \`help analysis\` \`help simulation\` \`help portfolio\` for detailed examples.
CLI-only: deposit, withdraw

Style: Concise. Tables for multi-row. $XX,XXX.XX for USD. Reports from analysis/sim tools display automatically — add 1-2 line takeaway only, never repeat report data.

Rules: ALWAYS use tools, never guess. debug_transaction/simulate_strategy need Anvil.

TRADE CONFIRMATION (MANDATORY — no exceptions):
1. User mentions a trade → NEVER call open_position/close_position. Only call get_markets (for "at market" pricing). Then show preview: "LONG 0.01 BTC @ $78,000 (5x limit) — Proceed? Reply \`long 0.01 btc at 78000 5x\` to confirm." ALWAYS include the full executable command in backticks.
2. User re-enters the exact command → NOW call open_position/close_position. No re-confirm needed.
3. "at market" → call get_markets, add 1-2% slippage, show preview with calculated price. Do NOT call open_position in the same turn.
After dry_run_trade → ask "Execute this trade?" On confirm → call open_position (no re-confirm).
After simulate_strategy → ask "Place these N orders? Reply \`place orders\`." On confirm → batch_open_positions (no re-confirm).

AFTER TRADE EXECUTION: Show result only. Do NOT call get_liquidation_analysis or any analysis tools after a trade. Only suggest \`debug <txHash>\` if txHash is present. "sl"→set_stop_loss, "tp"→set_take_profit.

Markets: BTC=16 ETH=32 SOL=48 MON=64 ZEC=256. Collateral: AUSD (6 dec).`;

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

  // Direct "place orders" — execute stored batch without routing through Claude
  if (/^place\s+orders$/i.test(userText)) {
    const orders = getLastBatchOrders();
    console.log(`[req] place orders handler: ${orders ? orders.length + " orders stored" : "no orders stored"}`);
    if (orders && orders.length > 0) {
      try {
        sseWrite(res, "text", { text: `Placing ${orders.length} orders...\n\n` });
        sseWrite(res, "tool_call", { name: "batch_open_positions", input: { orders } });
        const result = await batchOpenPositions(orders);
        sseWrite(res, "tool_result", { name: "batch_open_positions", result });
        const summary = `**${result.successful}/${result.totalOrders}** orders placed successfully.` +
          (result.failed > 0 ? ` ${result.failed} failed.` : "");
        sseWrite(res, "text", { text: summary });
        sseWrite(res, "assistant_message", { text: `Placing ${orders.length} orders...\n\n[Called batch_open_positions: ${JSON.stringify(result)}]\n\n${summary}` });
        clearLastBatchOrders();
      } catch (err) {
        const msg = `Order placement failed: ${(err as Error).message}`;
        sseWrite(res, "text", { text: msg });
        sseWrite(res, "assistant_message", { text: msg });
      }
      const elapsed = Date.now() - requestStart;
      console.log(`[req] Done (${elapsed}ms)`);
      sseWrite(res, "done", {});
      res.end();
      return;
    }
  }

  // Direct "sl <market> at <price>" — bypass Claude for stop-loss
  const slMatch = userText.match(/^(?:sl|stop[\s-]?loss)\s+(\w+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*$/i);
  if (slMatch) {
    const [, market, priceStr] = slMatch;
    const triggerPrice = parseFloat(priceStr);
    console.log(`[req] sl handler: ${market} at ${triggerPrice}`);
    try {
      sseWrite(res, "tool_call", { name: "set_stop_loss", input: { market, trigger_price: triggerPrice } });
      const result = await setStopLoss({ market, trigger_price: triggerPrice });
      sseWrite(res, "tool_result", { name: "set_stop_loss", result });
      const msg = `**${result.type}** set for ${result.market} ${result.side} — triggers at $${triggerPrice.toLocaleString()} (${result.triggerCondition})`;
      sseWrite(res, "text", { text: msg });
      sseWrite(res, "assistant_message", { text: msg });
    } catch (err) {
      const msg = `Stop-loss failed: ${(err as Error).message}`;
      sseWrite(res, "text", { text: msg });
      sseWrite(res, "assistant_message", { text: msg });
    }
    const elapsed = Date.now() - requestStart;
    console.log(`[req] Done (${elapsed}ms)`);
    sseWrite(res, "done", {});
    res.end();
    return;
  }

  // Direct "tp <market> at <price>" — bypass Claude for take-profit
  const tpMatch = userText.match(/^(?:tp|take[\s-]?profit)\s+(\w+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*$/i);
  if (tpMatch) {
    const [, market, priceStr] = tpMatch;
    const triggerPrice = parseFloat(priceStr);
    console.log(`[req] tp handler: ${market} at ${triggerPrice}`);
    try {
      sseWrite(res, "tool_call", { name: "set_take_profit", input: { market, trigger_price: triggerPrice } });
      const result = await setTakeProfit({ market, trigger_price: triggerPrice });
      sseWrite(res, "tool_result", { name: "set_take_profit", result });
      const msg = `**${result.type}** set for ${result.market} ${result.side} — triggers at $${triggerPrice.toLocaleString()} (${result.triggerCondition})`;
      sseWrite(res, "text", { text: msg });
      sseWrite(res, "assistant_message", { text: msg });
    } catch (err) {
      const msg = `Take-profit failed: ${(err as Error).message}`;
      sseWrite(res, "text", { text: msg });
      sseWrite(res, "assistant_message", { text: msg });
    }
    const elapsed = Date.now() - requestStart;
    console.log(`[req] Done (${elapsed}ms)`);
    sseWrite(res, "done", {});
    res.end();
    return;
  }

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

// Tools with rich reports that return results directly — Claude commentary is redundant.
// Simpler tools (funding, fees, orderbook, trades) still go through Claude for formatting.
const DIRECT_RETURN_TOOLS = new Set([
  "simulate_strategy",
  "dry_run_trade",
  "debug_transaction",
  "get_liquidation_analysis",
]);

/**
 * Generate a follow-up prompt after a direct-return tool executes.
 * Returns null if no follow-up is needed (tool result speaks for itself).
 */
function getDirectFollowUp(toolName: string, input: Record<string, unknown>, resultStr: string): string | null {
  try {
    const result = JSON.parse(resultStr);
    if (result.error) return null;

    switch (toolName) {
      case "simulate_strategy": {
        const count = result._batchOrders?.length || result.totalOrders || 0;
        if (count > 0) {
          return `\n\n**${count} orders generated.** Reply \`place orders\` to execute.`;
        }
        return null;
      }

      case "dry_run_trade": {
        const side = input.side as string;
        const size = input.size;
        const market = (input.market as string).toLowerCase();
        const price = input.is_market_order ? "market" : input.price;
        const leverage = input.leverage;
        const cmd = `${side} ${size} ${market} at ${price} ${leverage}x`;
        return `\n\nExecute this trade? Reply \`${cmd}\` to confirm.`;
      }

      case "get_liquidation_analysis": {
        const liqPrice = result.liquidationPrice;
        const entryPrice = result.entryPrice;
        const isLong = result.side === "long";
        const market = (input.market as string).toLowerCase();
        if (!liqPrice || !entryPrice) return null;

        // SL: 75% of distance from entry toward liq (always between entry and liq)
        // TP: same distance on the other side of entry (1:1 risk/reward)
        const distance = Math.abs(liqPrice - entryPrice);
        const slPrice = isLong
          ? Math.round(entryPrice - distance * 0.75)
          : Math.round(entryPrice + distance * 0.75);
        const tpPrice = isLong
          ? Math.round(entryPrice + distance * 0.75)
          : Math.round(entryPrice - distance * 0.75);

        return `\n\n**Suggested TP/SL:**\n\`sl ${market} at ${slPrice}\` — stop loss\n\`tp ${market} at ${tpPrice}\` — take profit`;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
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

    // Guard: skip analysis tools when bundled with write tools in the same turn
    const WRITE_TOOLS = new Set(["open_position", "close_position", "cancel_order"]);
    const hasWrite = toolUseBlocks.some(tb => WRITE_TOOLS.has(tb.name));
    const skippedTools = hasWrite
      ? new Set(toolUseBlocks.filter(tb => !WRITE_TOOLS.has(tb.name) && tb.name !== "get_markets").map(tb => tb.id))
      : new Set<string>();

    // Execute each tool — check if all are direct-return
    const allDirect = toolUseBlocks.filter(tb => !skippedTools.has(tb.id)).every(tb => DIRECT_RETURN_TOOLS.has(tb.name));
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // Skip analysis tools bundled with write tools (Claude being too aggressive)
      if (skippedTools.has(toolUse.id)) {
        const skipMsg = JSON.stringify({ skipped: true, reason: "Do not call analysis tools alongside trade execution." });
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: skipMsg });
        continue;
      }

      sseWrite(res, "tool_call", { name: toolUse.name, input: toolUse.input });

      const { data: resultStr, report } = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

      // Send visual report to client (if available)
      if (report) {
        sseWrite(res, "report", { html: report });
      }

      sseWrite(res, "tool_result", { name: toolUse.name, result: JSON.parse(resultStr) });

      // Record tool call in history
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

      // For direct-return tools, generate follow-up prompt (if any)
      if (allDirect) {
        const followUp = getDirectFollowUp(toolUse.name, toolUse.input as Record<string, unknown>, resultStr);
        if (followUp) {
          sseWrite(res, "text", { text: followUp });
          allTextParts.push(followUp);
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultStr,
      });
    }

    // Direct-return tools: skip sending results back to Claude
    if (allDirect) {
      break;
    }

    // Non-direct tools: continue Claude conversation loop
    messages.push({ role: "assistant", content: contentBlocks });

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
