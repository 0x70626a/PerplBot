import "dotenv/config";
delete process.env.OPERATOR_PRIVATE_KEY;
delete process.env.DELEGATED_ACCOUNT_ADDRESS;

import { initSDK, getMarkets } from "../src/chatbot/sdk-bridge.js";

async function main() {
  await initSDK();
  const markets = await getMarkets();
  console.log("Markets found:", markets.length);
  for (const m of markets) {
    console.log(`  ${m.market}: mark=${m.markPrice}, oracle=${m.oraclePrice}, paused=${m.paused}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
