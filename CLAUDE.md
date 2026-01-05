# HydraSpecter

## Project Overview

Multi-headed browser automation MCP server with stealth capabilities, concurrent instances, and **zero-config session persistence**.

## Key Features

| Feature | Description |
|---------|-------------|
| Zero-Config | Global profile persists sessions automatically |
| Domain Intelligence | Auto-learns protection levels per domain |
| Multi-instance | Up to 20 concurrent browser instances |
| Stealth | rebrowser-playwright + stealth plugin |
| Humanize | Mouse, typing, scroll simulation |
| Adaptive | Auto-activates on detection signals |
| ARIA Snapshots | Token-efficient page representation |

## Architecture

```
src/
├── index.ts              # CLI entry point (commander)
├── server.ts             # MCP server + handlers
├── browser-manager.ts    # Instance lifecycle
├── global-profile.ts     # Zero-config persistent Chrome profile
├── domain-intelligence.ts # Auto-learning protection levels
├── tools.ts              # MCP tool definitions
├── types.ts              # TypeScript types
└── utils/
    ├── ghost-cursor.ts      # Bezier mouse movements
    ├── human-typing.ts      # Natural typing patterns
    ├── human-scroll.ts      # Physics-based scrolling
    ├── detection-monitor.ts # Anti-bot detection signals
    ├── rate-limiter.ts      # Request rate limiting
    ├── bezier.ts            # Bezier curve math
    └── random.ts            # Randomization helpers
```

## Global Storage

```
~/.hydraspecter/
├── profile/                    # Chrome persistent profile (userDataDir)
│   ├── Default/                # Cookies, localStorage, IndexedDB, cache
│   └── ...                     # Full Chrome profile data
└── domain-intelligence.json    # Protection levels per domain
```

## Zero-Config System

### How It Works

1. **Global Profile**: All browser pages share `~/.hydraspecter/profile/`
   - Cookies, localStorage, IndexedDB persist automatically
   - Google OAuth login works across all sites
   - No manual session management needed

2. **Domain Intelligence**: Auto-learns which sites need protection
   - Detection triggers level increment
   - Levels 0-3 with increasing anti-detection measures
   - Persists to `domain-intelligence.json`

### Protection Levels

| Level | Humanize | Headless | Delays |
|-------|----------|----------|--------|
| 0 | Off | Yes | None |
| 1 | On | Yes | Short (100-300ms) |
| 2 | On | **No** | Medium (300-800ms) |
| 3 | On | **No** | Long (500-1500ms) |

### Feedback Loop

```
Navigate → Detection? → Yes → Level++ → Apply new settings
                     → No  → Record success
```

## MCP Tools

### Zero-Config Tools (Recommended)

| Tool | Description |
|------|-------------|
| `browser_create_global` | Create page with global profile or incognito mode |
| `browser_get_protection_level` | Check domain's current protection level |
| `browser_set_protection_level` | Manually set protection level for a domain |
| `browser_reset_protection` | Reset domain protection to level 0 |
| `browser_list_domains` | List all domains with learned protection levels |

### Browser Modes (`browser_create_global`)

| Mode | Use Case | Behavior |
|------|----------|----------|
| `session` (default) | Authenticated sites | Persistent cookies, localStorage, Google OAuth |
| `incognito` | Scraping, anonymous | Fresh context, no stored data |

```javascript
// Authenticated browsing (default)
browser_create_global({ url: "https://auchan.fr" })  // Uses saved login

// Anonymous scraping
browser_create_global({ url: "https://example.com", mode: "incognito" })  // Fresh context
```

### Standard Tools

| Tool | Description |
|------|-------------|
| `browser_create_instance` | Create isolated browser instance |
| `browser_navigate` | Navigate with detection feedback |
| `browser_click` | Click (humanize: true/false/auto) |
| `browser_type` | Type text (humanize: true/false/auto) |
| `browser_fill` | Fill form field (humanize: true/false/auto) |
| `browser_scroll` | Scroll (humanize: true/false/auto) |
| `browser_screenshot` | Take screenshot |
| `browser_snapshot` | Get ARIA tree (token-efficient) |
| `browser_batch_execute` | Multiple operations in one call |
| `browser_save_session` | Save session state |
| `browser_close_instance` | Close instance |
| `browser_close_all_instances` | Close all instances |

### Tool Naming Convention

All tools prefixed with `browser_`.

### ID Compatibility

All tools accept either:
- `instanceId` from `browser_create_instance`
- `pageId` from `browser_create_global`

This means you can mix and match - create a page with `browser_create_global` and use `browser_click`, `browser_type`, etc. with the returned `pageId`.

### Clicking Cross-Origin Iframes (Google Sign-In)

For cross-origin iframes like Google Sign-In buttons, use `position` parameter:

```javascript
// 1. Get iframe coordinates
const iframeInfo = await browser_evaluate({
  instanceId: "...",
  script: `(() => {
    const iframe = document.querySelector('iframe[id^="gsi_"]');
    const rect = iframe.getBoundingClientRect();
    return { centerX: rect.x + rect.width/2, centerY: rect.y + rect.height/2 };
  })()`
});

// 2. Click at coordinates
browser_click({
  instanceId: "...",
  position: { x: iframeInfo.centerX, y: iframeInfo.centerY },
  humanize: true
})
```

Alternative: Navigate directly to OAuth URL (more reliable for Google Sign-In).

## Humanize Modes

| Mode | Description |
|------|-------------|
| `false` | Disabled |
| `true` | Always enabled |
| `'auto'` | Activates on detection signals |

Detection signals: Cloudflare, CAPTCHAs, DataDome, PerimeterX, rate limits.

## CLI Options

### Global Profile Options

```bash
--profile-dir <path>      # Custom profile dir (default: ~/.hydraspecter/profile/)
--global-headless         # Force headless mode (default: false for anti-detection)
--global-channel <channel> # Browser channel: chrome, msedge
```

### Humanize Options

```bash
--humanize               # Enable all human behaviors
--humanize-auto          # Adaptive: activates on detection (recommended)
--humanize-mouse         # Human-like mouse movement
--humanize-typing        # Human-like typing with typos
--humanize-scroll        # Physics-based scrolling
--typo-rate <number>     # Typo rate 0-1 (default: 0.02)
```

Priority: `--humanize-auto` > `--humanize` > `--humanize-<type>`

### Other Options

```bash
-m, --max-instances <n>  # Max concurrent instances (default: 20)
--browser <type>         # chromium, firefox, webkit
--channel <channel>      # chrome, msedge (anti-detection)
--natural-viewport       # No fixed viewport (anti-detection)
--proxy <url>            # Proxy server
--rate-limit <n>         # Max requests per window
```

## MCP Configuration

```json
{
  "hydraspecter": {
    "command": "node",
    "args": ["C:/path/to/hydraspecter/dist/index.js"]
  }
}
```

With anti-detection:
```json
{
  "hydraspecter": {
    "command": "node",
    "args": [
      "C:/path/to/hydraspecter/dist/index.js",
      "--humanize-auto",
      "--global-channel", "chrome"
    ]
  }
}
```

## Usage Examples

### Zero-Config (Recommended)

```javascript
// Create page with auto-session + auto-protection
browser_create_global({ url: "https://hellofresh.fr" })
// → Uses ~/.hydraspecter/profile/
// → Checks domain-intelligence.json for hellofresh.fr level
// → Applies appropriate humanize/headless settings
// → Returns { pageId, url, protectionLevel }

// Check protection level
browser_get_protection_level({ url: "https://hellofresh.fr" })
// → { domain: "hellofresh.fr", level: 2, settings: {...} }

// Reset if needed
browser_reset_protection({ url: "https://hellofresh.fr" })
```

### Standard Workflow

```javascript
// Create instance
browser_create_instance({ headless: false })
// → { instanceId: "abc123" }

// Navigate (detection feedback included)
browser_navigate({ instanceId: "abc123", url: "https://example.com" })
// → { success: true, detection: { detected: false } }

// Interact
browser_click({ instanceId: "abc123", selector: "#login", humanize: "auto" })
browser_type({ instanceId: "abc123", selector: "#email", text: "...", humanize: true })

// Get page state
browser_snapshot({ instanceId: "abc123" })
// → ARIA tree (token-efficient)
```

## Build Commands

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm test         # Run tests
```

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol
- `rebrowser-playwright` - Stealth browser automation
- `playwright-extra` - Plugin support
- `puppeteer-extra-plugin-stealth` - Evasions
- `commander` - CLI parsing
- `chalk` - Terminal colors

## Don't

- Modify tool names in tools.ts (breaks MCP clients)
- Remove humanize options (anti-detection critical)
- Hardcode viewport sizes (detection signal)
- Store sessions per-project (use global profile instead)
