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
├── profiles/                   # Profile pool for multi-process support
│   ├── pool-0/                 # Profile 0 (cookies, localStorage, etc.)
│   ├── pool-1/                 # Profile 1
│   ├── pool-2/                 # Profile 2
│   ├── pool-3/                 # Profile 3
│   └── pool-4/                 # Profile 4
├── locks/                      # Lock files for profile management
│   └── pool-X.lock             # { pid, startedAt, mcpId }
└── domain-intelligence.json    # Protection levels per domain (shared)
```

## Multi-Process Support

HydraSpecter uses a **profile pool** to support multiple concurrent MCP processes:

- **5 profiles** in the pool by default (configurable via `--pool-size`)
- Each process acquires an available profile automatically
- Stale locks (crashed processes) are auto-detected and reclaimed
- If all profiles are in use, returns explicit error with suggestion

```javascript
// If all profiles in use:
{
  "error": "All profiles are in use",
  "lockedProfiles": [
    { "id": "pool-0", "pid": 12345, "since": "2026-01-05T10:30:00Z" }
  ],
  "suggestion": "Close other HydraSpecter sessions or use mode: 'incognito'"
}
```

## Zero-Config System

### How It Works

1. **Profile Pool**: Each process gets its own profile from the pool
   - Cookies, localStorage, IndexedDB persist automatically per profile
   - Google OAuth login works across all sites within a profile
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
| `browser_list_profiles` | List profile pool status (available/locked) |
| `browser_release_profile` | Force release a stale profile lock |

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

### Choosing the Right Tool

| Scenario | Tool | Mode |
|----------|------|------|
| Login to a site | `browser_create_global` | session |
| Stay logged in forever | `browser_create_global` | session |
| Google OAuth (login once, use everywhere) | `browser_create_global` | session |
| Anonymous scraping | `browser_create_global` | incognito |
| Price comparison (fresh each time) | `browser_create_global` | incognito |
| Test in Firefox/WebKit | `browser_create_instance` | - |
| Custom viewport/user agent | `browser_create_instance` | - |
| Manual session management | `browser_create_instance` | - |

### Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Using `browser_create_instance` for authenticated sites | Sessions lost on close | Use `browser_create_global` (session mode) |
| Using session mode when scraping same site with different accounts | Accounts conflict | Use `browser_create_global` (incognito mode) |
| Getting "All profiles in use" error | Too many concurrent MCP processes | Use `browser_list_profiles` then `browser_release_profile` for stale locks |

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

### Profile Pool Options

```bash
--pool-size <n>           # Number of profiles in pool (default: 5)
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
// → Acquires profile from pool (pool-0, pool-1, etc.)
// → Checks domain-intelligence.json for hellofresh.fr level
// → Applies appropriate humanize/headless settings
// → Returns { pageId, url, protectionLevel, profileId }

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
