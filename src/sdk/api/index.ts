/**
 * Perpl API Client
 *
 * REST and WebSocket clients for the Perpl trading API.
 *
 * @example
 * ```typescript
 * import { PerplApiClient, PerplWebSocketClient, API_CONFIG } from './api';
 *
 * // REST client
 * const api = new PerplApiClient(API_CONFIG);
 * const context = await api.getContext();
 *
 * // Authenticate
 * await api.authenticate(address, signMessage);
 *
 * // WebSocket client (market data)
 * const ws = new PerplWebSocketClient(API_CONFIG.wsUrl);
 * await ws.connectMarketData();
 * ws.subscribeOrderBook(16); // BTC
 *
 * // WebSocket client (trading)
 * await ws.connectTrading(api.getAuthNonce()!);
 * ws.on('positions', (positions) => console.log(positions));
 * ```
 */

export { PerplApiClient, ApiError } from "./client.js";
export { PerplWebSocketClient, MessageType } from "./websocket.js";
export * from "./types.js";
