#!/usr/bin/env node
/**
 * PerplBot CLI
 * Command-line interface for automated trading on Perpl
 */

import { Command } from "commander";
import { registerTradeCommand } from "./trade.js";
import { registerManageCommand } from "./manage.js";
import { registerShowCommand } from "./show.js";
import { registerDebugCommand } from "./debug.js";
import { registerSimulateCommand } from "./simulate.js";

const program = new Command();

program
  .name("perpl")
  .description("AI agent toolkit for automated trading on Perpl (perpetual DEX on Monad)")
  .version("0.1.0")
  .option("--no-api", "Disable API mode, use contract calls only");

// Register commands
registerTradeCommand(program);
registerManageCommand(program);
registerShowCommand(program);
registerDebugCommand(program);
registerSimulateCommand(program);

// Parse and execute
program.parse();
