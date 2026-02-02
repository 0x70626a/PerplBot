#!/bin/bash
# Full Deployment Script
# Deploys implementation + proxy with operator in one command

set -e

# Load environment
if [ -f .env ]; then
    source .env
fi

# Configuration
RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
DELEGATED_ACCOUNT_PATH="${DELEGATED_ACCOUNT_PATH:-../delegated-account}"
DEPOSIT_AMOUNT="${1:-0}"

echo "=== PerplBot Full Deployment ==="
echo ""

# Check for required keys
if [ -z "$OWNER_PRIVATE_KEY" ]; then
    echo "ERROR: OWNER_PRIVATE_KEY not set in .env"
    exit 1
fi

if [ -z "$OPERATOR_PRIVATE_KEY" ]; then
    echo "ERROR: OPERATOR_PRIVATE_KEY not set in .env"
    exit 1
fi

# Derive addresses
OWNER_ADDRESS=$(cast wallet address "$OWNER_PRIVATE_KEY" 2>/dev/null)
OPERATOR_ADDRESS=$(cast wallet address "$OPERATOR_PRIVATE_KEY" 2>/dev/null)

echo "Owner:    $OWNER_ADDRESS"
echo "Operator: $OPERATOR_ADDRESS"
echo "Deposit:  $DEPOSIT_AMOUNT USD stable"
echo ""

# Step 1: Deploy Implementation
echo "Step 1: Deploying implementation contract..."
cd "$DELEGATED_ACCOUNT_PATH"
forge build --quiet

OUTPUT=$(forge script script/DeployImplementation.s.sol:DeployImplementationScript \
    --rpc-url "$RPC_URL" \
    --private-key "$OWNER_PRIVATE_KEY" \
    --broadcast \
    2>&1)

IMPL_ADDRESS=$(echo "$OUTPUT" | grep "Implementation deployed at:" | awk '{print $NF}')

if [ -z "$IMPL_ADDRESS" ]; then
    echo "ERROR: Implementation deployment failed"
    echo "$OUTPUT"
    exit 1
fi

echo "Implementation: $IMPL_ADDRESS"
echo ""

# Step 2: Deploy Proxy via PerplBot CLI
echo "Step 2: Deploying proxy and creating account..."
cd - > /dev/null

npm run dev -- deploy \
    --implementation "$IMPL_ADDRESS" \
    --operator "$OPERATOR_ADDRESS" \
    --deposit "$DEPOSIT_AMOUNT"
