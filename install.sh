#!/bin/bash

# HydraSpecter Installation Script
# Multi-headed browser automation MCP - stealth, concurrent, unstoppable

echo "🐉 Installing HydraSpecter..."
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version too low. Requires 18.0.0 or higher, current version: $NODE_VERSION"
    exit 1
fi

echo "✅ Node.js version check passed: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm check passed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Dependencies installation failed"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Build project
echo "🔨 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Project build failed"
    exit 1
fi

echo "✅ Project built successfully"

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install

if [ $? -ne 0 ]; then
    echo "❌ Playwright browsers installation failed"
    exit 1
fi

echo "✅ Playwright browsers installed successfully"

# Create global link (optional)
echo "🔗 Creating global link..."
npm link

if [ $? -eq 0 ]; then
    echo "✅ Global link created successfully"
    echo "📝 You can now use 'hydraspecter' command"
else
    echo "⚠️ Global link creation failed, you can use 'node dist/index.js' to run"
fi

echo ""
echo "🎉 Installation completed!"
echo ""
echo "📋 Usage:"
echo "  1. Basic usage: npx hydraspecter"
echo "  2. Show help: npx hydraspecter --help"
echo "  3. Show examples: npx hydraspecter example"
echo "  4. Stealth mode: npx hydraspecter --humanize-auto --channel chrome"
echo ""
echo "🔧 MCP Client configuration example:"
echo "  {"
echo "    \"mcpServers\": {"
echo "      \"hydraspecter\": {"
echo "        \"command\": \"node\","
echo "        \"args\": [\"$(pwd)/dist/index.js\"]"
echo "      }"
echo "    }"
echo "  }"
echo ""
echo "🐉 HydraSpecter is ready to hunt!" 