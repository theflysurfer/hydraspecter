# HydraSpecter

**Multi-headed browser automation MCP - stealth, concurrent, unstoppable**

A powerful MCP (Model Context Protocol) server for browser automation with multiple concurrent instances, stealth capabilities, and human-like behavior simulation.

## Features

- **Multi-Instance Concurrency**: Run multiple browser instances simultaneously
- **Stealth Mode**: Built-in anti-detection with rebrowser-playwright
- **Human-Like Behaviors**: Simulate mouse movements, typing patterns, and scrolling
- **Adaptive Humanize**: Auto-activates when detection signals are found (Cloudflare, CAPTCHAs)
- **ARIA Snapshots**: Token-efficient page representation
- **Batch Execution**: Execute multiple operations in a single call
- **Session Persistence**: Reuse browser profiles across sessions
- **Proxy Support**: Auto-detection + manual proxy configuration

## Installation

```bash
# Using npx (recommended)
npx hydraspecter

# Global installation
npm install -g hydraspecter
```

## Quick Start

### Basic Usage

```bash
# Default configuration
npx hydraspecter

# Custom configuration
npx hydraspecter --max-instances 10 --headless false

# Stealth mode (recommended for anti-detection)
npx hydraspecter --humanize-auto --channel chrome --natural-viewport
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "hydraspecter": {
      "command": "npx",
      "args": ["hydraspecter", "--max-instances", "10", "--humanize-auto"]
    }
  }
}
```

## Command Line Options

### Core Options

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --max-instances <n>` | Maximum concurrent instances | 20 |
| `-t, --instance-timeout <n>` | Timeout in minutes | 30 |
| `--browser <type>` | chromium/firefox/webkit | chromium |
| `--headless` | Run in headless mode | true |
| `--channel <channel>` | Browser channel: chrome, msedge | - |

### Anti-Detection Options

| Option | Description |
|--------|-------------|
| `--humanize` | Enable all human-like behaviors |
| `--humanize-auto` | Adaptive mode (activates on detection) |
| `--humanize-mouse` | Human-like mouse movements |
| `--humanize-typing` | Human-like typing patterns |
| `--humanize-scroll` | Human-like scrolling |
| `--natural-viewport` | Use natural viewport size |
| `--typo-rate <rate>` | Typo rate for typing (0-1) |

### Proxy Options

| Option | Description |
|--------|-------------|
| `--proxy <url>` | Proxy server URL |
| `--no-proxy-auto-detect` | Disable auto proxy detection |

### Persistence Options

| Option | Description |
|--------|-------------|
| `--user-data-dir <path>` | Persistent profile directory |

## Available Tools

### Instance Management
- `browser_create_instance` - Create a new browser instance
- `browser_list_instances` - List all active instances
- `browser_close_instance` - Close a specific instance
- `browser_close_all_instances` - Close all instances

### Navigation
- `browser_navigate` - Navigate to URL
- `browser_go_back` / `browser_go_forward` - History navigation
- `browser_refresh` - Refresh page

### Interaction
- `browser_click` - Click element (supports humanize)
- `browser_type` - Type text (supports humanize)
- `browser_fill` - Fill form field (supports humanize)
- `browser_scroll` - Scroll page (supports humanize)
- `browser_select_option` - Select dropdown option

### Page Information
- `browser_snapshot` - Get ARIA tree (token-efficient)
- `browser_screenshot` - Take screenshot
- `browser_get_page_info` - Get full page info
- `browser_get_element_text` - Get element text
- `browser_get_markdown` - Get page as Markdown

### Advanced
- `browser_batch_execute` - Execute multiple operations
- `browser_evaluate` - Execute JavaScript
- `browser_wait_for_element` - Wait for element
- `browser_wait_for_navigation` - Wait for navigation

## Stealth Configuration Examples

### Maximum Stealth

```json
{
  "mcpServers": {
    "hydraspecter": {
      "command": "npx",
      "args": [
        "hydraspecter",
        "--channel", "chrome",
        "--natural-viewport",
        "--humanize",
        "--headless", "false",
        "--user-data-dir", "~/.hydraspecter/profile"
      ]
    }
  }
}
```

### Adaptive Mode (Recommended)

```json
{
  "mcpServers": {
    "hydraspecter": {
      "command": "npx",
      "args": [
        "hydraspecter",
        "--humanize-auto",
        "--channel", "chrome",
        "--always-humanize-domains", "temu.com,amazon.com"
      ]
    }
  }
}
```

## Architecture

```
HydraSpecter MCP Server
├── Browser Manager (instance lifecycle, cleanup)
├── Browser Tools (MCP tool definitions)
├── Human Behaviors
│   ├── Ghost Cursor (bezier mouse movements)
│   ├── Human Typing (natural typing with typos)
│   └── Human Scroll (natural scrolling)
└── Stealth Layer (rebrowser-playwright + stealth plugin)
```

## Why "HydraSpecter"?

- **Hydra**: Multi-headed, representing concurrent browser instances
- **Specter**: Ghost-like, undetectable, representing stealth capabilities

## Requirements

- Node.js >= 18.0.0
- Playwright browsers (auto-installed)

## License

Apache-2.0

## Credits

Built on top of:
- [rebrowser-playwright](https://github.com/nicey0/rebrowser-playwright) - Stealth Playwright fork
- [playwright-extra](https://github.com/nicey0/playwright-extra) - Plugin support
- [puppeteer-extra-plugin-stealth](https://github.com/nicey0/puppeteer-extra-plugin-stealth) - Stealth evasions
