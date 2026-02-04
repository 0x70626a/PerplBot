/**
 * Shared API client for bot handlers
 * Provides HybridClient instances with API-first reads and contract fallback
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadEnvConfig,
  Exchange,
  HybridClient,
  PerplApiClient,
  API_CONFIG,
  USE_API,
} from "../sdk/index.js";

// Singleton API client
let apiClient: PerplApiClient | null = null;
let isAuthenticated = false;

/**
 * Get or create the API client singleton
 */
export function getApiClient(): PerplApiClient {
  if (!apiClient) {
    console.log("[API] Creating PerplApiClient");
    console.log(`[API] Base URL: ${API_CONFIG.baseUrl}`);
    console.log(`[API] WS URL: ${API_CONFIG.wsUrl}`);
    console.log(`[API] USE_API: ${USE_API}`);
    apiClient = new PerplApiClient(API_CONFIG);
  }
  return apiClient;
}

/**
 * Authenticate the API client with the owner wallet
 */
export async function ensureAuthenticated(): Promise<void> {
  if (isAuthenticated && apiClient?.isAuthenticated()) {
    return;
  }

  const config = loadEnvConfig();
  if (!config.ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY not set");
  }

  const client = getApiClient();
  const account = privateKeyToAccount(config.ownerPrivateKey as `0x${string}`);

  console.log(`[API] Authenticating wallet: ${account.address}`);

  const signMessage = async (message: string) => {
    return account.signMessage({ message });
  };

  await client.authenticate(account.address, signMessage);
  isAuthenticated = true;
  console.log("[API] Authentication successful");
}

/**
 * Create a HybridClient with API-first reads and contract fallback
 */
export async function createHybridClient(options?: {
  withWalletClient?: boolean;
  authenticate?: boolean;
}): Promise<HybridClient> {
  const config = loadEnvConfig();
  const { withWalletClient = false, authenticate = true } = options ?? {};

  // Create public client
  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Create wallet client if needed
  let walletClient;
  if (withWalletClient && config.ownerPrivateKey) {
    const account = privateKeyToAccount(config.ownerPrivateKey as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain: config.chain.chain,
      transport: http(config.chain.rpcUrl),
    });
  }

  // Get API client and authenticate if enabled
  let apiClient: PerplApiClient | undefined;
  if (USE_API) {
    apiClient = getApiClient();
    if (authenticate) {
      try {
        await ensureAuthenticated();
      } catch (error) {
        console.log(`[API] Auth failed, using contract fallback: ${error}`);
        apiClient = undefined;
      }
    }
  }

  // Create Exchange (SDK-only, no API)
  const exchange = new Exchange(
    config.chain.exchangeAddress,
    publicClient,
    walletClient
  );

  // Wrap in HybridClient
  const hybrid = new HybridClient({
    exchange,
    apiClient,
  });

  console.log(`[HybridClient] Created, API enabled: ${hybrid.isApiEnabled()}`);

  return hybrid;
}

/**
 * Create an Exchange instance (for backwards compatibility)
 * @deprecated Use createHybridClient instead
 */
export async function createExchange(options?: {
  withWalletClient?: boolean;
  authenticate?: boolean;
}): Promise<Exchange> {
  const hybrid = await createHybridClient(options);
  return hybrid.getExchange();
}

/**
 * Clear authentication (for reconnection)
 */
export function clearAuth(): void {
  if (apiClient) {
    apiClient.clearAuth();
  }
  isAuthenticated = false;
  console.log("[API] Auth cleared");
}

// ============================================
// Multi-User Mode Functions
// ============================================

import type { User } from "./db/schema.js";
import type { Address } from "viem";

/**
 * Create a HybridClient for a specific user's DelegatedAccount
 * Uses the bot's operator wallet to execute trades on the user's behalf
 */
export async function createHybridClientForUser(user: User): Promise<HybridClient> {
  if (!user.delegatedAccount) {
    throw new Error("User does not have a DelegatedAccount set");
  }

  const config = loadEnvConfig();

  // Get bot operator private key
  const operatorKey = process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!operatorKey) {
    throw new Error("BOT_OPERATOR_PRIVATE_KEY not configured");
  }

  const operatorPrivateKey = operatorKey.startsWith("0x")
    ? (operatorKey as `0x${string}`)
    : (`0x${operatorKey}` as `0x${string}`);

  // Create public client
  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Create wallet client with bot operator account
  const account = privateKeyToAccount(operatorPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Get API client (authentication is per-wallet, so don't authenticate for user)
  let apiClientForUser: PerplApiClient | undefined;
  if (USE_API) {
    // Note: API auth is wallet-specific, so for user queries we may need
    // to authenticate with the user's wallet or skip API for certain calls
    apiClientForUser = getApiClient();
    // We don't authenticate here - the API client may already be authenticated
    // with the owner wallet, or user-specific queries may need different auth
  }

  // Create Exchange with DelegatedAccount as the "from" address
  // When writing through the Exchange, transactions go to the DelegatedAccount
  // which then forwards them to the Exchange contract
  const exchange = new Exchange(
    config.chain.exchangeAddress,
    publicClient,
    walletClient,
    user.delegatedAccount as Address
  );

  // Wrap in HybridClient
  const hybrid = new HybridClient({
    exchange,
    apiClient: apiClientForUser,
  });

  console.log(`[HybridClient] Created for user ${user.telegramId}`);
  console.log(`[HybridClient]   DelegatedAccount: ${user.delegatedAccount}`);
  console.log(`[HybridClient]   Operator: ${account.address}`);

  return hybrid;
}

/**
 * Verify that the bot operator is authorized on a DelegatedAccount
 */
export async function verifyOperatorStatus(
  delegatedAccountAddress: string
): Promise<boolean> {
  const operatorKey = process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!operatorKey) {
    return false;
  }

  const operatorPrivateKey = operatorKey.startsWith("0x")
    ? (operatorKey as `0x${string}`)
    : (`0x${operatorKey}` as `0x${string}`);

  const operatorAccount = privateKeyToAccount(operatorPrivateKey);
  const config = loadEnvConfig();

  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  try {
    // Read the DelegatedAccount contract to check if bot is an operator
    const isOperator = await publicClient.readContract({
      address: delegatedAccountAddress as Address,
      abi: [
        {
          name: "isOperator",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "operator", type: "address" }],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      functionName: "isOperator",
      args: [operatorAccount.address],
    });

    return isOperator as boolean;
  } catch (error) {
    console.error(`[verifyOperatorStatus] Error checking operator status:`, error);
    return false;
  }
}
