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
 * Monad Mainnet chain definition
 */
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "Monad",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://monadexplorer.com",
    },
  },
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
 * Check if running in testnet mode
 * Defaults to true since we only support testnet currently
 */
export const TESTNET_MODE = process.env.TESTNET_MODE !== "false";

/**
 * Get chain configuration from environment
 * Uses TESTNET_* prefixed variables for testnet, MAINNET_* for mainnet
 */
export function getChainConfig(): ChainConfig {
  if (TESTNET_MODE) {
    const rpcUrl = process.env.TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
    const exchangeAddress = (process.env.TESTNET_EXCHANGE_ADDRESS ??
      process.env.EXCHANGE_ADDRESS ??
      "0x1964C32f0bE608E7D29302AFF5E61268E72080cc") as Address;
    const collateralToken = (process.env.TESTNET_COLLATERAL_TOKEN ??
      process.env.COLLATERAL_TOKEN ??
      "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC") as Address;

    return {
      chain: monadTestnet,
      rpcUrl,
      exchangeAddress,
      collateralToken,
    };
  }

  // Mainnet
  const rpcUrl = process.env.MAINNET_RPC_URL ?? "https://rpc.monad.xyz";
  const exchangeAddress = (process.env.MAINNET_EXCHANGE_ADDRESS ??
    "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F") as Address;
  const collateralToken = (process.env.MAINNET_COLLATERAL_TOKEN ??
    "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a") as Address;

  return {
    chain: monadMainnet,
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
 * Default API configuration — derived from TESTNET_MODE
 */
export const API_CONFIG: ApiConfig = TESTNET_MODE
  ? {
      baseUrl: process.env.TESTNET_API_URL || "https://testnet.perpl.xyz/api",
      wsUrl: process.env.TESTNET_WS_URL || "wss://testnet.perpl.xyz",
      chainId: 10143,
    }
  : {
      baseUrl: process.env.MAINNET_API_URL || "https://perpl.xyz/api",
      wsUrl: process.env.MAINNET_WS_URL || "wss://perpl.xyz",
      chainId: 143,
    };

/**
 * Feature flag to enable/disable API usage
 * Set PERPL_USE_API=false to disable API and use contract calls only
 */
export const USE_API = process.env.PERPL_USE_API !== "false";

/**
 * Fallback behavior configuration
 */
export const FALLBACK_CONFIG = {
  /** Log warnings when falling back to SDK */
  logWarnings: process.env.PERPL_LOG_FALLBACK !== "false",
  /** API request timeout in milliseconds */
  apiTimeoutMs: parseInt(process.env.PERPL_API_TIMEOUT || "5000", 10),
};

/**
 * Get API configuration from environment
 */
export function getApiConfig(): ApiConfig {
  if (TESTNET_MODE) {
    return {
      baseUrl: process.env.TESTNET_API_URL || "https://testnet.perpl.xyz/api",
      wsUrl: process.env.TESTNET_WS_URL || "wss://testnet.perpl.xyz",
      chainId: parseInt(process.env.TESTNET_CHAIN_ID || "10143", 10),
    };
  }
  return {
    baseUrl: process.env.MAINNET_API_URL || "https://perpl.xyz/api",
    wsUrl: process.env.MAINNET_WS_URL || "wss://perpl.xyz",
    chainId: parseInt(process.env.MAINNET_CHAIN_ID || "143", 10),
  };
}
