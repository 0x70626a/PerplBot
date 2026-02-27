/**
 * Simulate command - Run strategy dry-runs against live state
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateConfig,
  PERPETUALS,
  runStrategySimulation,
  printStrategySimReport,
  strategySimResultToJson,
  type StrategySimConfig,
} from "../sdk/index.js";

// Market name to ID mapping
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
};

const PERP_IDS_TO_NAMES: Record<string, string> = {
  "16": "BTC",
  "32": "ETH",
  "48": "SOL",
  "64": "MON",
  "256": "ZEC",
};

function resolvePerpId(perp: string): bigint {
  const lower = perp.toLowerCase();
  if (PERP_NAMES[lower] !== undefined) {
    return PERP_NAMES[lower];
  }
  const parsed = parseInt(perp, 10);
  if (!isNaN(parsed)) {
    return BigInt(parsed);
  }
  throw new Error(`Unknown perpetual: ${perp}`);
}

export function registerSimulateCommand(program: Command): void {
  const simulate = program
    .command("simulate")
    .description("Run simulations against forked chain state");

  simulate
    .command("strategy")
    .description("Dry-run a trading strategy (grid or MM) against live orderbook")
    .requiredOption("--strategy <type>", "Strategy type: grid or mm")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .option("--center-price <n>", "Grid: center price (default: mark price)")
    .option("--levels <n>", "Grid: levels above/below center", "5")
    .option("--spacing <n>", "Grid: price spacing between levels")
    .option("--size <n>", "Order size per level")
    .option("--leverage <n>", "Leverage multiplier", "1")
    .option("--post-only", "Use post-only orders")
    .option("--spread <pct>", "MM: spread from mid (e.g., 0.1 for 0.1%)")
    .option("--max-position <n>", "MM: max position before skewing")
    .option("--json", "Output JSON instead of formatted report")
    .action(async (options) => {
      try {
        const config = loadEnvConfig();
        validateConfig(config);

        const strategyType = options.strategy.toLowerCase();
        if (strategyType !== "grid" && strategyType !== "mm") {
          console.error(`Unknown strategy type: ${options.strategy}. Use "grid" or "mm".`);
          process.exit(1);
        }

        const perpId = resolvePerpId(options.perp);
        const perpName = PERP_IDS_TO_NAMES[perpId.toString()] || options.perp.toUpperCase();

        const simConfig: StrategySimConfig = {
          strategyType,
          perpId,
        };

        if (strategyType === "grid") {
          if (!options.spacing) {
            console.error("--spacing is required for grid strategy");
            process.exit(1);
          }
          if (!options.size) {
            console.error("--size is required for grid strategy");
            process.exit(1);
          }
          simConfig.grid = {
            centerPrice: options.centerPrice ? parseFloat(options.centerPrice) : undefined,
            gridLevels: parseInt(options.levels, 10),
            gridSpacing: parseFloat(options.spacing),
            orderSize: parseFloat(options.size),
            leverage: parseFloat(options.leverage),
            postOnly: options.postOnly ?? false,
          };
        } else {
          // MM
          if (!options.size) {
            console.error("--size is required for MM strategy");
            process.exit(1);
          }
          if (!options.spread) {
            console.error("--spread is required for MM strategy");
            process.exit(1);
          }
          const spreadPct = parseFloat(options.spread) / 100; // Convert 0.1 → 0.001
          simConfig.mm = {
            orderSize: parseFloat(options.size),
            spreadPercent: spreadPct,
            leverage: parseFloat(options.leverage),
            maxPosition: options.maxPosition
              ? parseFloat(options.maxPosition)
              : parseFloat(options.size) * 10,
            postOnly: options.postOnly ?? false,
          };
        }

        console.log(`Running ${strategyType.toUpperCase()} strategy simulation on ${perpName}...`);
        console.log(`Forking Monad testnet...`);

        const result = await runStrategySimulation(config, simConfig);

        if (options.json) {
          console.log(JSON.stringify(strategySimResultToJson(result), null, 2));
        } else {
          printStrategySimReport(result);
        }
      } catch (error: any) {
        console.error(`Strategy simulation failed: ${error.message}`);
        process.exit(1);
      }
    });
}
