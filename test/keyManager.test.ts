/**
 * Tests for key management utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  generateWallet,
  generateColdWallet,
  generateHotWallet,
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeystore,
  loadKeystore,
  listKeystores,
  KeyManager,
} from "../src/sdk/wallet/keyManager.js";

describe("Wallet Generation", () => {
  it("generates a valid wallet", () => {
    const wallet = generateWallet();

    expect(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("generates unique wallets", () => {
    const wallet1 = generateWallet();
    const wallet2 = generateWallet();

    expect(wallet1.privateKey).not.toBe(wallet2.privateKey);
    expect(wallet1.address).not.toBe(wallet2.address);
  });

  it("generates cold wallet with owner type", () => {
    const wallet = generateColdWallet();

    expect(wallet.type).toBe("owner");
    expect(wallet.privateKey).toBeDefined();
    expect(wallet.address).toBeDefined();
  });

  it("generates hot wallet with operator type", () => {
    const wallet = generateHotWallet();

    expect(wallet.type).toBe("operator");
    expect(wallet.privateKey).toBeDefined();
    expect(wallet.address).toBeDefined();
  });
});

describe("Key Encryption", () => {
  const testPrivateKey =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;
  const testPassword = "test-password-123";

  it("encrypts and decrypts a private key", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");
    const decrypted = decryptPrivateKey(keystore, testPassword);

    expect(decrypted).toBe(testPrivateKey);
  });

  it("fails to decrypt with wrong password", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");

    expect(() => decryptPrivateKey(keystore, "wrong-password")).toThrow();
  });

  it("stores wallet type in keystore", () => {
    const ownerKeystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");
    const operatorKeystore = encryptPrivateKey(testPrivateKey, testPassword, "operator");

    expect(ownerKeystore.type).toBe("owner");
    expect(operatorKeystore.type).toBe("operator");
  });

  it("stores address in keystore", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");

    expect(keystore.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("stores creation timestamp", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");

    expect(keystore.createdAt).toBeDefined();
    expect(new Date(keystore.createdAt).getTime()).not.toBeNaN();
  });
});

describe("Keystore File Operations", () => {
  const testDir = "./.perpl-test-keys";
  const testPrivateKey =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;
  const testPassword = "test-password-123";

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("saves keystore to file", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");
    const filepath = saveKeystore(keystore, testDir);

    expect(fs.existsSync(filepath)).toBe(true);
  });

  it("loads keystore from file", () => {
    const keystore = encryptPrivateKey(testPrivateKey, testPassword, "owner");
    const filepath = saveKeystore(keystore, testDir);

    const loaded = loadKeystore(filepath);

    expect(loaded.address).toBe(keystore.address);
    expect(loaded.type).toBe(keystore.type);
  });

  it("lists keystores in directory", () => {
    const keystore1 = encryptPrivateKey(testPrivateKey, testPassword, "owner");
    saveKeystore(keystore1, testDir);

    const wallet2 = generateWallet();
    const keystore2 = encryptPrivateKey(wallet2.privateKey, testPassword, "operator");
    saveKeystore(keystore2, testDir);

    const wallets = listKeystores(testDir);

    expect(wallets).toHaveLength(2);
    expect(wallets.some((w) => w.type === "owner")).toBe(true);
    expect(wallets.some((w) => w.type === "operator")).toBe(true);
  });

  it("returns empty array for non-existent directory", () => {
    const wallets = listKeystores("./non-existent-dir");

    expect(wallets).toHaveLength(0);
  });
});

describe("KeyManager", () => {
  const testDir = "./.perpl-test-keymanager";
  const testPassword = "test-password-123";
  let keyManager: KeyManager;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    keyManager = new KeyManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("creates cold wallet", () => {
    const { address, keystorePath } = keyManager.createColdWallet(testPassword);

    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(fs.existsSync(keystorePath)).toBe(true);
  });

  it("creates hot wallet", () => {
    const { address, keystorePath } = keyManager.createHotWallet(testPassword);

    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(fs.existsSync(keystorePath)).toBe(true);
  });

  it("lists all wallets", () => {
    keyManager.createColdWallet(testPassword);
    keyManager.createHotWallet(testPassword);

    const wallets = keyManager.listWallets();

    expect(wallets).toHaveLength(2);
  });

  it("filters cold wallets", () => {
    keyManager.createColdWallet(testPassword);
    keyManager.createHotWallet(testPassword);

    const coldWallets = keyManager.getColdWallets();

    expect(coldWallets).toHaveLength(1);
    expect(coldWallets[0].type).toBe("owner");
  });

  it("filters hot wallets", () => {
    keyManager.createColdWallet(testPassword);
    keyManager.createHotWallet(testPassword);

    const hotWallets = keyManager.getHotWallets();

    expect(hotWallets).toHaveLength(1);
    expect(hotWallets[0].type).toBe("operator");
  });

  it("loads private key from stored wallet", () => {
    const { address } = keyManager.createColdWallet(testPassword);
    const privateKey = keyManager.loadPrivateKey(address, testPassword);

    expect(privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("throws when loading non-existent wallet", () => {
    expect(() =>
      keyManager.loadPrivateKey(
        "0x0000000000000000000000000000000000000000",
        testPassword
      )
    ).toThrow("Wallet not found");
  });

  it("deletes wallet", () => {
    const { address } = keyManager.createColdWallet(testPassword);
    expect(keyManager.listWallets()).toHaveLength(1);

    const deleted = keyManager.deleteWallet(address);

    expect(deleted).toBe(true);
    expect(keyManager.listWallets()).toHaveLength(0);
  });

  it("returns false when deleting non-existent wallet", () => {
    const deleted = keyManager.deleteWallet(
      "0x0000000000000000000000000000000000000000"
    );

    expect(deleted).toBe(false);
  });
});
