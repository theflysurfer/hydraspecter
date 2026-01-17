# HydraSpecter

Browser automation MCP server with stealth, session persistence, and anti-detection.

**Hot Reload**: MCP SDK 1.25.2 enables automatic tool reload. No restart needed after `npm run build`.

## Quick Start

```javascript
// Default: persistent mode (sessions saved, anti-detection on)
browser_create({ url: "https://google.com" })

// With --meta flag: use action parameter
browser({ action: "create", url: "https://google.com" })
```

## Modes

| Mode | Use Case |
|------|----------|
| `persistent` (default) | Google, Amazon, Notion - sessions persist forever |
| `incognito` | Anonymous scraping, fresh context |
| `isolated` | Device emulation, Firefox/WebKit, multi-account |

```javascript
browser_create({ mode: "incognito" })
browser_create({ mode: "isolated", device: "iPhone 14" })
browser_create({ mode: "isolated", browserType: "firefox" })
```

## Backend Selection

HydraSpecter supports two browser backends:

| Backend | Use Case | Features |
|---------|----------|----------|
| `playwright` (default) | Most sites | Full features, network interception, ARIA tree, 10 pools |
| `seleniumbase` | Cloudflare-protected sites | Cloudflare bypass, session persistence via State Injection |
| `auto` | Unknown sites | Tries Playwright first, falls back to SeleniumBase if blocked |

### When to use SeleniumBase

Use `backend: "seleniumbase"` for:
- **chatgpt.com** - Heavy Cloudflare Turnstile protection
- **openai.com** - Cloudflare protection
- **claude.ai**, **perplexity.ai** - Cloudflare protection
- Sites that block Playwright even with stealth plugins

### Examples

```javascript
// Cloudflare-protected site
browser({ action: "create", target: "https://chatgpt.com", options: { backend: "seleniumbase" } })

// Auto-detect and fallback
browser({ action: "create", target: "https://unknown-site.com", options: { backend: "auto" } })
```

### SeleniumBase Limitations

When using `backend: "seleniumbase"`, these features are **NOT available**:
- `browser_get_network_logs` - No network interception
- `browser_enable_network_monitoring` - No network interception
- `browser_capture_from_network` - No endpoint capture
- `browser_get_console_logs` - No console capture
- `browser_enable_console_capture` - No console capture
- Multi-pool (pool-0 to pool-9) - Single profile only
- Ghost-cursor humanization - Basic delays only

**Note**: `browser_snapshot` uses DOM parsing instead of ARIA tree (still works but format differs).

### Prerequisites

SeleniumBase requires Python:
```bash
pip install seleniumbase
```

### Architecture

SeleniumBase uses an **HTTP Bridge** pattern for persistence across MCP restarts:

```
┌─────────────────┐       HTTP        ┌──────────────────────┐
│   HydraSpecter  │ ──────────────────│  Python HTTP Server  │
│   (TypeScript)  │   port 47482      │  (seleniumbase-http- │
└─────────────────┘                   │   bridge.py)         │
                                      │                      │
                                      │  ┌────────────────┐  │
                                      │  │ SeleniumBase   │  │
                                      │  │ UC Driver      │  │
                                      │  │ (Chrome)       │  │
                                      │  └────────────────┘  │
                                      └──────────────────────┘
```

- **HTTP Bridge**: Python HTTP server on port 47482 persists across MCP restarts
- **State Injection**: Cookies/localStorage exported to JSON, re-injected on restart
- **Sessions stored**: `~/.hydraspecter/sessions/{domain}.json`

## Session Management (SeleniumBase)

Sessions are automatically saved and loaded for SeleniumBase instances.

### How it works

1. **First-time login**: Create browser, login manually, save session
2. **Auto-load**: Next time you create a browser for that domain, session is auto-loaded
3. **Refresh required**: After load, page auto-refreshes to apply cookies

### Session Actions

| Action | Description |
|--------|-------------|
| `save_session` | Export cookies + localStorage to `~/.hydraspecter/sessions/{domain}.json` |
| `load_session` | Import session for a domain (auto-called on create if session exists) |
| `list_sessions` | List all saved sessions |

### Workflow Example

```javascript
// Step 1: First-time login to Google
browser({ action: "create", target: "https://google.com", options: { backend: "seleniumbase" } })
// → Login manually in the browser window
browser({ action: "save_session", pageId: "abc" })
// → Session saved to ~/.hydraspecter/sessions/google.com.json

// Step 2: Login to AI site (uses Google OAuth)
browser({ action: "create", target: "https://claude.ai", options: { backend: "seleniumbase" } })
browser({ action: "load_session", pageId: "abc", options: { domain: "google.com" } })
browser({ action: "refresh", pageId: "abc" })
// → Google cookies now available for OAuth
// → Click "Continue with Google" button
// → OAuth popup works because Google session is loaded
browser({ action: "save_session", pageId: "abc" })
// → Session saved to ~/.hydraspecter/sessions/claude.ai.json

// Step 3: Next time - fully automatic!
browser({ action: "create", target: "https://claude.ai", options: { backend: "seleniumbase" } })
// → Auto-loads claude.ai.json → Already logged in!
```

### Saved Sessions Location

```
~/.hydraspecter/sessions/
├── google.com.json      # Google account (for OAuth)
├── claude.ai.json       # Claude (Anthropic)
├── chatgpt.com.json     # ChatGPT (OpenAI)
├── perplexity.ai.json   # Perplexity
└── {domain}.json        # Any other site
```

### Important Notes

- **Google session first**: Load `google.com` session before OAuth-based logins
- **2FA**: Some sites (ChatGPT) require 2FA code on first login - manual step
- **Session expiry**: Sessions expire based on site's cookie policy (weeks/months)
- **One profile**: SeleniumBase uses single Chrome profile (not 10 pools like Playwright)

## Device Emulation (Mobile/Tablet Testing)

Test responsive design across **90+ real devices** with accurate viewport, user agent, and touch emulation.

### Quick Examples
```javascript
// iPhone
browser({ action: "create", options: { mode: "isolated", device: "iPhone 15 Pro" } })

// Android
browser({ action: "create", options: { mode: "isolated", device: "Pixel 7" } })

// Tablet
browser({ action: "create", options: { mode: "isolated", device: "iPad Pro 11" } })

// Landscape mode
browser({ action: "create", options: { mode: "isolated", device: "iPhone 14 landscape" } })
```

### Available Devices

| Category | Count | Examples |
|----------|-------|----------|
| **iPhone** | 56 | iPhone 6 → 15 Pro Max (+ landscape) |
| **iPad** | 10 | iPad Mini, Pro 11, Gen 5-7 |
| **Pixel** | 14 | Pixel 2 → 7 |
| **Galaxy** | 14 | Galaxy S5 → S9+, Tab S4 |

### List & Filter Devices
```javascript
// List all devices
browser({ action: "devices" })

// Filter by name
browser({ action: "devices", options: { filter: "iphone" } })
browser({ action: "devices", options: { filter: "ipad" } })
browser({ action: "devices", options: { filter: "pixel" } })
```

### Device Config Includes
- **Viewport**: Exact screen dimensions
- **User Agent**: Authentic mobile UA string
- **Touch**: Touch events enabled
- **Mobile mode**: Mobile browser behavior

## Protection Levels (Auto-learned)

| Level | Humanize | Headless | Delays |
|-------|----------|----------|--------|
| 0 | Off | Yes | None |
| 1 | On | Yes | 100-300ms |
| 2 | On | No | 300-800ms |
| 3 | On | No | 500-1500ms |

Detection triggers automatic level increment. Persists to `~/.hydraspecter/domain-intelligence.json`.

## Tools Reference

### Core
- `browser_create` - Create browser (returns `id`)
- `browser_navigate` - Navigate to URL
- `browser_click` - Click (has auto-resilience: scroll, force, position fallback)
- `browser_type` / `browser_fill` - Text input
- `browser_snapshot` - ARIA tree (use `expectation` param to filter)
- `browser_screenshot` - Screenshot
- `browser_close_instance` / `browser_close_all_instances`

### Navigation
- `browser_go_back` / `browser_go_forward` - History navigation
- `browser_refresh` - Reload page
- `browser_evaluate` - Execute JavaScript

### Monitoring (Playwright only)
- `browser_get_network_logs` - XHR/fetch requests
- `browser_get_console_logs` - Console output

### API Bookmarks (LLM Memory)
- `browser_save_endpoint` - Save discovered API endpoint
- `browser_list_endpoints` - List saved endpoints
- `browser_get_endpoint` - Get endpoint details
- `browser_capture_from_network` - Auto-capture from network logs

### Session Management (SeleniumBase)
- `browser_save_session` - Export cookies/localStorage to JSON file
- `browser_load_session` - Import session for a domain
- `browser_list_sessions` - List all saved sessions

### Protection & Profiles (Playwright)
- `browser_get_protection_level` / `browser_set_protection_level`
- `browser_list_profiles` / `browser_release_profile`
- `browser_switch_auth_profile` - Switch to pool-0 (auth sessions)

### Anti-Detection (Cloudflare Turnstile)
- `browser_solve_turnstile` - Auto-detect and click Turnstile checkbox

```javascript
// Try to solve Turnstile challenge
browser({ action: "solve_turnstile", pageId: "abc" })

// With options
browser({ action: "solve_turnstile", pageId: "abc", options: { maxAttempts: 5, waitAfterClick: 5000 } })
```

**Enhanced stealth** is applied automatically:
- navigator.webdriver = false
- Fake plugins/languages
- WebGL spoofing
- Chrome runtime mock
- Canvas fingerprint noise

**Always-humanize domains** (automatic human-like behavior):
- chatgpt.com, openai.com, claude.ai, perplexity.ai
- amazon.com, amazon.fr, temu.com
- cloudflare.com

## Troubleshooting

### Not logged in (session not synced)

**Chrome v127+ uses App-Bound encryption (v20)** - cookies are tied to Chrome's identity and CANNOT be copied to Chromium/HydraSpecter.

**Solution: Manual login once per site**
1. Create a browser: `browser({ action: "create", target: "https://notion.so/login" })`
2. Login manually in the visible HydraSpecter window (pool-0)
3. Sync to all pools:
```powershell
.\scripts\sync-pools.ps1
```

This copies cookies from pool-0 → pool-1 to pool-9. Sessions persist until cookie expiration.

### Click fails on SPA (React/Vue)
```javascript
browser_click({ selector: "button", index: 0 })  // Use index
browser_click({ position: { x: 100, y: 200 } })  // Or coordinates
```

### Cross-origin iframe (Google Sign-In)
Use `position` parameter with coordinates from `browser_evaluate`.

### Cloudflare Turnstile blocks access

**Best solution: Use SeleniumBase backend**
```javascript
browser({ action: "create", target: "https://chatgpt.com", options: { backend: "seleniumbase" } })
```

**Alternative approaches**:

1. **Try solve_turnstile action** (Playwright):
```javascript
browser({ action: "solve_turnstile", pageId: "abc" })
```

2. **Manual login once**:
   - Use `headless: false` mode (default in persistent mode)
   - Click the checkbox manually
   - Sessions persist after that

3. **Use non-headless mode** (recommended for Turnstile sites):
```javascript
browser({ action: "create", target: "https://chatgpt.com", options: { headless: false } })
```

**Sites with Turnstile**: chatgpt.com, openai.com, claude.ai, perplexity.ai

### Chrome warning banner

If you see a yellow banner: "Vous utilisez un flag de ligne de commande non pris en charge"

This warning is caused by `--disable-blink-features=AutomationControlled` flag used by puppeteer-extra-plugin-stealth. The `--test-type` flag should suppress it, but if it persists:
- It's **cosmetic only** and doesn't affect functionality
- SeleniumBase backend doesn't show this warning

## Authentication-Required Domains

Some domains are USELESS without login. The system auto-detects these and warns if using wrong profile.

### Auth REQUIRED (useless without login):
- **Google private**: gmail.com, mail.google.com, calendar.google.com, drive.google.com, docs.google.com, sheets.google.com, meet.google.com
- **Notion workspace**: notion.so (NOT notion.site = public pages)
- **Private messaging**: slack.com, outlook.com, teams.microsoft.com

### Auth OPTIONAL (can scrape without login):
- **Code hosting**: github.com, gitlab.com (public repos)
- **E-commerce**: amazon.com, shopping sites
- **Public content**: google.com (search), youtube.com, notion.site, discord.com (public servers), figma.com (public designs)

### How it works:
1. **10 pools** (pool-0 to pool-9) for concurrent sessions
2. Login once on pool-0, then sync to all pools with `.\scripts\sync-pools.ps1`
3. Sessions persist until cookie expiration
4. 10 LLMs can run in parallel, each with auth sessions

### First-time setup per site:
1. `browser({ action: "create", target: "https://site.com/login" })`
2. Login in the visible browser window
3. Close browser, run `.\scripts\sync-pools.ps1`

### Common mistakes:
- ❌ `browser({ action: "create", target: "https://notion.so" })` → Redirects to marketing page
- ✅ `browser({ action: "create", target: "https://notion.so/[page-id]" })` → Direct to workspace
- ❌ `options: {"pool": "pool-1"}` → This parameter doesn't exist
- ✅ Just use `target` with the full URL

## MCP Configuration

### File Hierarchy

| File | Valid | Usage |
|------|-------|-------|
| `~/.claude.json` → `mcpServers` | Yes | Global config |
| `.mcp.json` (project root) | Yes | Project config (priority) |
| `~/.claude/.mcp.json` | **No** | Not read |

### Recommended Config

In `~/.claude.json`:
```json
{
  "mcpServers": {
    "hydraspecter": {
      "type": "stdio",
      "command": "node",
      "args": ["path/to/dist/index.js", "--meta", "--humanize-auto", "--channel", "chrome"]
    }
  }
}
```

### --meta Flag

| Mode | Tools | Tokens |
|------|-------|--------|
| Without | 43 individual tools | ~31k |
| With `--meta` | 1 unified `browser` tool | ~2k |

**Restart Claude Code after config changes.**

## Storage

```
~/.hydraspecter/
├── profiles/pool-{0-9}/           # 10 concurrent session pools (Playwright)
├── sessions/                      # SeleniumBase session files
│   ├── google.com.json            # Cookies + localStorage per domain
│   ├── claude.ai.json
│   └── chatgpt.com.json
├── seleniumbase-http-bridge.py    # HTTP bridge Python script
├── bridge-state.json              # HTTP bridge state (PID, port)
├── domain-intelligence.json       # Protection levels
├── api-bookmarks.json             # Saved API endpoints
└── locks/                         # Pool lock files (prevent conflicts)
```

## Architecture

```
src/
├── index.ts              # CLI
├── server.ts             # MCP handlers
├── browser-manager.ts    # Instance lifecycle
├── global-profile.ts     # Session persistence (Playwright)
├── browser-adapter.ts    # Backend abstraction layer
├── backends/
│   ├── seleniumbase-driver.ts       # SeleniumBase stdin/stdout bridge
│   └── seleniumbase-http-driver.ts  # SeleniumBase HTTP bridge (persistent)
├── domain-intelligence.ts
├── api-bookmarks.ts
├── meta-tool.ts          # Unified browser tool (~2k tokens)
├── tools.ts              # Tool definitions (~31k tokens)
└── utils/
    ├── humanize.ts       # Human-like delays
    ├── stealth-scripts.ts # Anti-detection scripts
    ├── turnstile-handler.ts # Cloudflare Turnstile solver
    └── detection-monitor.ts # Bot detection monitoring
```

## Don't

- Modify tool names in tools.ts
- Hardcode viewport sizes
- Store sessions per-project
