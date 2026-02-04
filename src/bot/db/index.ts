/**
 * SQLite database for multi-user bot
 *
 * Stores user-wallet mappings and pending link requests.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type {
  User,
  LinkRequest,
  UserRow,
  LinkRequestRow,
} from "./schema.js";
import { rowToUser, rowToLinkRequest } from "./schema.js";

const DB_PATH = process.env.DATABASE_PATH || "./data/perplbot.db";

let db: Database.Database | null = null;

/**
 * Initialize database connection and schema
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // Ensure directory exists
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent performance
  db.pragma("journal_mode = WAL");

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      delegated_account TEXT,
      linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      is_banned INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS link_requests (
      telegram_id INTEGER PRIMARY KEY,
      nonce TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_users_delegated ON users(delegated_account);
  `);

  return db;
}

/**
 * Get database instance (initializes if needed)
 */
export function getDatabase(): Database.Database {
  return db || initDatabase();
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================
// User Operations
// ============================================

/**
 * Get user by Telegram ID
 */
export function getUser(telegramId: number): User | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(telegramId) as UserRow | undefined;

  return row ? rowToUser(row) : null;
}

/**
 * Get user by wallet address
 */
export function getUserByWallet(walletAddress: string): User | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)")
    .get(walletAddress) as UserRow | undefined;

  return row ? rowToUser(row) : null;
}

/**
 * Get user by delegated account address
 */
export function getUserByDelegatedAccount(
  delegatedAccount: string
): User | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM users WHERE LOWER(delegated_account) = LOWER(?)")
    .get(delegatedAccount) as UserRow | undefined;

  return row ? rowToUser(row) : null;
}

/**
 * Create a new user
 */
export function createUser(user: Omit<User, "linkedAt">): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO users (telegram_id, wallet_address, delegated_account, is_active, is_banned)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    user.telegramId,
    user.walletAddress,
    user.delegatedAccount || null,
    user.isActive ? 1 : 0,
    user.isBanned ? 1 : 0
  );
}

/**
 * Update user fields
 */
export function updateUser(
  telegramId: number,
  updates: Partial<Omit<User, "telegramId" | "linkedAt">>
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.walletAddress !== undefined) {
    sets.push("wallet_address = ?");
    values.push(updates.walletAddress);
  }
  if (updates.delegatedAccount !== undefined) {
    sets.push("delegated_account = ?");
    values.push(updates.delegatedAccount || null);
  }
  if (updates.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(updates.isActive ? 1 : 0);
  }
  if (updates.isBanned !== undefined) {
    sets.push("is_banned = ?");
    values.push(updates.isBanned ? 1 : 0);
  }

  if (sets.length === 0) return;

  values.push(telegramId);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE telegram_id = ?`).run(
    ...values
  );
}

/**
 * Delete user by Telegram ID
 */
export function deleteUser(telegramId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM users WHERE telegram_id = ?").run(telegramId);
}

/**
 * Get all active users
 */
export function getAllActiveUsers(): User[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM users WHERE is_active = 1 AND is_banned = 0")
    .all() as UserRow[];

  return rows.map(rowToUser);
}

/**
 * Get user count
 */
export function getUserCount(): number {
  const db = getDatabase();
  const result = db
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count: number };
  return result.count;
}

// ============================================
// Link Request Operations
// ============================================

/**
 * Create or replace a link request
 */
export function createLinkRequest(request: LinkRequest): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO link_requests (telegram_id, nonce, wallet_address, timestamp, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    request.telegramId,
    request.nonce,
    request.walletAddress,
    request.timestamp,
    request.expiresAt.toISOString()
  );
}

/**
 * Get pending link request by Telegram ID
 */
export function getLinkRequest(telegramId: number): LinkRequest | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM link_requests WHERE telegram_id = ?")
    .get(telegramId) as LinkRequestRow | undefined;

  return row ? rowToLinkRequest(row) : null;
}

/**
 * Delete link request
 */
export function deleteLinkRequest(telegramId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM link_requests WHERE telegram_id = ?").run(telegramId);
}

/**
 * Cleanup expired link requests
 * @returns Number of deleted requests
 */
export function cleanupExpiredRequests(): number {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM link_requests WHERE expires_at < ?")
    .run(new Date().toISOString());
  return result.changes;
}

// ============================================
// Admin Operations
// ============================================

/**
 * Ban a user
 */
export function banUser(telegramId: number): void {
  updateUser(telegramId, { isBanned: true });
}

/**
 * Unban a user
 */
export function unbanUser(telegramId: number): void {
  updateUser(telegramId, { isBanned: false });
}

/**
 * Check if a user is banned
 */
export function isUserBanned(telegramId: number): boolean {
  const user = getUser(telegramId);
  return user?.isBanned ?? false;
}
