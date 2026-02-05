/**
 * Key management utilities
 * Safe way to generate and manage wallet keys
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Wallet info for display (no private key)
 */
export interface WalletInfo {
  address: Address;
  type: "owner" | "operator";
  createdAt: string;
}

/**
 * Encrypted key storage format
 */
interface EncryptedKeyStore {
  version: 1;
  address: Address;
  type: "owner" | "operator";
  createdAt: string;
  encrypted: {
    ciphertext: string;
    iv: string;
    salt: string;
    authTag: string;
  };
}

/**
 * Generate a new wallet (private key + address)
 * Returns the private key - caller is responsible for secure storage
 */
export function generateWallet(): { privateKey: `0x${string}`; address: Address } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
  };
}

/**
 * Generate a cold (owner) wallet
 */
export function generateColdWallet(): {
  privateKey: `0x${string}`;
  address: Address;
  type: "owner";
} {
  const wallet = generateWallet();
  return { ...wallet, type: "owner" as const };
}

/**
 * Generate a hot (operator) wallet
 */
export function generateHotWallet(): {
  privateKey: `0x${string}`;
  address: Address;
  type: "operator";
} {
  const wallet = generateWallet();
  return { ...wallet, type: "operator" as const };
}

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
}

/**
 * Encrypt a private key with a password
 */
export function encryptPrivateKey(
  privateKey: `0x${string}`,
  password: string,
  type: "owner" | "operator"
): EncryptedKeyStore {
  const account = privateKeyToAccount(privateKey);
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let ciphertext = cipher.update(privateKey, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    address: account.address,
    type,
    createdAt: new Date().toISOString(),
    encrypted: {
      ciphertext,
      iv: iv.toString("hex"),
      salt: salt.toString("hex"),
      authTag: authTag.toString("hex"),
    },
  };
}

/**
 * Decrypt a private key with a password
 */
export function decryptPrivateKey(
  keystore: EncryptedKeyStore,
  password: string
): `0x${string}` {
  const salt = Buffer.from(keystore.encrypted.salt, "hex");
  const iv = Buffer.from(keystore.encrypted.iv, "hex");
  const authTag = Buffer.from(keystore.encrypted.authTag, "hex");
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(keystore.encrypted.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext as `0x${string}`;
}

/**
 * Save encrypted keystore to file
 */
export function saveKeystore(
  keystore: EncryptedKeyStore,
  directory: string
): string {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const filename = `${keystore.type}-${keystore.address.slice(0, 10)}.json`;
  const filepath = path.join(directory, filename);

  fs.writeFileSync(filepath, JSON.stringify(keystore, null, 2), {
    mode: 0o600, // Read/write for owner only
  });

  return filepath;
}

/**
 * Load encrypted keystore from file
 */
export function loadKeystore(filepath: string): EncryptedKeyStore {
  const content = fs.readFileSync(filepath, "utf8");
  return JSON.parse(content) as EncryptedKeyStore;
}

/**
 * List all keystores in a directory
 */
export function listKeystores(directory: string): WalletInfo[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = fs.readdirSync(directory).filter((f) => f.endsWith(".json"));
  const wallets: WalletInfo[] = [];

  for (const file of files) {
    try {
      const keystore = loadKeystore(path.join(directory, file));
      wallets.push({
        address: keystore.address,
        type: keystore.type,
        createdAt: keystore.createdAt,
      });
    } catch {
      // Skip invalid files
    }
  }

  return wallets;
}

/**
 * Secure key manager class
 * Provides a safe way to manage multiple wallets
 */
export class KeyManager {
  private readonly keystoreDir: string;

  constructor(keystoreDir: string = "./.perpl/keys") {
    this.keystoreDir = keystoreDir;
  }

  /**
   * Generate and save a new cold wallet
   */
  createColdWallet(password: string): { address: Address; keystorePath: string } {
    const wallet = generateColdWallet();
    const keystore = encryptPrivateKey(wallet.privateKey, password, "owner");
    const keystorePath = saveKeystore(keystore, this.keystoreDir);

    // Clear private key from memory
    // Note: In Node.js, we can't truly clear it, but we set it to null
    (wallet as any).privateKey = null;

    return { address: wallet.address, keystorePath };
  }

  /**
   * Generate and save a new hot wallet
   */
  createHotWallet(password: string): { address: Address; keystorePath: string } {
    const wallet = generateHotWallet();
    const keystore = encryptPrivateKey(wallet.privateKey, password, "operator");
    const keystorePath = saveKeystore(keystore, this.keystoreDir);

    (wallet as any).privateKey = null;

    return { address: wallet.address, keystorePath };
  }

  /**
   * Load a private key from keystore
   */
  loadPrivateKey(address: Address, password: string): `0x${string}` {
    const wallets = this.listWallets();
    const wallet = wallets.find(
      (w) => w.address.toLowerCase() === address.toLowerCase()
    );

    if (!wallet) {
      throw new Error(`Wallet not found: ${address}`);
    }

    // Find the keystore file
    const files = fs.readdirSync(this.keystoreDir);
    for (const file of files) {
      const filepath = path.join(this.keystoreDir, file);
      try {
        const keystore = loadKeystore(filepath);
        if (keystore.address.toLowerCase() === address.toLowerCase()) {
          return decryptPrivateKey(keystore, password);
        }
      } catch {
        continue;
      }
    }

    throw new Error(`Keystore file not found for: ${address}`);
  }

  /**
   * List all wallets
   */
  listWallets(): WalletInfo[] {
    return listKeystores(this.keystoreDir);
  }

  /**
   * Get cold (owner) wallets
   */
  getColdWallets(): WalletInfo[] {
    return this.listWallets().filter((w) => w.type === "owner");
  }

  /**
   * Get hot (operator) wallets
   */
  getHotWallets(): WalletInfo[] {
    return this.listWallets().filter((w) => w.type === "operator");
  }

  /**
   * Delete a wallet keystore
   */
  deleteWallet(address: Address): boolean {
    if (!fs.existsSync(this.keystoreDir)) {
      return false;
    }
    const files = fs.readdirSync(this.keystoreDir);
    for (const file of files) {
      const filepath = path.join(this.keystoreDir, file);
      try {
        const keystore = loadKeystore(filepath);
        if (keystore.address.toLowerCase() === address.toLowerCase()) {
          fs.unlinkSync(filepath);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }
}
