import "dotenv/config";
delete process.env.OPERATOR_PRIVATE_KEY;
delete process.env.DELEGATED_ACCOUNT_ADDRESS;

import { createPublicClient, http } from "viem";
import { monadTestnet, getChainConfig } from "../src/sdk/config.js";
import { ExchangeAbi } from "../src/sdk/contracts/abi.js";

async function main() {
  const chainConfig = getChainConfig();
  console.log("Exchange:", chainConfig.exchangeAddress);

  const client = createPublicClient({
    chain: monadTestnet,
    transport: http(chainConfig.rpcUrl),
  });

  // Scan specific ranges that protocols commonly use
  const ranges = [
    // Low range
    ...Array.from({ length: 100 }, (_, i) => i),
    // Powers of 2
    ...Array.from({ length: 20 }, (_, i) => 2 ** i),
    // Multiples of 100
    ...Array.from({ length: 100 }, (_, i) => i * 100),
    // Multiples of 1000
    ...Array.from({ length: 20 }, (_, i) => i * 1000),
  ];
  const unique = [...new Set(ranges)].sort((a, b) => a - b);

  console.log(`Scanning ${unique.length} candidate IDs...`);

  // Process in batches of 50
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const info = await client.readContract({
          address: chainConfig.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "getPerpetualInfo",
          args: [BigInt(id)],
        });
        return { id, info };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { id, info } = r.value;
        const i = info as Record<string, unknown>;
        console.log(`FOUND PerpId ${id}: symbol=${i.symbol}, priceDecimals=${i.priceDecimals}, lotDecimals=${i.lotDecimals}, markPNS=${i.markPNS}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
