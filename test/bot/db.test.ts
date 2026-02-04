/**
 * Database tests for multi-user bot
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";

// Test database path
const TEST_DB_PATH = "./test-data/test-perplbot.db";

// Set environment before importing
process.env.DATABASE_PATH = TEST_DB_PATH;

import {
  initDatabase,
  closeDatabase,
  getDatabase,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getUserByWallet,
  getUserCount,
  createLinkRequest,
  getLinkRequest,
  deleteLinkRequest,
  cleanupExpiredRequests,
  banUser,
  unbanUser,
  isUserBanned,
} from "../../src/bot/db/index.js";

// Helper to clean up database files
function cleanupDbFiles(path: string) {
  if (existsSync(path)) rmSync(path);
  if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
  if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

describe("Database Operations", () => {
  beforeAll(() => {
    // Ensure test directory exists
    mkdirSync("./test-data", { recursive: true });
    // Clean and initialize database once
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
    initDatabase();
  });

  beforeEach(() => {
    // Clear all data between tests
    const db = getDatabase();
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM link_requests");
  });

  afterAll(() => {
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
  });

  describe("User CRUD", () => {
    it("should create and get a user", () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        isActive: true,
        isBanned: false,
      });

      const user = getUser(123456);
      expect(user).not.toBeNull();
      expect(user!.telegramId).toBe(123456);
      expect(user!.walletAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(user!.isActive).toBe(true);
      expect(user!.isBanned).toBe(false);
      expect(user!.delegatedAccount).toBeUndefined();
    });

    it("should return null for non-existent user", () => {
      const user = getUser(999999);
      expect(user).toBeNull();
    });

    it("should update user", () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        isActive: true,
        isBanned: false,
      });

      updateUser(123456, {
        delegatedAccount: "0xabcdef1234567890abcdef1234567890abcdef12",
      });

      const user = getUser(123456);
      expect(user!.delegatedAccount).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    });

    it("should delete user", () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        isActive: true,
        isBanned: false,
      });

      deleteUser(123456);
      const user = getUser(123456);
      expect(user).toBeNull();
    });

    it("should get user by wallet address (case insensitive)", () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890AbCdEf1234567890AbCdEf12345678",
        isActive: true,
        isBanned: false,
      });

      const user = getUserByWallet("0x1234567890abcdef1234567890abcdef12345678");
      expect(user).not.toBeNull();
      expect(user!.telegramId).toBe(123456);
    });

    it("should count users", () => {
      expect(getUserCount()).toBe(0);

      createUser({
        telegramId: 1,
        walletAddress: "0x1111111111111111111111111111111111111111",
        isActive: true,
        isBanned: false,
      });
      createUser({
        telegramId: 2,
        walletAddress: "0x2222222222222222222222222222222222222222",
        isActive: true,
        isBanned: false,
      });

      expect(getUserCount()).toBe(2);
    });
  });

  describe("Link Requests", () => {
    const testTimestamp = "2026-02-04T18:00:00.000Z";

    it("should create and get link request", () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      createLinkRequest({
        telegramId: 123456,
        nonce: "abc123",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        timestamp: testTimestamp,
        expiresAt,
      });

      const request = getLinkRequest(123456);
      expect(request).not.toBeNull();
      expect(request!.nonce).toBe("abc123");
      expect(request!.walletAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(request!.timestamp).toBe(testTimestamp);
    });

    it("should delete link request", () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      createLinkRequest({
        telegramId: 123456,
        nonce: "abc123",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        timestamp: testTimestamp,
        expiresAt,
      });

      deleteLinkRequest(123456);
      const request = getLinkRequest(123456);
      expect(request).toBeNull();
    });

    it("should cleanup expired requests", () => {
      // Create expired request (1 second in the past)
      const expiredAt = new Date(Date.now() - 1000);
      createLinkRequest({
        telegramId: 100,
        nonce: "expired",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        timestamp: testTimestamp,
        expiresAt: expiredAt,
      });

      // Create valid request (30 minutes in the future)
      const validAt = new Date(Date.now() + 30 * 60 * 1000);
      createLinkRequest({
        telegramId: 200,
        nonce: "valid",
        walletAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
        timestamp: testTimestamp,
        expiresAt: validAt,
      });

      const cleaned = cleanupExpiredRequests();
      expect(cleaned).toBe(1);

      expect(getLinkRequest(100)).toBeNull();
      expect(getLinkRequest(200)).not.toBeNull();
    });

    it("should replace existing link request", () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      createLinkRequest({
        telegramId: 123456,
        nonce: "first",
        walletAddress: "0x1111111111111111111111111111111111111111",
        timestamp: testTimestamp,
        expiresAt,
      });

      createLinkRequest({
        telegramId: 123456,
        nonce: "second",
        walletAddress: "0x2222222222222222222222222222222222222222",
        timestamp: testTimestamp,
        expiresAt,
      });

      const request = getLinkRequest(123456);
      expect(request!.nonce).toBe("second");
      expect(request!.walletAddress).toBe("0x2222222222222222222222222222222222222222");
    });
  });

  describe("Ban/Unban", () => {
    it("should ban and unban user", () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        isActive: true,
        isBanned: false,
      });

      expect(isUserBanned(123456)).toBe(false);

      banUser(123456);
      expect(isUserBanned(123456)).toBe(true);

      unbanUser(123456);
      expect(isUserBanned(123456)).toBe(false);
    });

    it("should return false for non-existent user ban check", () => {
      expect(isUserBanned(999999)).toBe(false);
    });
  });
});
