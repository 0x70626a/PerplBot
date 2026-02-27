// === Depth chart data ===

export type SideData = {
  prices: Float64Array;
  sizes: Float64Array;
  cumSizes: Float64Array;
};

// === Heatmap data (typed arrays, transferable from worker) ===

export type HeatmapData = {
  prices: Float32Array;       // price for each order/level
  yOffsets: Float32Array;     // cumulative size offset (bottom of each bar segment)
  sizes: Float32Array;        // size of each order (height of bar segment)
  sides: Float32Array;        // 0=bid, 1=ask
  brightness: Float32Array;   // normalized [0,1] — order age for L3, aggregate for L2
  timestamps: Float64Array;   // actual timestamp in ms per order
  users: string[];            // user address per order (empty for L2-only mode)
  maxCumSize: number;         // tallest stacked column across all price levels
  count: number;
  timestampMin: number;
  timestampMax: number;
  tickSize: number;           // minimum price increment
  dataPriceMin: number;
  dataPriceMax: number;
};

export type ViewRange = {
  priceMin: number;
  priceMax: number;
  yMin: number;
  yMax: number;
};

export type SnapshotView = {
  meta: SnapshotMeta;
  bids: SideData;
  asks: SideData;
  heatmap: HeatmapData;
};

export type SnapshotMeta = {
  market: string;
  perpId: number;
  blockHeight: number;
  markPrice: number;
  oraclePrice: number;
  timestamp: number;
};

// === Trade data ===

export type TradeEntry = {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
};

// === Metrics ===

export type StreamMetrics = {
  orderCount: number;
  bidLevelCount: number;
  askLevelCount: number;
  lastRebuildMs: number;
  wsMessages: number;
  l3Polls: number;
  l3Enabled: boolean;
  rebuildIntervalMs: number;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'disconnected' | 'error' | 'rpc-polling';

// === Worker messages ===

// Worker → Main
export type BookWorkerOutMessage =
  | { type: 'status'; status: ConnectionStatus; message?: string }
  | { type: 'snapshot'; data: SnapshotView; metrics: StreamMetrics }
  | { type: 'update'; data: SnapshotView; metrics: StreamMetrics }
  | { type: 'trade'; trade: TradeEntry };

// Main → Worker
export type BookWorkerInMessage =
  | { type: 'connect'; wsUrl: string; rpcUrl: string; perpId: number; market: string; exchangeAddress: string; chainId: number }
  | { type: 'disconnect' }
  | { type: 'setRebuildInterval'; intervalMs: number }
  | { type: 'setL3'; enabled: boolean; intervalMs?: number };

// === Perpl WS protocol types ===

export type L2Level = {
  p: number;  // price (scaled)
  s: number;  // size (scaled)
  o: number;  // num orders
};

export type L2BookSnapshot = {
  mt: 15;
  perpId: number;
  bid: L2Level[];
  ask: L2Level[];
};

export type L2BookUpdate = {
  mt: 16;
  perpId: number;
  bid: L2Level[];
  ask: L2Level[];
};

// === On-chain L3 types ===

export type L3Order = {
  orderId: number;
  accountId: number;
  orderType: number;
  priceONS: number;
  lotLNS: bigint;
  leverageHdths: number;
  expiryBlock: number;
  firstSeenMs: number;  // for age tracking
};

export type PerpInfo = {
  name: string;
  symbol: string;
  priceDecimals: bigint;
  lotDecimals: bigint;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
  markPNS: bigint;
  oraclePNS: bigint;
};
