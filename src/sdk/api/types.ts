/**
 * Perpl API Type Definitions
 * Based on docs/api/rest-endpoints.md and docs/api/websocket.md
 */

// === Configuration ===

export interface ApiConfig {
  baseUrl: string;      // https://testnet.perpl.xyz/api
  wsUrl: string;        // wss://testnet.perpl.xyz
  chainId: number;      // 10143
}

export interface AuthState {
  nonce: string;
  cookies: string;
  authenticated: boolean;
}

// === Common Types ===

export interface BlockTimestamp {
  b: number;    // Block number
  t: number;    // Timestamp (ms)
}

export interface BlockTxLogTimestamp extends BlockTimestamp {
  tx: number;   // Transaction index
  txid: string; // Transaction hash
  l: number;    // Log index
}

// === Auth Types ===

export interface AuthPayloadRequest {
  chain_id: number;
  address: string;
}

export interface AuthPayloadResponse {
  message: string;
  nonce: string;
  issued_at: number;
  mac: string;
}

export interface AuthConnectRequest {
  chain_id: number;
  address: string;
  message: string;
  nonce: string;
  issued_at: number;
  mac: string;
  signature: string;
  ref_code?: string;
}

export interface AuthConnectResponse {
  nonce: string;
}

// === Context Types ===

export interface Chain {
  chain_id: number;
  name: string;
  rpc_url: string;
}

export interface ProtocolInstance {
  id: number;
  exchange: string;
  collateral: string;
}

export interface Token {
  id: number;
  address: string;
  symbol: string;
  decimals: number;
}

export interface MarketConfig {
  is_open: boolean;
  price_decimals: number;
  size_decimals: number;
  initial_margin: number;
  maintenance_margin: number;
  maker_fee: number;
  taker_fee: number;
  recycle_fee: number;
}

export interface Market {
  id: number;
  symbol: string;
  config: MarketConfig;
}

export interface Context {
  chain: Chain;
  instances: ProtocolInstance[];
  tokens: Token[];
  markets: Market[];
  features?: Record<string, string>;
}

// === Candle Types ===

export interface Candle {
  t: number;    // Open timestamp (ms)
  o: number;    // Open price (scaled)
  c: number;    // Close price (scaled)
  h: number;    // High price (scaled)
  l: number;    // Low price (scaled)
  v: string;    // Volume (collateral token)
  n: number;    // Number of trades
}

export interface CandleSeries {
  mt: number;
  at: BlockTimestamp;
  r: number;      // Resolution (seconds)
  d: Candle[];
}

// === Trading History Types ===

export interface HistoryPage<T> {
  d: T[];       // Data array (newest to oldest)
  np: string;   // Next page cursor
}

export enum AccountEventType {
  Unspecified = 0,
  Deposit = 1,
  Withdrawal = 2,
  IncreasePositionCollateral = 3,
  Settlement = 4,
  Liquidation = 5,
  TransferToProtocol = 6,
  TransferFromProtocol = 7,
  Funding = 8,
  Deleveraging = 9,
  Unwinding = 10,
  PositionCollateralDecreased = 11,
}

export interface AccountEvent {
  at: BlockTxLogTimestamp;
  in: number;               // Instance ID
  id: number;               // Account ID
  et: AccountEventType;     // Event type
  m?: number;               // Market ID
  r?: number;               // Request ID
  o?: number;               // Order ID
  p?: number;               // Position ID
  a: string;                // Amount change
  b: string;                // Updated balance
  lb: string;               // Locked balance
  f: string;                // Fee
}

export type AccountHistoryPage = HistoryPage<AccountEvent>;

export enum ApiOrderType {
  OpenLong = 1,
  OpenShort = 2,
  CloseLong = 3,
  CloseShort = 4,
  Cancel = 5,
  IncreasePositionCollateral = 6,
  Change = 7,
}

export enum LiquiditySide {
  Maker = 1,
  Taker = 2,
}

export interface Fill {
  at: BlockTxLogTimestamp;
  mkt: number;        // Market ID
  acc: number;        // Account ID
  oid: number;        // Order ID
  t: ApiOrderType;    // Order type
  l: LiquiditySide;   // Maker=1, Taker=2
  p?: number;         // Fill price (scaled)
  s: number;          // Filled size (scaled)
  f: string;          // Fee/rebate
}

export type FillHistoryPage = HistoryPage<Fill>;

export enum OrderStatus {
  Pending = 1,
  Open = 2,
  PartiallyFilled = 3,
  Filled = 4,
  Cancelled = 5,
  Rejected = 6,
  Expired = 7,
}

export enum OrderFlags {
  GoodTillCancel = 0,
  PostOnly = 1,
  FillOrKill = 2,
  ImmediateOrCancel = 4,
}

export interface Order {
  at: BlockTxLogTimestamp;
  c?: Record<string, unknown>;  // Client data
  rq: number;           // Request ID
  mkt: number;          // Market ID
  acc: number;          // Account ID
  oid: number;          // Order ID
  scid: number;         // Subclient ID
  st: OrderStatus;      // Status
  sr: number;           // Status reason
  t: ApiOrderType;      // Order type
  p: number;            // Price
  os: number;           // Original size
  fp?: number;          // Fill price
  fs?: number;          // Filled size
  f: string;            // Fee
  fl: OrderFlags;       // Flags
  mm: number;           // Min match
  lv: number;           // Leverage (hundredths)
  r?: boolean;          // Remove flag (for updates)
}

export type OrderHistoryPage = HistoryPage<Order>;

export enum PositionStatus {
  Open = 1,
  Closed = 2,
  Liquidated = 3,
}

export enum PositionSide {
  Long = 1,
  Short = 2,
}

export interface Position {
  at: BlockTxLogTimestamp;
  mkt: number;          // Market ID
  acc: number;          // Account ID
  pid: number;          // Position ID
  rq: number;           // Request ID
  oid: number;          // Order ID
  st: PositionStatus;   // Status
  sr: number;           // Status reason
  sd: PositionSide;     // Side (1=Long, 2=Short)
  c: string;            // Collateral
  ep: number;           // Entry price
  s: number;            // Size
  fee: string;          // Total fee
  efs: number;          // Entry fee size
  lv: number;           // Leverage (hundredths)
  dpnl: string;         // Delta PnL
  fnd: string;          // Funding
  xp?: number;          // Exit price
  xfs?: number;         // Exit fee size
  ots?: Record<string, unknown>;  // OT state
  e?: unknown;          // Extra
}

export type PositionHistoryPage = HistoryPage<Position>;

// === Profile Types ===

export interface RefCode {
  code: string;
  limit: number;
  used: number;
}

export interface ContactInfo {
  contact: string;
  x_challenge: string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
}

export interface AnnouncementsResponse {
  ver: number;
  active: Announcement[];
}

// === WebSocket Types ===

export enum MessageType {
  Ping = 1,
  Pong = 2,
  StatusResponse = 3,
  AuthSignIn = 4,
  SubscriptionRequest = 5,
  SubscriptionResponse = 6,
  GasPriceUpdate = 7,
  MarketConfigUpdate = 8,
  MarketStateUpdate = 9,
  MarketFundingUpdate = 10,
  CandlesSnapshot = 11,
  CandlesUpdate = 12,
  L2BookSnapshot = 15,
  L2BookUpdate = 16,
  TradesSnapshot = 17,
  TradesUpdate = 18,
  WalletSnapshot = 19,
  WalletUpdate = 20,
  AccountUpdate = 21,
  OrderRequest = 22,
  OrdersSnapshot = 23,
  OrdersUpdate = 24,
  FillsUpdate = 25,
  PositionsSnapshot = 26,
  PositionsUpdate = 27,
  Heartbeat = 100,
}

export interface WsMessageHeader {
  mt: MessageType;
  sid?: number;     // Subscription ID
  sn?: number;      // Sequence number
  cid?: number;     // Correlation ID
  ses?: string;     // Session ID
}

export interface L2PriceLevel {
  p: number;    // Price (scaled)
  s: number;    // Size (scaled)
  o: number;    // Number of orders
}

export interface L2Book {
  mt: MessageType.L2BookSnapshot | MessageType.L2BookUpdate;
  sid: number;
  at: BlockTimestamp;
  bid: L2PriceLevel[];
  ask: L2PriceLevel[];
}

export enum TradeSide {
  Buy = 1,
  Sell = 2,
}

export interface Trade {
  at: BlockTxLogTimestamp;
  p: number;        // Price (scaled)
  s: number;        // Size (scaled)
  sd: TradeSide;    // Side
}

export interface TradeSeries {
  mt: MessageType.TradesSnapshot | MessageType.TradesUpdate;
  sid: number;
  d: Trade[];
}

export interface ApiMarketState {
  at: BlockTimestamp;
  orl: number;    // Oracle price
  mrk: number;    // Mark price
  lst: number;    // Last price
  mid: number;    // Mid price
  bid: number;    // Best bid
  ask: number;    // Best ask
  prv: number;    // Price 24h ago
  dv: number;     // Daily volume (size)
  dva: string;    // Daily volume (amount)
  oi: number;     // Open interest
  tvl: string;    // Total value locked
}

export interface ApiMarketStateUpdate {
  mt: MessageType.MarketStateUpdate;
  d: Record<number, ApiMarketState | undefined>;
}

export interface Heartbeat {
  mt: MessageType.Heartbeat;
  h: number;    // Latest head block number
}

export interface SubscriptionItem {
  stream: string;
  subscribe: boolean;
}

export interface SubscriptionRequest {
  mt: MessageType.SubscriptionRequest;
  subs: SubscriptionItem[];
}

export interface SubscriptionResponseItem {
  stream: string;
  sid?: number;
  status?: {
    code: number;
    error?: string;
  };
}

export interface SubscriptionResponse {
  mt: MessageType.SubscriptionResponse;
  subs: SubscriptionResponseItem[];
}

export interface OrderRequest {
  mt: MessageType.OrderRequest;
  rq: number;           // Request ID (strictly increasing)
  mkt: number;          // Market ID
  acc: number;          // Account ID
  oid?: number;         // Order ID (for modify/cancel)
  t: ApiOrderType;      // Order type
  p?: number;           // Limit price (0 for market)
  s: number;            // Size (scaled)
  a?: string;           // Amount (for collateral increase)
  tif?: number;         // Time-in-force block
  fl: OrderFlags;       // Flags
  tp?: number;          // Trigger price (stop/TP orders)
  tpc?: number;         // Trigger condition (1=GTE, 2=LTE)
  tr?: number;          // Linked trigger request
  lp?: number;          // Linked position ID
  lv: number;           // Leverage (hundredths)
  lb: number;           // Last execution block
}

export interface WalletAccount {
  in: number;       // Instance ID
  id: number;       // Account ID
  fr: boolean;      // Is frozen
  fw: boolean;      // Allows forwarding
  b: string;        // Balance
  lb: string;       // Locked balance
}

export interface WalletSnapshot {
  mt: MessageType.WalletSnapshot;
  as: WalletAccount[];
}

export interface WalletOrders {
  mt: MessageType.OrdersSnapshot | MessageType.OrdersUpdate;
  at: BlockTimestamp;
  d: Order[];
}

export interface WalletFills {
  mt: MessageType.FillsUpdate;
  at: BlockTimestamp;
  d: Fill[];
}

export interface WalletPositions {
  mt: MessageType.PositionsSnapshot | MessageType.PositionsUpdate;
  at: BlockTimestamp;
  d: Position[];
}

export type WsMessage =
  | L2Book
  | TradeSeries
  | CandleSeries
  | ApiMarketStateUpdate
  | Heartbeat
  | SubscriptionResponse
  | WalletSnapshot
  | WalletOrders
  | WalletFills
  | WalletPositions
  | { mt: MessageType; [key: string]: unknown };
