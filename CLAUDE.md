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

## Stealth Backends (Cloudflare Bypass)

Three backends available for bypassing anti-bot protections:

| Backend | Technology | Use Case |
|---------|------------|----------|
| `playwright` (default) | Chromium | Standard automation, fastest |
| `camoufox` | Firefox stealth | Cloudflare Turnstile bypass |
| `seleniumbase` | Chrome UC Mode | Fallback stealth, captcha solving |

### Auto-Selection

Backend is automatically selected based on domain:
- **chatgpt.com, claude.ai, perplexity.ai** → `camoufox`
- **youtube.com, google.com** → `playwright`
- Unknown domains → `playwright` with automatic fallback on Cloudflare detection

Rules stored in `~/.hydraspecter/backend-rules.json`.

### Force Backend

```javascript
// Force camoufox for Cloudflare-protected site
browser({ action: "create", target: "https://chatgpt.com", options: { backend: "camoufox" } })

// Force seleniumbase for captcha solving
browser({ action: "create", options: { backend: "seleniumbase" } })

// Auto-selection (default)
browser({ action: "create", target: "https://example.com", options: { backend: "auto" } })
```

### Backend Management Actions

```javascript
// List available backends and their status
browser({ action: "list_backends" })

// View auto-selection rules
browser({ action: "backend_rules" })

// Get current backend for an instance
browser({ action: "get_backend", pageId: "abc123" })

// Switch backend (closes and recreates)
browser({ action: "switch_backend", pageId: "abc123", options: { backend: "seleniumbase" } })
```

### Session Persistence per Backend

| Backend | Profile Location |
|---------|-----------------|
| Playwright | `~/.hydraspecter/profiles/pool-{0-9}/` |
| Camoufox | `~/.hydraspecter/camoufox-profile/` |
| SeleniumBase | `~/.hydraspecter/seleniumbase-profile/` |

Sessions persist across restarts. Login once, use forever.

### Automatic Fallback

If Cloudflare detected after navigation:
1. Current backend closes
2. Tries next backend in order: camoufox → seleniumbase → playwright
3. System learns from success/failure for future auto-selection

### Minimal Window Mode

For stealth backends, minimize window to 100x100 pixels at (0,0) with always-on-top:

```javascript
// Minimize window (non-intrusive corner)
browser({ action: "minimize", pageId: "abc123" })

// Restore to normal size
browser({ action: "restore", pageId: "abc123" })

// Custom size/position
browser({ action: "minimize", pageId: "abc123", options: { width: 200, height: 150, x: 50, y: 50 } })
```

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

### Monitoring
- `browser_get_network_logs` - XHR/fetch requests
- `browser_get_console_logs` - Console output

### API Bookmarks (LLM Memory)
- `browser_save_endpoint` - Save discovered API endpoint
- `browser_list_endpoints` - List saved endpoints
- `browser_get_endpoint` - Get endpoint details
- `browser_capture_from_network` - Auto-capture from network logs

### Protection & Profiles
- `browser_get_protection_level` / `browser_set_protection_level`
- `browser_list_profiles` / `browser_release_profile`
- `browser_switch_auth_profile` - Switch to pool-0 (auth sessions)

### Downloads
- `browser_trigger_download` - Trigger download (click selector or direct URL)
- `browser_wait_for_download` - Wait for download to complete
- `browser_get_downloads` - List all downloads for an instance

## Downloads

Downloads are saved persistently to `~/.hydraspecter/downloads/{pageId}/` and survive browser/session closure.

### Trigger Download

```javascript
// Click a download link
browser({ action: "trigger_download", pageId: "abc", target: "a[download]" })
browser({ action: "trigger_download", pageId: "abc", target: "#download-btn" })

// Direct URL download
browser({ action: "trigger_download", pageId: "abc", options: { url: "https://example.com/file.pdf" } })

// Custom filename
browser({ action: "trigger_download", pageId: "abc", target: "a.download", options: { filename: "report.pdf" } })
```

### Wait for Download

```javascript
// Wait for download after clicking
browser({ action: "wait_download", pageId: "abc" })

// With custom save path
browser({ action: "wait_download", pageId: "abc", options: { saveAs: "C:/Downloads/file.pdf" } })
```

### List Downloads

```javascript
// Get all downloads for an instance
browser({ action: "downloads", pageId: "abc" })
// Returns: { downloads: [...], count: N, downloadDir: "..." }
```

### Automatic Interception

Any download triggered in the browser is automatically intercepted and saved to the persistent directory. The `browser_get_downloads` action lists all downloads with their status (pending/completed/failed) and file paths.

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
├── profiles/pool-{0-9}/     # 10 concurrent session pools (Playwright)
├── camoufox-profile/        # Camoufox Firefox profile
├── seleniumbase-profile/    # SeleniumBase Chrome profile
├── downloads/{pageId}/      # Persistent downloads per instance
├── domain-intelligence.json # Protection levels
├── backend-rules.json       # Backend auto-selection rules
├── api-bookmarks.json       # Saved API endpoints
└── locks/                   # Pool lock files (prevent conflicts)
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── server.ts             # MCP handlers
├── browser-manager.ts    # Instance lifecycle
├── meta-tool.ts          # Unified browser tool (--meta mode)
├── global-profile.ts     # Session persistence
├── domain-intelligence.ts
├── api-bookmarks.ts
├── tools.ts              # Tool definitions
├── backends/
│   ├── types.ts             # IBrowserBackend interface
│   ├── backend-factory.ts   # Factory with lazy loading
│   ├── playwright-backend.ts
│   ├── camoufox-backend.ts
│   ├── seleniumbase-backend.ts
│   └── unified-backend.ts   # Auto-selection & fallback
├── detection/
│   ├── backend-selector.ts   # Domain-based auto-selection
│   ├── cloudflare-detector.ts
│   └── login-detector.ts
├── window/
│   └── minimal-window.ts     # 100x100 always-on-top window
└── utils/                # Humanize, detection, resilience
```

## Don't

- Modify tool names in tools.ts
- Hardcode viewport sizes
- Store sessions per-project
