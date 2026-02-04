/**
 * Database schema types for multi-user bot
 */

/**
 * User record - links Telegram ID to wallet/account
 */
export interface User {
  telegramId: number; // Telegram user ID (primary key)
  walletAddress: string; // User's owner wallet address (checksummed)
  delegatedAccount?: string; // DelegatedAccount contract address
  linkedAt: Date;
  isActive: boolean;
  isBanned: boolean;
}

/**
 * Pending link request - temporary record for signature verification
 */
export interface LinkRequest {
  telegramId: number;
  nonce: string; // Random nonce for signature verification
  walletAddress: string;
  timestamp: string; // ISO timestamp for message consistency
  expiresAt: Date;
}

/**
 * User row from database (raw SQLite types)
 */
export interface UserRow {
  telegram_id: number;
  wallet_address: string;
  delegated_account: string | null;
  linked_at: string;
  is_active: number;
  is_banned: number;
}

/**
 * Link request row from database (raw SQLite types)
 */
export interface LinkRequestRow {
  telegram_id: number;
  nonce: string;
  wallet_address: string;
  timestamp: string;
  expires_at: string;
}

/**
 * Convert database row to User object
 */
export function rowToUser(row: UserRow): User {
  return {
    telegramId: row.telegram_id,
    walletAddress: row.wallet_address,
    delegatedAccount: row.delegated_account || undefined,
    linkedAt: new Date(row.linked_at),
    isActive: row.is_active === 1,
    isBanned: row.is_banned === 1,
  };
}

/**
 * Convert database row to LinkRequest object
 */
export function rowToLinkRequest(row: LinkRequestRow): LinkRequest {
  return {
    telegramId: row.telegram_id,
    nonce: row.nonce,
    walletAddress: row.wallet_address,
    timestamp: row.timestamp,
    expiresAt: new Date(row.expires_at),
  };
}
