/// Web Worker: Perpl L2 WebSocket + RPC on-chain polling fallback.
/// Tries WS first; if Cloudflare blocks it, falls back to RPC book polling.

import type { BookWorkerInMessage, L2Level, TradeEntry, SnapshotMeta } from '../lib/types';

// === Worker state ===

const bidMap = new Map<number, { size: number; orders: number }>();
const askMap = new Map<number, { size: number; orders: number }>();

let meta: SnapshotMeta = {
  market: '',
  perpId: 0,
  blockHeight: 0,
  markPrice: 0,
  oraclePrice: 0,
  timestamp: 0,
};

let dirty = false;
let rebuildIntervalMs = 100;
let rebuildTimer: ReturnType<typeof setInterval> | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let wsMessages = 0;
let l3Polls = 0;
let l3Enabled = false;
let wsFailCount = 0;
const WS_FAIL_THRESHOLD = 2; // Switch to RPC after this many WS failures

// RPC polling state
let rpcMode = false;
let rpcPollTimer: ReturnType<typeof setInterval> | null = null;
let rpcPollIntervalMs = 3000;
let rpcUrl = '';
let exchangeAddress = '';

// Perpl WS price scaling. Defaults for BTC-PERP.
let priceDecimals = 1;
let lotDecimals = 5;
let cachedTickSize = 0.1;
// On-chain price params
let basePricePNS = 0n;

let pendingWsUrl = '';
let pendingRpcUrl = '';
let pendingPerpId = 0;
let pendingMarket = '';
let pendingExchangeAddress = '';
let pendingChainId = 0;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// === Helpers ===

function pnsToPrice(pns: number): number {
  return pns / Math.pow(10, priceDecimals);
}

function pnsBigToPrice(pns: bigint, decimals: bigint): number {
  return Number(pns) / Math.pow(10, Number(decimals));
}

function scaledToSize(s: number): number {
  return s / Math.pow(10, lotDecimals);
}

function getTransferList(result: any): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = [];
  const { bids, asks, heatmap } = result.data;
  transfers.push(
    bids.prices.buffer, bids.sizes.buffer, bids.cumSizes.buffer,
    asks.prices.buffer, asks.sizes.buffer, asks.cumSizes.buffer,
    heatmap.prices.buffer, heatmap.yOffsets.buffer, heatmap.sizes.buffer,
    heatmap.sides.buffer, heatmap.brightness.buffer, heatmap.timestamps.buffer,
  );
  return transfers;
}

function buildSnapshotView() {
  const t0 = performance.now();

  const bidEntries = Array.from(bidMap.entries())
    .map(([p, v]) => ({ price: p, size: v.size, orders: v.orders }))
    .sort((a, b) => b.price - a.price);

  const askEntries = Array.from(askMap.entries())
    .map(([p, v]) => ({ price: p, size: v.size, orders: v.orders }))
    .sort((a, b) => a.price - b.price);

  const totalLevels = bidEntries.length + askEntries.length;
  if (totalLevels === 0) return null;

  const bidPrices = new Float64Array(bidEntries.length);
  const bidSizes = new Float64Array(bidEntries.length);
  const bidCumSizes = new Float64Array(bidEntries.length);
  let cum = 0;
  for (let i = 0; i < bidEntries.length; i++) {
    bidPrices[i] = bidEntries[i].price;
    bidSizes[i] = bidEntries[i].size;
    cum += bidEntries[i].size;
    bidCumSizes[i] = cum;
  }

  const askPrices = new Float64Array(askEntries.length);
  const askSizes = new Float64Array(askEntries.length);
  const askCumSizes = new Float64Array(askEntries.length);
  cum = 0;
  for (let i = 0; i < askEntries.length; i++) {
    askPrices[i] = askEntries[i].price;
    askSizes[i] = askEntries[i].size;
    cum += askEntries[i].size;
    askCumSizes[i] = cum;
  }

  const hmCount = totalLevels;
  const hmPrices = new Float32Array(hmCount);
  const hmYOffsets = new Float32Array(hmCount);
  const hmSizes = new Float32Array(hmCount);
  const hmSides = new Float32Array(hmCount);
  const hmBrightness = new Float32Array(hmCount);
  const hmTimestamps = new Float64Array(hmCount);
  const hmUsers: string[] = new Array(hmCount).fill('');

  let maxCumSize = 0;
  let idx = 0;
  const now = Date.now();

  let maxLevelSize = 0;
  for (const e of bidEntries) if (e.size > maxLevelSize) maxLevelSize = e.size;
  for (const e of askEntries) if (e.size > maxLevelSize) maxLevelSize = e.size;

  for (const e of bidEntries) {
    hmPrices[idx] = e.price;
    hmYOffsets[idx] = 0;
    hmSizes[idx] = e.size;
    hmSides[idx] = 0;
    hmBrightness[idx] = maxLevelSize > 0 ? e.size / maxLevelSize : 0.5;
    hmTimestamps[idx] = now;
    if (e.size > maxCumSize) maxCumSize = e.size;
    idx++;
  }

  for (const e of askEntries) {
    hmPrices[idx] = e.price;
    hmYOffsets[idx] = 0;
    hmSizes[idx] = e.size;
    hmSides[idx] = 1;
    hmBrightness[idx] = maxLevelSize > 0 ? e.size / maxLevelSize : 0.5;
    hmTimestamps[idx] = now;
    if (e.size > maxCumSize) maxCumSize = e.size;
    idx++;
  }

  let dataPriceMin = Infinity;
  let dataPriceMax = -Infinity;
  for (let i = 0; i < hmCount; i++) {
    if (hmPrices[i] < dataPriceMin) dataPriceMin = hmPrices[i];
    if (hmPrices[i] > dataPriceMax) dataPriceMax = hmPrices[i];
  }
  if (dataPriceMin === Infinity) dataPriceMin = 0;
  if (dataPriceMax === -Infinity) dataPriceMax = 0;

  const lastRebuildMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    data: {
      meta,
      bids: { prices: bidPrices, sizes: bidSizes, cumSizes: bidCumSizes },
      asks: { prices: askPrices, sizes: askSizes, cumSizes: askCumSizes },
      heatmap: {
        prices: hmPrices,
        yOffsets: hmYOffsets,
        sizes: hmSizes,
        sides: hmSides,
        brightness: hmBrightness,
        timestamps: hmTimestamps,
        users: hmUsers,
        maxCumSize,
        count: hmCount,
        timestampMin: now,
        timestampMax: now,
        tickSize: cachedTickSize,
        dataPriceMin,
        dataPriceMax,
      },
    },
    metrics: {
      orderCount: hmCount,
      bidLevelCount: bidEntries.length,
      askLevelCount: askEntries.length,
      lastRebuildMs,
      wsMessages,
      l3Polls,
      l3Enabled,
      rebuildIntervalMs: rpcMode ? rpcPollIntervalMs : rebuildIntervalMs,
    },
  };
}

// === Perpl WS message handling ===

function applyL2Levels(levels: L2Level[], side: 'bid' | 'ask') {
  const map = side === 'bid' ? bidMap : askMap;
  for (const lvl of levels) {
    const price = pnsToPrice(lvl.p);
    const size = scaledToSize(lvl.s);
    if (size <= 0 || lvl.o === 0) {
      map.delete(price);
    } else {
      map.set(price, { size, orders: lvl.o });
    }
  }
}

function handleL2Snapshot(msg: any) {
  bidMap.clear();
  askMap.clear();
  if (msg.perpId) meta.perpId = msg.perpId;
  applyL2Levels(msg.bid || [], 'bid');
  applyL2Levels(msg.ask || [], 'ask');

  const allPrices = [
    ...Array.from(bidMap.keys()),
    ...Array.from(askMap.keys()),
  ].sort((a, b) => a - b);

  if (allPrices.length >= 2) {
    let minDiff = Infinity;
    for (let i = 1; i < allPrices.length; i++) {
      const diff = allPrices[i] - allPrices[i - 1];
      if (diff > 1e-9 && diff < minDiff) minDiff = diff;
    }
    if (minDiff < Infinity) {
      cachedTickSize = Math.round(minDiff * 1e8) / 1e8;
    }
  }

  dirty = true;
  const result = buildSnapshotView();
  if (result) {
    const msg2 = { type: 'snapshot' as const, ...result };
    self.postMessage(msg2, { transfer: getTransferList(msg2) } as any);
    dirty = false;
  }
}

function handleL2Update(msg: any) {
  applyL2Levels(msg.bid || [], 'bid');
  applyL2Levels(msg.ask || [], 'ask');
  dirty = true;
}

function handleTrades(msg: any) {
  // mt=17/18: { d: Trade[] } where Trade = { at, p, s, sd }
  // sd: 1=Buy, 2=Sell
  const trades: any[] = msg.d || [];
  for (const t of trades) {
    const trade: TradeEntry = {
      price: pnsToPrice(t.p),
      size: scaledToSize(t.s),
      side: t.sd === 1 ? 'buy' : 'sell',
      timestamp: t.at?.t || Date.now(),
    };
    self.postMessage({ type: 'trade', trade });
  }
}

function handleMarketState(msg: any) {
  // mt=9: { d: Record<MarketID, { orl, mrk, lst, mid, bid, ask, ... }> }
  const markets = msg.d;
  if (markets && typeof markets === 'object') {
    const marketData = markets[meta.perpId] || markets[String(meta.perpId)];
    if (marketData) {
      if (marketData.mrk != null) meta.markPrice = pnsToPrice(marketData.mrk);
      if (marketData.orl != null) meta.oraclePrice = pnsToPrice(marketData.orl);
    }
  }
}

function handleHeartbeat(msg: any) {
  // mt=100: { h: number } — latest head block number
  if (msg.h) meta.blockHeight = msg.h;
}

function handleWsMessage(event: MessageEvent) {
  wsMessages++;
  let parsed: any;
  try {
    parsed = JSON.parse(event.data as string);
  } catch {
    return;
  }
  switch (parsed.mt) {
    case 2: break; // Pong
    case 15: handleL2Snapshot(parsed); break;
    case 16: handleL2Update(parsed); break;
    case 17: case 18: handleTrades(parsed); break;
    case 9: handleMarketState(parsed); break;
    case 100: handleHeartbeat(parsed); break;
  }
}

// === RPC book polling (Cloudflare fallback) ===

// Function selectors (precomputed keccak256)
const SEL_GET_PERP_INFO = '0x00092cce';          // getPerpetualInfo(uint256)
const SEL_VOLUME_AT_PRICE = '0xfe37fe12';         // getVolumeAtBookPrice(uint256,uint256)
const SEL_NEXT_PRICE_BELOW = '0xfb455f6b';        // getNextPriceBelowWithOrders(uint256,uint256)

function encodeUint256(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

function encodeCall(selector: string, ...args: bigint[]): string {
  return selector + args.map(encodeUint256).join('');
}

async function ethCall(to: string, data: string, rpc: string): Promise<string> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
      id: 1,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'eth_call failed');
  return json.result as string;
}

async function ethBlockNumber(rpc: string): Promise<number> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
  });
  const json = await res.json();
  return parseInt(json.result, 16);
}

function decodeUint256(hex: string, offset: number): bigint {
  return BigInt('0x' + hex.slice(offset, offset + 64));
}

function decodeInt16(hex: string, offset: number): number {
  const val = Number(BigInt('0x' + hex.slice(offset, offset + 64)));
  return val > 32767 ? val - 65536 : val;
}

interface PerpInfoResult {
  priceDecimals: bigint;
  lotDecimals: bigint;
  basePricePNS: bigint;
  markPNS: bigint;
  oraclePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
  maxAskPriceONS: bigint;
}

function decodePerpInfo(result: string): PerpInfoResult {
  // getPerpetualInfo returns a tuple with many fields. We skip the offset pointer (first 64 hex = 32 bytes).
  // The struct starts at offset 0x40 (after the ABI encoding offset pointer).
  const hex = result.slice(2); // remove '0x'

  // The result is an ABI-encoded tuple. First 64 chars is the offset to the struct data.
  // The struct is: name(string), symbol(string), priceDecimals, lotDecimals, ...
  // Dynamic types (strings) make this complex. Let's decode positionally.
  //
  // ABI layout for tuple: offset pointer (word 0) -> actual data at that offset
  // At the offset: each field is a word (32 bytes), with dynamic types being offsets themselves.
  //
  // Simpler: parse from known positions
  // word 0: offset to tuple data (0x20 = 32, pointing to word 1)
  // word 1: offset to name string (relative to tuple start)
  // word 2: offset to symbol string (relative to tuple start)
  // word 3: priceDecimals
  // word 4: lotDecimals
  // word 5: linkFeedId
  // word 6: priceTolPer100K
  // word 7: marginTol
  // word 8: marginTolDecimals
  // word 9: refPriceMaxAgeSec
  // word 10: positionBalanceCNS
  // word 11: insuranceBalanceCNS
  // word 12: markPNS
  // word 13: markTimestamp
  // word 14: lastPNS
  // word 15: lastTimestamp
  // word 16: oraclePNS
  // word 17: oracleTimestampSec
  // word 18: longOpenInterestLNS
  // word 19: shortOpenInterestLNS
  // word 20: fundingStartBlock
  // word 21: fundingRatePct100k (int16, but encoded as word)
  // word 22: absFundingClampPctPer100K
  // word 23: status (uint8)
  // word 24: basePricePNS
  // word 25: maxBidPriceONS
  // word 26: minBidPriceONS
  // word 27: maxAskPriceONS
  // word 28: minAskPriceONS

  // word 0 is the outer tuple offset pointer
  const outerOffset = Number(decodeUint256(hex, 0));
  // Tuple data starts at outerOffset bytes = outerOffset*2 hex chars
  const base = outerOffset * 2;

  // Words within the tuple (each 64 hex chars):
  // word 0,1 are offsets for name/symbol strings
  // word 2 onwards are the fixed fields
  const w = (i: number) => decodeUint256(hex, base + i * 64);

  // Struct field indices (0-indexed from struct start, after outer offset pointer):
  // 0:name, 1:symbol, 2:priceDecimals, 3:lotDecimals, 4:linkFeedId,
  // 5:priceTolPer100K, 6:marginTol, 7:marginTolDecimals, 8:refPriceMaxAgeSec,
  // 9:positionBalanceCNS, 10:insuranceBalanceCNS, 11:markPNS, 12:markTimestamp,
  // 13:lastPNS, 14:lastTimestamp, 15:oraclePNS, 16:oracleTimestampSec,
  // 17:longOI, 18:shortOI, 19:fundingStartBlock, 20:fundingRatePct100k,
  // 21:absFundingClamp, 22:status, 23:basePricePNS, 24:maxBidPriceONS,
  // 25:minBidPriceONS, 26:maxAskPriceONS, 27:minAskPriceONS, 28:numOrders, 29:ignOracle
  return {
    priceDecimals: w(2),
    lotDecimals: w(3),
    markPNS: w(11),
    oraclePNS: w(15),
    basePricePNS: w(23),
    maxBidPriceONS: w(24),
    minAskPriceONS: w(27),
    maxAskPriceONS: w(26),
  };
}

interface VolumeResult {
  bids: bigint;
  asks: bigint;
}

function decodeVolume(result: string): VolumeResult {
  const hex = result.slice(2);
  return {
    bids: decodeUint256(hex, 0),       // bids
    asks: decodeUint256(hex, 128),      // asks (skip expBids at word 1)
  };
}

function decodeNextPrice(result: string): bigint {
  const hex = result.slice(2);
  return decodeUint256(hex, 0);
}

async function rpcPollBook() {
  if (!rpcUrl || !exchangeAddress || !pendingPerpId) return;

  try {
    l3Polls++;
    const perpIdBig = BigInt(pendingPerpId);

    // Step 1: Get perpetual info
    const perpInfoHex = await ethCall(
      exchangeAddress,
      encodeCall(SEL_GET_PERP_INFO, perpIdBig),
      rpcUrl,
    );
    const info = decodePerpInfo(perpInfoHex);

    priceDecimals = Number(info.priceDecimals);
    lotDecimals = Number(info.lotDecimals);
    basePricePNS = info.basePricePNS;

    meta.markPrice = pnsBigToPrice(info.markPNS, info.priceDecimals);
    meta.oraclePrice = pnsBigToPrice(info.oraclePNS, info.priceDecimals);

    // Get block number
    meta.blockHeight = await ethBlockNumber(rpcUrl);

    // Step 2: Walk bid side (from maxBidPriceONS downward)
    const newBidMap = new Map<number, { size: number; orders: number }>();
    let currentONS = info.maxBidPriceONS;
    const maxBidLevels = 40;

    for (let i = 0; i < maxBidLevels && currentONS > 0n; i++) {
      // Get volume at this price
      const volHex = await ethCall(
        exchangeAddress,
        encodeCall(SEL_VOLUME_AT_PRICE, perpIdBig, currentONS),
        rpcUrl,
      );
      const vol = decodeVolume(volHex);

      if (vol.bids > 0n) {
        const pns = basePricePNS + currentONS;
        const price = pnsBigToPrice(pns, info.priceDecimals);
        const size = Number(vol.bids) / Math.pow(10, lotDecimals);
        newBidMap.set(price, { size, orders: 1 }); // orders unknown in L2 RPC mode
      }

      // Get next price below
      const nextHex = await ethCall(
        exchangeAddress,
        encodeCall(SEL_NEXT_PRICE_BELOW, perpIdBig, currentONS),
        rpcUrl,
      );
      const nextONS = decodeNextPrice(nextHex);
      if (nextONS === 0n || nextONS >= currentONS) break;
      currentONS = nextONS;
    }

    // Step 3: Walk ask side (from maxAskPriceONS downward, collecting asks)
    const newAskMap = new Map<number, { size: number; orders: number }>();
    currentONS = info.maxAskPriceONS;
    const maxAskLevels = 40;

    for (let i = 0; i < maxAskLevels && currentONS > 0n; i++) {
      const volHex = await ethCall(
        exchangeAddress,
        encodeCall(SEL_VOLUME_AT_PRICE, perpIdBig, currentONS),
        rpcUrl,
      );
      const vol = decodeVolume(volHex);

      if (vol.asks > 0n) {
        const pns = basePricePNS + currentONS;
        const price = pnsBigToPrice(pns, info.priceDecimals);
        const size = Number(vol.asks) / Math.pow(10, lotDecimals);
        newAskMap.set(price, { size, orders: 1 });
      }

      const nextHex = await ethCall(
        exchangeAddress,
        encodeCall(SEL_NEXT_PRICE_BELOW, perpIdBig, currentONS),
        rpcUrl,
      );
      const nextONS = decodeNextPrice(nextHex);
      if (nextONS === 0n || nextONS >= currentONS) break;
      currentONS = nextONS;
    }

    // Compute tick size
    const allPrices = [
      ...Array.from(newBidMap.keys()),
      ...Array.from(newAskMap.keys()),
    ].sort((a, b) => a - b);

    if (allPrices.length >= 2) {
      let minDiff = Infinity;
      for (let i = 1; i < allPrices.length; i++) {
        const diff = allPrices[i] - allPrices[i - 1];
        if (diff > 1e-9 && diff < minDiff) minDiff = diff;
      }
      if (minDiff < Infinity) {
        cachedTickSize = Math.round(minDiff * 1e8) / 1e8;
      }
    }

    // Update maps
    bidMap.clear();
    for (const [k, v] of newBidMap) bidMap.set(k, v);
    askMap.clear();
    for (const [k, v] of newAskMap) askMap.set(k, v);

    meta.timestamp = Date.now();

    // Build and send snapshot
    const result = buildSnapshotView();
    if (result) {
      // First poll sends 'snapshot', subsequent send 'update'
      const isFirst = l3Polls === 1;
      const msg = { type: (isFirst ? 'snapshot' : 'update') as 'snapshot' | 'update', ...result };
      self.postMessage(msg, { transfer: getTransferList(msg) } as any);
    }
  } catch (err: any) {
    console.error('RPC poll error:', err);
    // Don't send error status for transient RPC failures, just skip this poll
  }
}

function startRpcPolling() {
  stopRpcPolling();
  rpcMode = true;
  self.postMessage({ type: 'status', status: 'rpc-polling', message: 'WS blocked by Cloudflare, using RPC polling' });

  // Do first poll immediately
  rpcPollBook();

  rpcPollTimer = setInterval(() => {
    rpcPollBook();
  }, rpcPollIntervalMs);
}

function stopRpcPolling() {
  if (rpcPollTimer !== null) {
    clearInterval(rpcPollTimer);
    rpcPollTimer = null;
  }
  rpcMode = false;
}

// === Rebuild timer (WS mode) ===

function startRebuildInterval() {
  stopRebuildInterval();
  rebuildTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const result = buildSnapshotView();
    if (result) {
      const msg = { type: 'update' as const, ...result };
      self.postMessage(msg, { transfer: getTransferList(msg) } as any);
    }
  }, rebuildIntervalMs);
}

function stopRebuildInterval() {
  if (rebuildTimer !== null) {
    clearInterval(rebuildTimer);
    rebuildTimer = null;
  }
}

// === Connection management ===

function clearReconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs(pendingWsUrl, pendingRpcUrl, pendingPerpId, pendingMarket);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ mt: 1, t: Date.now() }));
    }
  }, 30000);
}

function stopPing() {
  if (pingInterval !== null) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function switchToRpcMode() {
  disconnectWs();
  rpcUrl = pendingRpcUrl;
  exchangeAddress = pendingExchangeAddress;

  meta = {
    market: pendingMarket,
    perpId: pendingPerpId,
    blockHeight: 0,
    markPrice: 0,
    oraclePrice: 0,
    timestamp: Date.now(),
  };

  startRpcPolling();
}

function connectWs(wsUrl: string, _rpcUrl: string, perpId: number, market: string) {
  disconnectWs();
  pendingWsUrl = wsUrl;
  pendingRpcUrl = _rpcUrl;
  pendingPerpId = perpId;
  pendingMarket = market;
  wsMessages = 0;
  l3Polls = 0;

  meta = {
    market,
    perpId,
    blockHeight: 0,
    markPrice: 0,
    oraclePrice: 0,
    timestamp: Date.now(),
  };

  // If we've already failed enough times, go straight to RPC
  if (wsFailCount >= WS_FAIL_THRESHOLD) {
    switchToRpcMode();
    return;
  }

  self.postMessage({ type: 'status', status: 'connecting' });

  try {
    ws = new WebSocket(wsUrl);
  } catch (err: any) {
    wsFailCount++;
    self.postMessage({ type: 'status', status: 'error', message: err.message });
    if (wsFailCount >= WS_FAIL_THRESHOLD) {
      switchToRpcMode();
    } else {
      scheduleReconnect();
    }
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000;
    wsFailCount = 0;
    self.postMessage({ type: 'status', status: 'connected' });

    const chainId = pendingChainId;
    const subs = [
      { stream: `order-book@${perpId}`, subscribe: true },
      { stream: `trades@${perpId}`, subscribe: true },
      { stream: `market-state@${chainId}`, subscribe: true },
      { stream: `heartbeat@${chainId}`, subscribe: true },
    ];

    ws!.send(JSON.stringify({ mt: 5, subs }));
    self.postMessage({ type: 'status', status: 'subscribed' });
    startPing();
    startRebuildInterval();
  };

  ws.onmessage = handleWsMessage;

  ws.onclose = (event) => {
    stopRebuildInterval();
    stopPing();

    // Code 1006 with no prior open = connection rejected (likely CF 403)
    if (event.code === 1006 && wsMessages === 0) {
      wsFailCount++;
      if (wsFailCount >= WS_FAIL_THRESHOLD) {
        switchToRpcMode();
        return;
      }
    }

    self.postMessage({ type: 'status', status: 'disconnected' });
    scheduleReconnect();
  };

  ws.onerror = () => {
    stopRebuildInterval();
    stopPing();
    // Don't increment wsFailCount here — onclose will fire too
    self.postMessage({ type: 'status', status: 'error', message: 'WebSocket error' });
  };
}

function disconnectWs() {
  clearReconnect();
  stopRebuildInterval();
  stopRpcPolling();
  stopPing();
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  bidMap.clear();
  askMap.clear();
  dirty = false;
}

// === Message handler ===

self.onmessage = (e: MessageEvent<BookWorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'connect':
      pendingExchangeAddress = msg.exchangeAddress;
      pendingChainId = msg.chainId;
      wsFailCount = 0; // Reset on new connection attempt
      connectWs(msg.wsUrl, msg.rpcUrl, msg.perpId, msg.market);
      break;
    case 'disconnect':
      disconnectWs();
      self.postMessage({ type: 'status', status: 'idle' });
      break;
    case 'setRebuildInterval':
      rebuildIntervalMs = msg.intervalMs;
      if (rebuildTimer !== null) startRebuildInterval();
      break;
    case 'setL3':
      l3Enabled = msg.enabled;
      break;
  }
};
