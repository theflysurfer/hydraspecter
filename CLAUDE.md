# HydraSpecter

## Project Overview

Multi-headed browser automation MCP server with stealth capabilities, concurrent instances, and **zero-config session persistence**.

## Key Features

| Feature | Description |
|---------|-------------|
| Zero-Config | Global profile persists sessions automatically |
| Domain Intelligence | Auto-learns protection levels per domain |
| Multi-instance | Up to 20 concurrent browser instances |
| Profile Pool | 5 profiles for multi-process support |
| Stealth | rebrowser-playwright + stealth plugin |
| Humanize | Mouse, typing, scroll simulation |
| Adaptive | Auto-activates on detection signals |
| Device Emulation | Mobile/tablet simulation (iPhone, Pixel, iPad) |
| Console Capture | Capture and filter console logs |
| Network Monitoring | Track requests/responses with timing |
| PDF Generation | Generate PDFs from pages |
| Download Handling | Track and manage file downloads |
| ARIA Snapshots | Token-efficient page representation |
| **Expectation Filtering** | Filter snapshots by intent (30-50% token reduction) |
| **Auto TOON Format** | Large lists auto-formatted for 40-60% fewer tokens |

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

2. **Auto-Sync from Chrome** (NEW): Sessions are automatically synced from your real Chrome browser
   - On each launch, checks if Chrome has newer session data
   - Syncs: Cookies (all sites) + Local Storage + IndexedDB (critical domains)
   - Works even if Chrome is open (partial sync)
   - Critical domains: google, notion, amazon, temu, github, gitlab, spotify, netflix, dropbox, slack, discord, linkedin

3. **Domain Intelligence**: Auto-learns which sites need protection
   - Detection triggers level increment
   - Levels 0-3 with increasing anti-detection measures
   - Persists to `domain-intelligence.json`

4. **Auto-Detection of Session Sites**: URLs like google.com, notion.so are automatically forced to `persistent` mode

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

### Browser Creation (Unified Tool)

**One tool to rule them all:** `browser_create`

| Mode | Use Case | Example |
|------|----------|---------|
| `persistent` (default) | Google, Amazon, Notion - sessions persist forever | `browser_create({ url: "https://google.com" })` |
| `incognito` | Anonymous scraping, fresh context each time | `browser_create({ mode: "incognito" })` |
| `isolated` | Firefox/WebKit, device emulation, multi-account | `browser_create({ mode: "isolated", device: "iPhone 14" })` |

```javascript
// Default: persistent mode (saves logins, best for 90% of use cases)
browser_create({ url: "https://google.com" })
// → Returns { id: "page-123", mode: "persistent", protectionLevel: 0 }

// Incognito: fresh context for anonymous browsing
browser_create({ url: "https://example.com", mode: "incognito" })

// Isolated: for device emulation or Firefox/WebKit
browser_create({ mode: "isolated", device: "iPhone 14" })
browser_create({ mode: "isolated", browserType: "firefox" })
```

### Choosing the Right Mode

| Scenario | Mode | Why |
|----------|------|-----|
| Google login | persistent (default) | ✅ Persistent session + best anti-detection |
| Amazon shopping | persistent | ✅ Stay logged in forever |
| Notion workspace | persistent | ✅ Session persists across MCP restarts |
| Anonymous scraping | incognito | Fresh context but still uses profile pool |
| Price comparison | incognito | No cookies between runs |
| Mobile testing | isolated | Device emulation requires isolated mode |
| Firefox/WebKit | isolated | Non-Chromium browsers require isolated mode |
| Multiple Google accounts | isolated | Different account per browser |

### Browser Engine Selection

| Mode | Default Browser | Reason |
|------|-----------------|--------|
| `persistent` | **Real Chrome** | Best anti-detection, session compatibility |
| `incognito` | **Real Chrome** | Same profile pool, anti-detection |
| `isolated` | **Chromium** | Lighter, faster, no session needed |

To use real Chrome in isolated mode: `browser_create({ mode: "isolated", channel: "chrome" })`

### Protection & Profile Management

| Tool | Description |
|------|-------------|
| `browser_get_protection_level` | Check domain's current protection level (0-3) |
| `browser_set_protection_level` | Manually set protection level for a domain |
| `browser_reset_protection` | Reset domain protection to level 0 |
| `browser_list_domains` | List all domains with learned protection levels |
| `browser_list_profiles` | List profile pool status (available/locked) |
| `browser_release_profile` | Force release profile AND close its browser (unlocks files) |

### Common Mistakes (BEFORE the unified tool)

These mistakes are now **impossible** with the unified `browser_create`:

| Old Mistake | Why It Happened | New Solution |
|-------------|-----------------|--------------|
| Using `browser_create_instance` for Google | Two tools were confusing | Just use `browser_create()` with defaults! |
| "Which tool do I use?" | Choice paralysis | One tool, smart defaults |
| "Browser unsafe" error from Google | Wrong defaults in old tool | Default mode=persistent, headless=false |

### Standard Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate with detection feedback |
| `browser_click` | Click (humanize: true/false/auto) |
| `browser_type` | Type text (humanize: true/false/auto) |
| `browser_fill` | Fill form field (humanize: true/false/auto) |
| `browser_scroll` | Scroll (humanize: true/false/auto) |
| `browser_screenshot` | Take screenshot |
| `browser_snapshot` | Get ARIA tree (token-efficient) |
| `browser_batch_execute` | Multiple operations in one call |
| `browser_save_session` | Save session state |
| `browser_close_instance` | Close browser |
| `browser_close_all_instances` | Close all browsers |

### Device Emulation

```javascript
// Mobile emulation (requires isolated mode)
browser_create({ mode: "isolated", device: "iPhone 14" })

// Tablet emulation
browser_create({ mode: "isolated", device: "iPad Pro 11" })

// List available devices
browser_list_devices({ filter: "iphone" })
```

### Console & Network Monitoring

| Tool | Description |
|------|-------------|
| `browser_enable_console_capture` | Start capturing console logs |
| `browser_get_console_logs` | Get captured logs (filter by type) |
| `browser_enable_network_monitoring` | Start capturing network requests |
| `browser_get_network_logs` | Get captured requests (filter by type/URL) |

```javascript
// Enable at browser creation (works with all modes)
browser_create({
  url: "https://example.com",
  enableConsoleCapture: true,
  enableNetworkMonitoring: true
})

// Or enable later
browser_enable_console_capture({ instanceId: "..." })
browser_enable_network_monitoring({ instanceId: "..." })

// Get logs
browser_get_console_logs({ instanceId: "...", filter: "error" })
browser_get_network_logs({ instanceId: "...", filter: "xhr" })
```

### PDF Generation & Downloads

| Tool | Description |
|------|-------------|
| `browser_generate_pdf` | Generate PDF from page |
| `browser_wait_for_download` | Wait for download to complete |
| `browser_get_downloads` | List downloads for instance |

```javascript
// Generate PDF
browser_generate_pdf({ instanceId: "...", path: "output.pdf", format: "A4" })

// Wait for download after clicking a link
browser_wait_for_download({ instanceId: "...", saveAs: "/path/to/file.zip" })
```

### Tool Naming Convention

All tools prefixed with `browser_`.

### ID Compatibility

All tools accept the `id` (or `instanceId` for backwards compatibility) returned from `browser_create`.

This works regardless of which mode you used (persistent, incognito, or isolated).

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

### Handling Multiple Elements (Strict Mode)

When a selector matches multiple elements, use the `index` parameter:

```javascript
// Error: "strict mode violation: selector resolved to 2 elements"
browser_click({ instanceId: "...", selector: "button:has-text('Enable')" })

// Solution: Use index to select which element
browser_click({
  instanceId: "...",
  selector: "button:has-text('Enable')",
  index: 0  // Click the first matching button
})

// Or index: 1 for second, etc.
```

The error message now includes helpful info:
```json
{
  "error": "Strict mode violation: selector resolved to 2 elements. Use 'index' parameter (0-1) to select one.",
  "data": { "elementCount": 2, "suggestion": "Add index: 0 for first element" }
}
```

### Troubleshooting Click Timeouts

**Problem:** `locator.click: Timeout 30000ms exceeded` on React/Vue sites like Notion, Shopify.

**Cause:** `:has-text()` and complex selectors often fail on modern SPAs due to:
- Shadow DOM
- Dynamic content loading
- Text that includes hidden characters

**Solution 1:** Use `index` parameter if multiple elements match.

**Solution 2:** Use `browser_evaluate` to find element coordinates, then click by position:

```javascript
// Step 1: Find element coordinates
browser_evaluate({
  instanceId: "...",
  script: `(() => {
    const el = [...document.querySelectorAll('button')]
      .find(b => b.textContent.includes('Continuer'));
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
  })()`
})

// Step 2: Click at coordinates
browser_click({
  instanceId: "...",
  position: { x: result.x, y: result.y },
  humanize: true
})
```

**Alternative:** Use `browser_snapshot` to get ARIA refs and click by ref:
```javascript
browser_click({ instanceId: "...", selector: "aria-ref=e14" })
```

## Token Optimization

HydraSpecter automatically optimizes LLM token usage:

### Expectation Filtering (browser_snapshot)

Filter ARIA snapshots to only return relevant elements:

```javascript
// Full page: ~5000 tokens
browser_snapshot({ instanceId: "..." })

// Filtered: ~2000 tokens (60% reduction)
browser_snapshot({
  instanceId: "...",
  expectation: "login form"  // Returns only form fields, buttons, inputs
})
```

**Built-in expectations:** `login`, `form`, `search`, `navigation`, `nav`, `menu`, `products`, `articles`, `list`, `table`, `buttons`, `links`, `inputs`, `dialog`, `modal`, `popup`

### Auto TOON Format (console/network logs)

Large tabular results (>500 tokens) are automatically formatted as TOON:

```yaml
# Instead of JSON:
# {"logs":[{"type":"error","text":"..."},{...}]}

# Auto TOON format:
logs:
  type, text, timestamp
  error, Error message, 1704500000
  warn, Warning message, 1704500001
```

**40-60% fewer tokens** with improved LLM accuracy.

### Response includes token stats:

```json
{
  "format": "toon",
  "content": "...",
  "tokenStats": {
    "jsonTokens": 850,
    "toonTokens": 340,
    "savings": "60%"
  }
}
```

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

### Persistent Mode (Recommended for 90% of use cases)

```javascript
// Create browser with persistent session
const result = browser_create({ url: "https://google.com" })
// → Acquires profile from pool (pool-0, pool-1, etc.)
// → Checks domain-intelligence.json for protection level
// → Applies appropriate humanize/headless settings
// → Returns { id: "page-abc", mode: "persistent", protectionLevel: 0, profileDir: "..." }

// Google login persists forever - login once, use everywhere!
// Next time you create a browser, you'll still be logged in

// Check/adjust protection level
browser_get_protection_level({ url: "https://google.com" })
// → { domain: "google.com", level: 0, settings: {...} }
```

### Incognito Mode (Anonymous scraping)

```javascript
// Fresh context each time
browser_create({
  url: "https://example.com",
  mode: "incognito"
})
// → Returns { id: "page-xyz", mode: "incognito" }
// No cookies, no localStorage, fresh start
```

### Isolated Mode (Device emulation, Firefox/WebKit)

```javascript
// Mobile device emulation
browser_create({
  mode: "isolated",
  device: "iPhone 14"
})

// Firefox testing
browser_create({
  mode: "isolated",
  browserType: "firefox",
  headless: false
})
```

### Standard Workflow

```javascript
// Create browser (default: persistent mode)
const { id } = browser_create({ url: "https://example.com" })

// Navigate
browser_navigate({ instanceId: id, url: "https://example.com/login" })

// Interact
browser_click({ instanceId: id, selector: "#login", humanize: "auto" })
browser_type({ instanceId: id, selector: "#email", text: "user@example.com" })

// Get page state
browser_snapshot({ instanceId: id })
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
