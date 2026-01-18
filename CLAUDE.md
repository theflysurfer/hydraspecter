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

HydraSpecter supports two browser backends with automatic selection:

| Backend | Use Case | Features |
|---------|----------|----------|
| `auto` (default) | All sites | Selects backend based on domain rules in `~/.hydraspecter/backend-rules.json` |
| `playwright` | Most sites | Full features, network interception, ARIA tree, 10 pools |
| `seleniumbase` | Cloudflare-protected sites | Cloudflare bypass, session persistence via State Injection |

### Automatic Backend Selection

With `backend: "auto"` (now the default), HydraSpecter automatically selects:
- **SeleniumBase** for: chatgpt.com, claude.ai, perplexity.ai, openai.com
- **Playwright** for: all other sites

Rules are configured in `~/.hydraspecter/backend-rules.json`.

### Examples

```javascript
// Auto-selects SeleniumBase for chatgpt.com (no need to specify backend)
browser({ action: "create", target: "https://chatgpt.com" })

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
- **Persistent Chrome Profile**: `~/.hydraspecter/seleniumbase-profile/` stores all session data
- **Automatic persistence**: Login once → session persists forever (no manual save needed)

## Session Management (SeleniumBase)

Sessions persist AUTOMATICALLY via a persistent Chrome profile directory (`user_data_dir`).

### How it works

1. **First-time login**: Create browser, login manually, close browser
2. **Next time**: Browser automatically reuses the same Chrome profile → already logged in!
3. **No action needed**: Cookies, localStorage, IndexedDB all persist automatically

### Why this works (vs JSON export)

| Old approach (JSON) | New approach (Chrome profile) |
|---------------------|-------------------------------|
| Export cookies to JSON | Chrome stores everything natively |
| LocalStorage missing | All storage types included |
| Token rotation breaks it | Chrome handles token refresh |
| Session binding fails | Same Chrome instance identity |

**Google specifically** binds sessions to Chrome instance ID. JSON cookie injection CANNOT work.

### Workflow Example

```javascript
// Step 1: First-time login (ONE TIME ONLY)
browser({ action: "create", target: "https://accounts.google.com", options: { backend: "seleniumbase" } })
// → Login manually in the visible browser window
// → Close browser when done

// Step 2: Every time after - AUTOMATIC!
browser({ action: "create", target: "https://mail.google.com", options: { backend: "seleniumbase" } })
// → Already logged in to Google! No login page shown.

// Google OAuth also works:
browser({ action: "create", target: "https://chatgpt.com", options: { backend: "seleniumbase" } })
// → Click "Continue with Google" → OAuth uses same Google session
```

### Profile Location

```
~/.hydraspecter/seleniumbase-profile/
├── Default/
│   ├── Cookies          # Encrypted cookie database
│   ├── Local Storage/   # localStorage data
│   ├── IndexedDB/       # IndexedDB data
│   ├── Session Storage/ # sessionStorage
│   └── Preferences      # Chrome settings
└── Local State          # Encryption keys
```

### Important Notes

- **Single account**: The profile supports ONE account per service (one Google account, etc.)
- **2FA remembered**: After first 2FA, Chrome remembers the device
- **No expiration**: Sessions persist as long as the service allows (weeks/months)
- **Fresh profile**: First use creates a new profile (not copied from system Chrome)

### Legacy Session Actions (still available)

The `save_session`/`load_session` actions still exist for edge cases, but are NOT needed for Google:

| Action | Description |
|--------|-------------|
| `save_session` | Export cookies + localStorage to JSON (for non-Google sites) |
| `load_session` | Import session from JSON (for non-Google sites) |
| `list_sessions` | List JSON session files |

**Note**: For Google, Amazon, ChatGPT, and other secure sites, just rely on the automatic Chrome profile persistence.

### Auto-Save (Crash Protection)

Sessions are **automatically saved to JSON after every navigation**. This provides crash protection:

- Cookies and localStorage saved to `~/.hydraspecter/sessions/{domain}.json`
- Flag `autoSaved: true` marks automatic saves
- Protects against browser crashes or network issues
- Combined with persistent Chrome profile, sessions are virtually indestructible

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

### Window Control (SeleniumBase)
- `browser_minimize` - Minimize browser window (prevents focus stealing)
- `browser_restore` - Restore/maximize browser window

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

### Export Tools (SeleniumBase)
- `browser_export_perplexity` - Batch export all Perplexity threads to markdown

```javascript
// Export all Perplexity conversations (requires logged-in SeleniumBase session)
browser({ action: "export_perplexity", pageId: "abc" })

// With options
browser({
  action: "export_perplexity",
  pageId: "abc",
  options: {
    exportDir: "C:/custom/path",  // Default: exports/perplexity/ in Fetch GPT chats repo
    limit: 10,                     // Export only first 10 threads
    maxScrolls: 100,               // Max scroll iterations to load threads
    loadAll: true,                 // Scroll to load all threads (default: true)
    force: false                   // Re-export all (ignore tracker, default: false)
  }
})
```

**Features:**
- **Resume support**: Tracker file at `~/.hydraspecter/perplexity-export-tracker.json`
- **Skip already exported**: Automatically skips previously exported URLs
- **Crash protection**: Progress saved after each successful export
- **Auto-recovery**: Session errors trigger automatic driver reinitialization

**How it works:**
1. Loads tracker file (creates if missing)
2. Navigates to `perplexity.ai/library`
3. Scrolls to load all threads (infinite scroll)
4. Skips already exported URLs (from tracker)
5. Exports each new thread and saves immediately to tracker
6. Creates `_index.md` with ALL exported threads

**Python CLI alternative:**
```bash
python scripts/export_perplexity_hydra.py [--limit N] [--force] [--show-browser]
```

**Output structure:**
```
exports/perplexity/
├── _index.md                           # Index with links to all threads
├── thread-title-abc123.md              # Individual thread exports
├── another-thread-def456.md
└── ...
```

**Prerequisites:**
- SeleniumBase backend required
- Must be logged into Perplexity (session persists automatically)

- `browser_export_chatgpt` - Request data export from ChatGPT settings
- `browser_export_claude` - Request data export from Claude settings

```javascript
// Request ChatGPT data export (requires logged-in SeleniumBase session)
browser({ action: "export_chatgpt", pageId: "abc" })

// Request Claude data export (requires logged-in SeleniumBase session)
browser({ action: "export_claude", pageId: "abc" })
```

**How it works (ChatGPT/Claude):**
1. Navigates to settings page if not already there
2. Clicks through to Data/Privacy section
3. Clicks "Export Data" button
4. Confirms export in modal
5. Returns `{ status: "export_requested", email: "expected in 2-30 min" }`

**Return value:**
```json
{
  "status": "export_requested",
  "email": "Check your email (usually arrives in 2-30 minutes)",
  "verification": "Export requested successfully",
  "note": "Download link will be sent to your registered email. Link expires in 24 hours."
}
```

**Error cases:**
- Not logged in → Clear error message with login hint
- Button not found → Lists available buttons for debugging
- Modal didn't open → Suggests retrying

**Prerequisites:**
- SeleniumBase backend required
- Must be logged in (session persists automatically)

- `browser_wait_export_email` - Monitor Gmail for export emails and auto-download

```javascript
// Wait for ChatGPT export email (after calling export_chatgpt)
browser({ action: "wait_export_email", pageId: "abc", options: { source: "chatgpt" } })

// Wait for Claude export email (after calling export_claude)
browser({ action: "wait_export_email", pageId: "abc", options: { source: "claude" } })

// With custom options
browser({
  action: "wait_export_email",
  pageId: "abc",
  options: {
    source: "chatgpt",           // Required: 'chatgpt' or 'claude'
    timeout: 1800000,            // Max wait time in ms (default: 30 minutes)
    pollInterval: 30000,         // How often to check Gmail (default: 30 seconds)
    downloadDir: "C:/exports"    // Where to save ZIP (default: ~/Downloads)
  }
})
```

**How it works:**
1. Navigates to Gmail search with appropriate filter (from:openai.com or from:anthropic.com)
2. Polls for new emails matching export criteria every 30 seconds
3. When found, opens the email and extracts the download link
4. Clicks the download link and waits for the ZIP file
5. Returns the path to the downloaded file

**Return value (success):**
```json
{
  "status": "downloaded",
  "downloadPath": "C:/Users/.../Downloads/conversations-2024-01-15.zip",
  "emailSubject": "Your ChatGPT data export is ready",
  "sender": "help@openai.com",
  "waitTimeMs": 120000
}
```

**Return value (link found but download not detected):**
```json
{
  "status": "link_found",
  "downloadUrl": "https://chatgpt.com/...",
  "linkText": "Download your data",
  "note": "Download link was clicked but file was not detected. Check browser downloads."
}
```

**Full workflow example:**
```javascript
// 1. Request export from ChatGPT
browser({ action: "export_chatgpt", pageId: "abc" })
// Returns: { status: "export_requested", email: "Check your email in 2-30 minutes" }

// 2. Wait for export email and auto-download
browser({ action: "wait_export_email", pageId: "abc", options: { source: "chatgpt", timeout: 1800000 } })
// Returns: { status: "downloaded", downloadPath: "C:/Users/.../conversations.zip" }
```

**Prerequisites:**
- SeleniumBase backend required
- Must be logged in to Gmail (via Google account in SeleniumBase profile)
- Gmail must be in French or English (supports both)

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

### SeleniumBase session not persisting (login required every time)

**Cause**: The HTTP bridge reuses an OLD driver created BEFORE the profileDir fix was applied.

**Solution**: Force driver reinitialization by sending `quit` command:
```bash
curl -X POST http://127.0.0.1:47482 -H "Content-Type: application/json" -d '{"action": "quit", "params": {}}'
```

Then recreate the browser - it will now use the persistent profile.

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
├── seleniumbase-profile/          # SeleniumBase persistent Chrome profile
│   ├── Default/                   # Chrome user data (cookies, localStorage, etc.)
│   └── Local State                # Encryption keys
├── sessions/                      # Legacy JSON session files (optional)
├── seleniumbase-http-bridge.py    # HTTP bridge Python script
├── bridge-state.json              # HTTP bridge state (PID, port)
├── domain-intelligence.json       # Protection levels
├── api-bookmarks.json             # Saved API endpoints
├── perplexity-export-tracker.json # Export progress tracker (resume support)
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
├── exporters/
│   ├── perplexity-exporter.ts       # Perplexity DOM scraping & markdown export
│   └── gmail-export-monitor.ts      # Gmail monitoring for export emails
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
