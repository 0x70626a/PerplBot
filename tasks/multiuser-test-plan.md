# Multi-User Bot End-to-End Test Plan

## Overview

This test plan verifies the multi-user Telegram bot functionality including wallet linking, account setup, and trading on behalf of users.

## Prerequisites

1. **Environment Setup**
   ```bash
   # Copy .env.example to .env and configure:
   TELEGRAM_BOT_TOKEN=<your_bot_token>
   MULTI_USER_MODE=true
   BOT_OPERATOR_PRIVATE_KEY=0x...  # Generate a new operator key
   DATABASE_PATH=./data/perplbot.db

   # Standard config
   MONAD_RPC_URL=https://testnet-rpc.monad.xyz
   CHAIN_ID=10143
   EXCHANGE_ADDRESS=0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7
   COLLATERAL_TOKEN=0xdF5B718d8FcC173335185a2a1513eE8151e3c027
   ```

2. **Bot Operator Wallet**
   - Generate a new operator wallet (do NOT use owner wallet)
   - Fund with testnet MON for gas
   - Note the address for users to add as operator

3. **Test User Setup**
   - Have a Telegram account
   - Have a wallet with testnet funds
   - Have deployed a DelegatedAccount (or be ready to deploy one)

4. **Build and Run**
   ```bash
   npm install
   npm run build
   npm run bot  # or node dist/bot/index.js
   ```

---

## Test Matrix

| Test ID | Category | Description | Auth Required |
|---------|----------|-------------|---------------|
| T1 | Linking | /link command with valid address | No |
| T2 | Linking | /link with invalid address | No |
| T3 | Linking | /verify with valid signature | No |
| T4 | Linking | /verify with invalid signature | No |
| T5 | Linking | /verify with expired request | No |
| T6 | Account | /setaccount before linking | No |
| T7 | Account | /setaccount with bot not as operator | Linked |
| T8 | Account | /setaccount with valid account | Linked |
| T9 | Account | /whoami shows correct info | Linked |
| T10 | Account | /unlink requires confirmation | Linked |
| T11 | Trading | Natural language trade | Full |
| T12 | Trading | /status shows positions | Full |
| T13 | Trading | Rate limiting enforced | Full |
| T14 | Admin | Ban user blocks access | Admin |
| T15 | Fallback | Single-user mode still works | Config |

---

## Test Cases

### T1: /link Command - Valid Address

**Purpose**: Verify wallet linking flow starts correctly

**Steps**:
1. Open Telegram chat with bot
2. Send: `/link 0xYourWalletAddress`

**Expected Output**:
```
To link wallet `0xYour...`, sign this message:

```
Link wallet to PerplBot

Telegram ID: 123456789
Nonce: abc123...
Timestamp: 2026-02-04T...

This signature proves you own this wallet.
It does not authorize any transactions.
```

Then reply with: `/verify <signature>`

_This request expires in 30 minutes._
```

**Verification**:
- [ ] Message contains Telegram ID
- [ ] Message contains unique nonce
- [ ] Message contains timestamp
- [ ] Instructions mention /verify

---

### T2: /link Command - Invalid Address

**Purpose**: Verify invalid addresses are rejected

**Steps**:
1. Send: `/link invalid`
2. Send: `/link 0x123`

**Expected Output**:
```
Invalid wallet address format.

Please provide a valid Ethereum address starting with 0x.
```

**Verification**:
- [ ] Invalid address rejected
- [ ] Short address rejected
- [ ] Helpful error message shown

---

### T3: /verify Command - Valid Signature

**Purpose**: Verify successful wallet linking

**Steps**:
1. Complete T1 to get signing message
2. Sign message in wallet (MetaMask, etc.)
3. Send: `/verify 0x<signature>`

**Expected Output**:
```
Wallet linked successfully!

Wallet: `0xYourWallet...`

Next steps:
1. Deploy a DelegatedAccount at perpl.xyz
2. Add bot operator: `0xBotOperator...`
3. Run: `/setaccount <delegated_account_address>`

_The bot operator can trade on your behalf but cannot withdraw funds._
```

**Verification**:
- [ ] Success message shown
- [ ] Wallet address confirmed
- [ ] Bot operator address shown
- [ ] Next steps clear

---

### T4: /verify Command - Invalid Signature

**Purpose**: Verify invalid signatures are rejected

**Steps**:
1. Complete T1 to start linking
2. Send: `/verify 0xinvalidsignature`

**Expected Output**:
```
Signature verification failed.

Error: <error details>

Please make sure you signed the exact message shown and try again.
```

**Verification**:
- [ ] Verification fails
- [ ] Error message helpful
- [ ] Can retry

---

### T5: /verify Command - Expired Request

**Purpose**: Verify expired requests are rejected

**Steps**:
1. Complete T1 to start linking
2. Wait 30+ minutes (or manually expire in DB)
3. Send: `/verify 0x<valid_signature>`

**Expected Output**:
```
Link request has expired.

Please use /link <wallet_address> to start again.
```

**Verification**:
- [ ] Expired request rejected
- [ ] Clear instructions to restart

---

### T6: /setaccount Before Linking

**Purpose**: Verify account setup requires linked wallet first

**Steps**:
1. Use a Telegram account with no linked wallet
2. Send: `/setaccount 0xSomeAddress`

**Expected Output**:
```
Please link your wallet first.

Use: /link <your_wallet_address>
```

**Verification**:
- [ ] Command blocked
- [ ] Helpful message shown

---

### T7: /setaccount - Bot Not Operator

**Purpose**: Verify operator check works

**Steps**:
1. Complete T3 (wallet linked)
2. Have a DelegatedAccount where bot is NOT operator
3. Send: `/setaccount 0xDelegatedAccountWithoutOperator`

**Expected Output**:
```
Bot is not authorized on this account.

DelegatedAccount: `0x...`

Please add the bot operator:
`0xBotOperatorAddress`

Then run /setaccount again.
```

**Verification**:
- [ ] Operator check performed
- [ ] Bot operator address shown
- [ ] Clear instructions

---

### T8: /setaccount - Valid Setup

**Purpose**: Verify successful account setup

**Prerequisites**:
- Wallet linked (T3)
- DelegatedAccount deployed
- Bot operator added to DelegatedAccount

**Steps**:
1. Send: `/setaccount 0xYourDelegatedAccount`

**Expected Output**:
```
DelegatedAccount set successfully!

Account: `0xYour...`

You can now trade using natural language or /status to check your positions.
```

**Verification**:
- [ ] Account saved
- [ ] Success message shown
- [ ] Can now use trading commands

---

### T9: /whoami Command

**Purpose**: Verify user info display

**Steps**:
1. Complete T8 (full setup)
2. Send: `/whoami`

**Expected Output**:
```
*Your PerplBot Account*

Telegram ID: `123456789`
Wallet: `0xYourWallet...`
DelegatedAccount: `0xYourDelegated...`
Bot authorized: Yes

Linked: 2026-02-04
Status: Active
```

**Verification**:
- [ ] All info displayed correctly
- [ ] Bot authorized status correct
- [ ] Linked date shown

---

### T10: /unlink Command

**Purpose**: Verify unlink requires confirmation

**Steps**:
1. Complete T8 (full setup)
2. Send: `/unlink`
3. Send: `/unlink confirm`

**Expected Output (first /unlink)**:
```
*Warning: This will unlink your wallet*

Wallet: `0xYour...`

You will need to re-link and verify ownership to use the bot again.

To confirm, type: /unlink confirm
```

**Expected Output (after confirm)**:
```
Wallet unlinked successfully.

Use /link <wallet_address> to link a new wallet.
```

**Verification**:
- [ ] Confirmation required
- [ ] Warning message clear
- [ ] Unlink successful
- [ ] User removed from database

---

### T11: Natural Language Trade

**Purpose**: Verify trading works for linked users

**Prerequisites**: Full setup complete (T8)

**Steps**:
1. Send: `long 0.001 btc at 50000 2x`
2. Click "Confirm" button

**Expected Output**:
```
*Trade Preview*

OPEN LONG 0.001 BTC @ $50,000
Leverage: 2x

[Confirm] [Cancel]
```

After confirm:
```
*Trade Submitted*

Tx: `0x...`
```

**Verification**:
- [ ] Trade preview shown
- [ ] Confirmation buttons work
- [ ] Trade executes through DelegatedAccount
- [ ] Transaction hash returned

---

### T12: /status Command

**Purpose**: Verify status shows user's positions

**Prerequisites**: Full setup complete (T8)

**Steps**:
1. Send: `/status`

**Expected Output**:
```
Fetching account status...

*Exchange Account*
Account ID: `123`
Balance: $1000.00
Locked: $50.00
Available: $950.00

*Positions*

*BTC* LONG
  Size: 0.001000
  Entry: $50,000.00
  Mark: $51,000.00
  PnL: +$10.00

*Wallet*
ETH: 0.000000
USDC: $0.00
```

**Verification**:
- [ ] Account info from DelegatedAccount
- [ ] Positions displayed correctly
- [ ] Uses user's account, not owner's

---

### T13: Rate Limiting

**Purpose**: Verify rate limits are enforced

**Prerequisites**: Full setup complete (T8)

**Steps**:
1. Send 11 trade confirmations rapidly (within 1 minute)

**Expected Output (on 11th)**:
```
Rate limit exceeded. Please wait a minute before trading again.
```

**Verification**:
- [ ] First 10 trades succeed
- [ ] 11th trade blocked
- [ ] After 1 minute, can trade again

---

### T14: Ban User (Admin)

**Purpose**: Verify banned users are blocked

**Steps**:
1. As admin, ban user in database:
   ```sql
   UPDATE users SET is_banned = 1 WHERE telegram_id = 123456789;
   ```
2. As banned user, send any command

**Expected Output**:
```
Your account has been suspended.
```

**Verification**:
- [ ] All commands blocked
- [ ] Clear message shown
- [ ] Unban restores access

---

### T15: Single-User Mode Fallback

**Purpose**: Verify single-user mode still works

**Steps**:
1. Set environment:
   ```bash
   MULTI_USER_MODE=false
   TELEGRAM_USER_ID=123456789
   ```
2. Restart bot
3. Send commands from authorized user

**Expected Output**:
- Bot works as before (single-user mode)
- Multi-user commands (/link, /setaccount) still available but not required

**Verification**:
- [ ] Bot starts in single-user mode
- [ ] Authorized user can trade
- [ ] Unauthorized users rejected

---

## Database Verification

After running tests, verify database state:

```bash
sqlite3 ./data/perplbot.db
```

```sql
-- Check users
SELECT * FROM users;

-- Check link requests (should be empty after verification)
SELECT * FROM link_requests;
```

---

## Test Summary Checklist

| Test | Status | Notes |
|------|--------|-------|
| T1 /link valid | [ ] | |
| T2 /link invalid | [ ] | |
| T3 /verify valid | [ ] | |
| T4 /verify invalid | [ ] | |
| T5 /verify expired | [ ] | |
| T6 /setaccount before link | [ ] | |
| T7 /setaccount no operator | [ ] | |
| T8 /setaccount valid | [ ] | |
| T9 /whoami | [ ] | |
| T10 /unlink | [ ] | |
| T11 trade | [ ] | |
| T12 /status | [ ] | |
| T13 rate limit | [ ] | |
| T14 ban user | [ ] | |
| T15 single-user fallback | [ ] | |

**Unit Tests**: 328/328 passed

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tester | | | |
| Developer | | | |

---

## Notes

- All tests should be run on Monad testnet
- Ensure bot operator wallet has sufficient MON for gas
- Tests involving trades will create real on-chain transactions
- Clean up test data after testing (remove test users from DB)
