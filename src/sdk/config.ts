/**
 * Configuration and environment setup
 */

import { type Address, type Chain, defineChain } from "viem";
import "dotenv/config";
import type { ApiConfig } from "./api/types.js";

/**
 * Monad Testnet chain definition
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Monad",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

/**
 * Chain configuration
 */
export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  exchangeAddress: Address;
  collateralToken: Address;
}

/**
 * Get chain configuration from environment
 */
export function getChainConfig(): ChainConfig {
  const rpcUrl = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
  const exchangeAddress = (process.env.EXCHANGE_ADDRESS ??
    "0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7") as Address;
  const collateralToken = (process.env.COLLATERAL_TOKEN ??
    "0xdF5B718d8FcC173335185a2a1513eE8151e3c027") as Address;

  return {
    chain: monadTestnet,
    rpcUrl,
    exchangeAddress,
    collateralToken,
  };
}

/**
 * Get owner private key from environment
 */
export function getOwnerPrivateKey(): `0x${string}` {
  const key = process.env.OWNER_PRIVATE_KEY;
  if (!key) {
    throw new Error("OWNER_PRIVATE_KEY environment variable is required");
  }
  if (!key.startsWith("0x")) {
    return `0x${key}` as `0x${string}`;
  }
  return key as `0x${string}`;
}

/**
 * Get operator private key from environment
 */
export function getOperatorPrivateKey(): `0x${string}` {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!key) {
    throw new Error("OPERATOR_PRIVATE_KEY environment variable is required");
  }
  if (!key.startsWith("0x")) {
    return `0x${key}` as `0x${string}`;
  }
  return key as `0x${string}`;
}

/**
 * Get delegated account address from environment (optional)
 */
export function getDelegatedAccountAddress(): Address | undefined {
  const address = process.env.DELEGATED_ACCOUNT_ADDRESS;
  if (!address) return undefined;
  return address as Address;
}

/**
 * Full environment configuration
 */
export interface EnvConfig {
  chain: ChainConfig;
  ownerPrivateKey?: `0x${string}`;
  operatorPrivateKey?: `0x${string}`;
  delegatedAccountAddress?: Address;
}

/**
 * Load full configuration from environment
 * Doesn't throw on missing keys - allows partial config
 */
export function loadEnvConfig(): EnvConfig {
  const chain = getChainConfig();

  let ownerPrivateKey: `0x${string}` | undefined;
  let operatorPrivateKey: `0x${string}` | undefined;

  try {
    ownerPrivateKey = getOwnerPrivateKey();
  } catch {
    // Owner key not configured
  }

  try {
    operatorPrivateKey = getOperatorPrivateKey();
  } catch {
    // Operator key not configured
  }

  return {
    chain,
    ownerPrivateKey,
    operatorPrivateKey,
    delegatedAccountAddress: getDelegatedAccountAddress(),
  };
}

/**
 * Validate that required config is present for owner operations
 */
export function validateOwnerConfig(config: EnvConfig): asserts config is EnvConfig & {
  ownerPrivateKey: `0x${string}`;
} {
  if (!config.ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY is required for owner operations");
  }
}

/**
 * Validate that required config is present for operator operations
 */
export function validateOperatorConfig(config: EnvConfig): asserts config is EnvConfig & {
  operatorPrivateKey: `0x${string}`;
  delegatedAccountAddress: Address;
} {
  if (!config.operatorPrivateKey) {
    throw new Error("OPERATOR_PRIVATE_KEY is required for operator operations");
  }
  if (!config.delegatedAccountAddress) {
    throw new Error("DELEGATED_ACCOUNT_ADDRESS is required for operator operations");
  }
}

// === API Configuration ===

/**
 * Default API configuration for Perpl testnet
 */
export const API_CONFIG: ApiConfig = {
  baseUrl: process.env.PERPL_API_URL || "https://testnet.perpl.xyz/api",
  wsUrl: process.env.PERPL_WS_URL || "wss://testnet.perpl.xyz",
  chainId: 10143,
};

/**
 * Feature flag to enable/disable API usage
 * Set PERPL_USE_API=false to disable API and use contract calls only
 */
export const USE_API = process.env.PERPL_USE_API !== "false";

/**
 * Get API configuration from environment
 */
export function getApiConfig(): ApiConfig {
  return {
    baseUrl: process.env.PERPL_API_URL || "https://testnet.perpl.xyz/api",
    wsUrl: process.env.PERPL_WS_URL || "wss://testnet.perpl.xyz",
    chainId: parseInt(process.env.CHAIN_ID || "10143", 10),
  };
}
