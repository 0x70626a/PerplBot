/**
 * Crypto utilities tests
 */

import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateNonce,
  formatLinkMessage,
  verifyWalletSignature,
  validateAddress,
  LINK_EXPIRY_MS,
} from "../../src/bot/crypto.js";

describe("Crypto Utilities", () => {
  describe("generateNonce", () => {
    it("should generate 64-character hex string", () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should generate unique nonces", () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nonces.add(generateNonce());
      }
      expect(nonces.size).toBe(100);
    });
  });

  describe("formatLinkMessage", () => {
    it("should format link message with telegram ID, nonce, and timestamp", () => {
      const timestamp = "2026-02-04T18:00:00.000Z";
      const message = formatLinkMessage(123456, "abc123", timestamp);
      expect(message).toContain("Link wallet to PerplBot");
      expect(message).toContain("Telegram ID: 123456");
      expect(message).toContain("Nonce: abc123");
      expect(message).toContain(`Timestamp: ${timestamp}`);
      expect(message).toContain("This signature proves you own this wallet");
    });
  });

  describe("verifyWalletSignature", () => {
    const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);

    it("should verify valid signature", async () => {
      const message = "Test message";
      const signature = await account.signMessage({ message });

      const result = await verifyWalletSignature(
        message,
        signature,
        account.address
      );

      expect(result.valid).toBe(true);
      expect(result.recoveredAddress?.toLowerCase()).toBe(account.address.toLowerCase());
    });

    it("should reject signature from different address", async () => {
      const message = "Test message";
      const signature = await account.signMessage({ message });

      const result = await verifyWalletSignature(
        message,
        signature,
        "0x1234567890123456789012345678901234567890"
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle signature without 0x prefix", async () => {
      const message = "Test message";
      const signature = await account.signMessage({ message });
      const signatureWithoutPrefix = signature.slice(2);

      const result = await verifyWalletSignature(
        message,
        signatureWithoutPrefix,
        account.address
      );

      expect(result.valid).toBe(true);
    });

    it("should reject invalid signature", async () => {
      const result = await verifyWalletSignature(
        "Test message",
        "0xinvalidsignature",
        account.address
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("validateAddress", () => {
    it("should validate and checksum valid address", () => {
      const result = validateAddress("0x1234567890abcdef1234567890abcdef12345678");
      expect(result).toBe("0x1234567890AbcdEF1234567890aBcdef12345678");
    });

    it("should return null for invalid address", () => {
      expect(validateAddress("invalid")).toBeNull();
      expect(validateAddress("0x123")).toBeNull();
      expect(validateAddress("")).toBeNull();
    });

    it("should handle lowercase addresses", () => {
      // Viem's isAddress and getAddress work with lowercase
      const result = validateAddress("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
      expect(result).not.toBeNull();
    });
  });

  describe("LINK_EXPIRY_MS", () => {
    it("should be 30 minutes in milliseconds", () => {
      expect(LINK_EXPIRY_MS).toBe(30 * 60 * 1000);
    });
  });
});
