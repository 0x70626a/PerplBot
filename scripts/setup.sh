#!/bin/bash
# PerplBot Setup Script
# Installs dependencies and generates wallets

set -e

echo "=== PerplBot Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "ERROR: Node.js 18+ required. Current version: $(node -v)"
    exit 1
fi

echo "Node.js $(node -v) detected"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
echo ""

# Generate wallets
echo "Generating wallets..."
npx tsx scripts/generate-wallets.ts
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Run 'npm run dev -- --help' to see available commands."
