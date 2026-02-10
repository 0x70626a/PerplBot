/**
 * Chatbot entry point
 * Initializes SDK and starts HTTP server
 */

import "dotenv/config";
import { initSDK } from "./sdk-bridge.js";
import { startServer } from "./server.js";

const port = parseInt(process.env.CHATBOT_PORT || "3000", 10);

console.log("[chatbot] Initializing SDK...");
await initSDK();
startServer(port);
