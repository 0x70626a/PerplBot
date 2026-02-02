#!/bin/bash
# Deploy DelegatedAccount Implementation Contract
# This deploys the implementation that proxies will point to

set -e

# Load environment
if [ -f .env ]; then
    source .env
fi

# Configuration
RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
DELEGATED_ACCOUNT_PATH="${DELEGATED_ACCOUNT_PATH:-../delegated-account}"

echo "=== Deploy DelegatedAccount Implementation ==="
echo ""

# Check for private key
if [ -z "$OWNER_PRIVATE_KEY" ]; then
    echo "ERROR: OWNER_PRIVATE_KEY not set"
    echo "Set it in .env or export OWNER_PRIVATE_KEY=0x..."
    exit 1
fi

# Check Foundry is installed
if ! command -v forge &> /dev/null; then
    echo "ERROR: Foundry (forge) is not installed"
    echo "Install it from: https://book.getfoundry.sh/getting-started/installation"
    exit 1
fi

# Check delegated-account repo exists
if [ ! -d "$DELEGATED_ACCOUNT_PATH" ]; then
    echo "ERROR: delegated-account repo not found at $DELEGATED_ACCOUNT_PATH"
    echo "Clone it: git clone https://github.com/PerplFoundation/delegated-account $DELEGATED_ACCOUNT_PATH"
    exit 1
fi

echo "RPC URL: $RPC_URL"
echo "Deployer: $(cast wallet address $OWNER_PRIVATE_KEY 2>/dev/null || echo 'Unable to derive address')"
echo ""

# Deploy
echo "Deploying implementation..."
cd "$DELEGATED_ACCOUNT_PATH"

# Build first
forge build --quiet

# Deploy
OUTPUT=$(forge script script/DeployImplementation.s.sol:DeployImplementationScript \
    --rpc-url "$RPC_URL" \
    --private-key "$OWNER_PRIVATE_KEY" \
    --broadcast \
    2>&1)

echo "$OUTPUT"

# Extract implementation address
IMPL_ADDRESS=$(echo "$OUTPUT" | grep "Implementation deployed at:" | awk '{print $NF}')

if [ -z "$IMPL_ADDRESS" ]; then
    echo ""
    echo "ERROR: Could not extract implementation address from output"
    exit 1
fi

echo ""
echo "=== Deployment Successful ==="
echo "Implementation Address: $IMPL_ADDRESS"
echo ""
echo "Next step - deploy your proxy with:"
echo "  npm run dev -- deploy --implementation $IMPL_ADDRESS --operator <YOUR_OPERATOR_ADDRESS> --deposit 100"
