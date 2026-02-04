#!/usr/bin/env node
/**
 * PerplBot CLI
 * Command-line interface for automated trading on Perpl
 */

import { Command } from "commander";
import { registerDeployCommand } from "./deploy.js";
import { registerTradeCommand } from "./trade.js";
import { registerManageCommand } from "./manage.js";
import { registerShowCommand } from "./show.js";
import { registerDelegateCommand } from "./delegate.js";

const program = new Command();

program
  .name("perplbot")
  .description("AI agent toolkit for automated trading on Perpl (perpetual DEX on Monad)")
  .version("0.1.0")
  .option("--no-api", "Disable API mode, use contract calls only");

// Register commands
registerDeployCommand(program);
registerTradeCommand(program);
registerManageCommand(program);
registerShowCommand(program);
registerDelegateCommand(program);

// Parse and execute
program.parse();
