/**
 * Cryptographic utilities for wallet linking
 */

import { randomBytes } from "crypto";
import { verifyMessage, getAddress, isAddress } from "viem";

/**
 * Generate a random nonce for signature verification
 * @returns 32-byte hex string
 */
export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Format the message to be signed for wallet linking
 * @param timestamp - ISO timestamp (required for consistent message between sign and verify)
 */
export function formatLinkMessage(telegramId: number, nonce: string, timestamp: string): string {
  return [
    "Link wallet to PerplBot",
    "",
    `Telegram ID: ${telegramId}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
    "",
    "This signature proves you own this wallet.",
    "It does not authorize any transactions.",
  ].join("\n");
}

/**
 * Verify a signature and recover the signer address
 * @returns The recovered address (checksummed) or null if verification fails
 */
export async function verifyWalletSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<{ valid: boolean; recoveredAddress?: string; error?: string }> {
  try {
    // Ensure signature is properly formatted
    if (!signature.startsWith("0x")) {
      signature = `0x${signature}`;
    }

    // Verify and recover address
    const valid = await verifyMessage({
      address: getAddress(expectedAddress),
      message,
      signature: signature as `0x${string}`,
    });

    if (valid) {
      return {
        valid: true,
        recoveredAddress: getAddress(expectedAddress),
      };
    }

    return {
      valid: false,
      error: "Signature does not match expected address",
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown verification error",
    };
  }
}

/**
 * Validate and checksum an Ethereum address
 * @returns Checksummed address or null if invalid
 */
export function validateAddress(address: string): string | null {
  try {
    if (!isAddress(address)) {
      return null;
    }
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Link request expiry duration in milliseconds (30 minutes)
 */
export const LINK_EXPIRY_MS = 30 * 60 * 1000;
