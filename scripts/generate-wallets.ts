#!/usr/bin/env npx tsx
/**
 * Generate owner and operator wallets for PerplBot
 *
 * Usage:
 *   npx tsx scripts/generate-wallets.ts
 *   npm run generate-wallets
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
const envExamplePath = path.join(process.cwd(), ".env.example");

console.log("=== PerplBot Wallet Generator ===\n");

// Generate owner wallet
const ownerPk = generatePrivateKey();
const ownerAccount = privateKeyToAccount(ownerPk);

console.log("OWNER (Cold) Wallet:");
console.log(`  Address:     ${ownerAccount.address}`);
console.log(`  Private Key: ${ownerPk}`);
console.log("");

// Generate operator wallet
const operatorPk = generatePrivateKey();
const operatorAccount = privateKeyToAccount(operatorPk);

console.log("OPERATOR (Hot) Wallet:");
console.log(`  Address:     ${operatorAccount.address}`);
console.log(`  Private Key: ${operatorPk}`);
console.log("");

// Check if .env exists
if (fs.existsSync(envPath)) {
  console.log("WARNING: .env file already exists. Not overwriting.");
  console.log("To use these wallets, manually update your .env file with the keys above.");
} else if (fs.existsSync(envExamplePath)) {
  // Create .env from .env.example with the generated keys
  let envContent = fs.readFileSync(envExamplePath, "utf8");
  envContent = envContent.replace("OWNER_PRIVATE_KEY=", `OWNER_PRIVATE_KEY=${ownerPk}`);
  envContent = envContent.replace("OPERATOR_PRIVATE_KEY=", `OPERATOR_PRIVATE_KEY=${operatorPk}`);
  fs.writeFileSync(envPath, envContent);
  console.log("Created .env file with generated wallets.");
} else {
  console.log("No .env.example found. Please create .env manually.");
}

console.log("\n=== Next Steps ===");
console.log(`1. Fund the owner wallet with testnet MON for gas`);
console.log(`   Address: ${ownerAccount.address}`);
console.log("");
console.log(`2. Get testnet USD stable for trading collateral`);
console.log("");
console.log(`3. Deploy your DelegatedAccount:`);
console.log(`   npm run dev -- deploy --operator ${operatorAccount.address} --deposit 100`);
console.log("");
console.log("SECURITY: Keep your private keys safe and never commit .env to git!");
