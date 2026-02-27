// === Network configs ===

export type NetworkConfig = {
  name: string;
  chainId: number;
  rpcUrl: string;
  wsUrl: string;       // Direct WS URL (used in production builds)
  wsProxyPath: string;  // Vite proxy path (used in dev to bypass Cloudflare)
  exchangeAddress: `0x${string}`;
  markets: { perpId: number; name: string }[];
};

/** Get the WS URL: use proxy path in dev, direct URL in prod */
export function getWsUrl(config: NetworkConfig): string {
  if (import.meta.env.DEV) {
    // In dev mode, use Vite proxy to bypass Cloudflare bot protection
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${config.wsProxyPath}`;
  }
  return config.wsUrl;
}

export const MAINNET: NetworkConfig = {
  name: 'Mainnet',
  chainId: 143,
  rpcUrl: 'https://rpc.monad.xyz',
  wsUrl: 'wss://perpl.xyz/ws/v1/market-data',
  wsProxyPath: '/ws/mainnet',
  exchangeAddress: '0x34B6552d57a35a1D042CcAe1951BD1C370112a6F',
  markets: [
    { perpId: 1, name: 'BTC-PERP' },
    { perpId: 10, name: 'ETH-PERP' },
  ],
};

export const TESTNET: NetworkConfig = {
  name: 'Testnet',
  chainId: 10143,
  rpcUrl: 'https://testnet-rpc.monad.xyz',
  wsUrl: 'wss://testnet.perpl.xyz/ws/v1/market-data',
  wsProxyPath: '/ws/testnet',
  exchangeAddress: '0x9c216d1ab3e0407b3d6f1d5e9effe6d01c326ab7',
  markets: [
    { perpId: 16, name: 'BTC-PERP' },
    { perpId: 32, name: 'ETH-PERP' },
    { perpId: 48, name: 'SOL-PERP' },
    { perpId: 64, name: 'TRUMP-PERP' },
    { perpId: 256, name: 'MON-PERP' },
  ],
};

export const NETWORKS = [MAINNET, TESTNET] as const;

// === Exchange ABI (view functions only) ===

export const ExchangeAbi = [
  {
    type: 'function',
    name: 'getPerpetualInfo',
    inputs: [{ name: 'perpId', type: 'uint256' }],
    outputs: [
      {
        name: 'perpetualInfo',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'priceDecimals', type: 'uint256' },
          { name: 'lotDecimals', type: 'uint256' },
          { name: 'linkFeedId', type: 'bytes32' },
          { name: 'priceTolPer100K', type: 'uint256' },
          { name: 'marginTol', type: 'uint256' },
          { name: 'marginTolDecimals', type: 'uint256' },
          { name: 'refPriceMaxAgeSec', type: 'uint256' },
          { name: 'positionBalanceCNS', type: 'uint256' },
          { name: 'insuranceBalanceCNS', type: 'uint256' },
          { name: 'markPNS', type: 'uint256' },
          { name: 'markTimestamp', type: 'uint256' },
          { name: 'lastPNS', type: 'uint256' },
          { name: 'lastTimestamp', type: 'uint256' },
          { name: 'oraclePNS', type: 'uint256' },
          { name: 'oracleTimestampSec', type: 'uint256' },
          { name: 'longOpenInterestLNS', type: 'uint256' },
          { name: 'shortOpenInterestLNS', type: 'uint256' },
          { name: 'fundingStartBlock', type: 'uint256' },
          { name: 'fundingRatePct100k', type: 'int16' },
          { name: 'absFundingClampPctPer100K', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'basePricePNS', type: 'uint256' },
          { name: 'maxBidPriceONS', type: 'uint256' },
          { name: 'minBidPriceONS', type: 'uint256' },
          { name: 'maxAskPriceONS', type: 'uint256' },
          { name: 'minAskPriceONS', type: 'uint256' },
          { name: 'numOrders', type: 'uint256' },
          { name: 'ignOracle', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVolumeAtBookPrice',
    inputs: [
      { name: 'perpId', type: 'uint256' },
      { name: 'priceONS', type: 'uint256' },
    ],
    outputs: [
      { name: 'bids', type: 'uint256' },
      { name: 'expBids', type: 'uint256' },
      { name: 'asks', type: 'uint256' },
      { name: 'expAsks', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNextPriceBelowWithOrders',
    inputs: [
      { name: 'perpId', type: 'uint256' },
      { name: 'priceONS', type: 'uint256' },
    ],
    outputs: [
      { name: 'priceBelowONS', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOrdersAtPriceLevel',
    inputs: [
      { name: 'perpId', type: 'uint256' },
      { name: 'priceONS', type: 'uint256' },
      { name: 'pageStartOrderId', type: 'uint256' },
      { name: 'ordersPerPage', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'ordersAtPriceLevel',
        type: 'tuple[]',
        components: [
          { name: 'accountId', type: 'uint32' },
          { name: 'orderType', type: 'uint8' },
          { name: 'priceONS', type: 'uint24' },
          { name: 'lotLNS', type: 'uint40' },
          { name: 'recycleFeeRaw', type: 'uint16' },
          { name: 'expiryBlock', type: 'uint32' },
          { name: 'leverageHdths', type: 'uint16' },
          { name: 'orderId', type: 'uint16' },
          { name: 'prevOrderId', type: 'uint16' },
          { name: 'nextOrderId', type: 'uint16' },
          { name: 'maxSlippageBps', type: 'uint16' },
        ],
      },
      { name: 'numOrders', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOrder',
    inputs: [
      { name: 'perpId', type: 'uint256' },
      { name: 'orderId', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'accountId', type: 'uint32' },
          { name: 'orderType', type: 'uint8' },
          { name: 'priceONS', type: 'uint24' },
          { name: 'lotLNS', type: 'uint40' },
          { name: 'recycleFeeRaw', type: 'uint16' },
          { name: 'expiryBlock', type: 'uint32' },
          { name: 'leverageHdths', type: 'uint16' },
          { name: 'orderId', type: 'uint16' },
          { name: 'prevOrderId', type: 'uint16' },
          { name: 'nextOrderId', type: 'uint16' },
          { name: 'maxSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;
