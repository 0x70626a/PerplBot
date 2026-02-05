/**
 * Deploy handler tests
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";

// Test database path
const TEST_DB_PATH = "./test-data/test-deploy-perpl.db";

// Set environment before importing
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.IMPLEMENTATION_ADDRESS = "0xIMPL1234567890abcdef1234567890abcdef1234";
process.env.BOT_OPERATOR_ADDRESS = "0xOP1234567890abcdef1234567890abcdef123456";

import {
  initDatabase,
  closeDatabase,
  getDatabase,
  createUser,
} from "../../src/bot/db/index.js";

// Helper to clean up database files
function cleanupDbFiles(path: string) {
  if (existsSync(path)) rmSync(path);
  if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
  if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

describe("Deploy Handler", () => {
  beforeAll(() => {
    mkdirSync("./test-data", { recursive: true });
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
    initDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM link_requests");
  });

  afterAll(() => {
    closeDatabase();
    cleanupDbFiles(TEST_DB_PATH);
  });

  describe("handleDeploy", () => {
    it("should reject user without linked wallet", async () => {
      const { handleDeploy } = await import("../../src/bot/handlers/deploy.js");

      const replyMock = vi.fn();
      const ctx = {
        from: { id: 123456 },
        reply: replyMock,
      } as any;

      await handleDeploy(ctx);

      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("link your wallet first")
      );
    });

    it("should show message if user already has delegated account", async () => {
      createUser({
        telegramId: 123456,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        delegatedAccount: "0xabcdef1234567890abcdef1234567890abcdef12",
        isActive: true,
        isBanned: false,
      });

      // Re-import to pick up the new user
      const { handleDeploy } = await import("../../src/bot/handlers/deploy.js");

      const replyMock = vi.fn();
      const ctx = {
        from: { id: 123456 },
        reply: replyMock,
      } as any;

      await handleDeploy(ctx);

      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("already have a DelegatedAccount"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );
    });

    it("should show deployment instructions for linked user without delegated account", async () => {
      createUser({
        telegramId: 789012,
        walletAddress: "0xaabbccdd1234567890abcdef1234567890abcdef",
        isActive: true,
        isBanned: false,
      });

      const { handleDeploy } = await import("../../src/bot/handlers/deploy.js");

      const replyMock = vi.fn();
      const ctx = {
        from: { id: 789012 },
        reply: replyMock,
      } as any;

      await handleDeploy(ctx);

      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("Deploy Your DelegatedAccount"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );

      // Check that message includes key elements
      const message = replyMock.mock.calls[0][0];
      expect(message).toContain("Your linked wallet");
      expect(message).toContain("Option 1: Web UI");
      expect(message).toContain("Option 2: CLI");
      expect(message).toContain("npx perpl deploy");
      expect(message).toContain("/setaccount");
    });
  });

  describe("handleContracts", () => {
    it("should display contract addresses", async () => {
      const { handleContracts } = await import("../../src/bot/handlers/deploy.js");

      const replyMock = vi.fn();
      const ctx = {
        reply: replyMock,
      } as any;

      await handleContracts(ctx);

      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("Contract Addresses"),
        expect.objectContaining({ parse_mode: "MarkdownV2" })
      );

      const message = replyMock.mock.calls[0][0];
      expect(message).toContain("Exchange");
      expect(message).toContain("Collateral");
      expect(message).toContain("10143"); // Chain ID
    });
  });
});
