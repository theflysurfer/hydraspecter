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

### Video Streams
- `browser_capture_stream` - Capture HLS/DASH manifest URLs and generate download commands
- `browser_download_stream` - Download video via ffmpeg to ~/.hydraspecter/videos/

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

## Video Stream Capture

Capture HLS (.m3u8) and DASH (.mpd) streaming manifest URLs from video platforms like Arte, Le Monde, etc.

### Workflow

```javascript
// 1. Create browser with network monitoring
browser({ action: "create", options: { enableNetworkMonitoring: true } })

// 2. Navigate to video page
browser({ action: "navigate", pageId: "abc", target: "https://www.arte.tv/fr/videos/..." })

// 3. Wait for video player to load (player auto-fetches manifests)
// Then capture the stream
browser({ action: "capture_stream", pageId: "abc" })
```

### Options

```javascript
// Best quality (default)
browser({ action: "capture_stream", pageId: "abc" })

// Worst quality (for testing)
browser({ action: "capture_stream", pageId: "abc", options: { quality: "worst" } })

// Custom URL pattern
browser({ action: "capture_stream", pageId: "abc", target: "m3u8" })

// Save to bookmarks
browser({ action: "capture_stream", pageId: "abc", options: { saveName: "arte-documentary" } })
```

### Download Video (via ffmpeg)

```javascript
// Download best quality (default)
browser({ action: "download_stream", pageId: "abc" })

// Download worst quality (for testing)
browser({ action: "download_stream", pageId: "abc", options: { quality: "worst" } })

// Custom filename
browser({ action: "download_stream", pageId: "abc", options: { filename: "documentary.mp4" } })
```

**Destination:** `~/.hydraspecter/videos/{pageId}/`

**Requires:** ffmpeg installed and in PATH.

### Output

```json
{
  "manifests": [{
    "url": "https://manifest-arte.akamaized.net/.../video.m3u8",
    "type": "hls",
    "selectedQuality": {
      "url": "https://cdn.../video_1080p.m3u8",
      "bandwidth": 5000000,
      "resolution": "1920x1080"
    },
    "variants": [...],
    "audioTracks": [{ "language": "fr", "name": "Français" }],
    "subtitles": [{ "language": "en", "name": "English" }]
  }],
  "downloadCommands": {
    "ffmpeg": "ffmpeg -i ... -c copy output.mp4",
    "ytdlp": "yt-dlp ..."
  }
}
```

### Supported Sites

| Site | Format | DRM | Notes |
|------|--------|-----|-------|
| Arte | HLS | No | Full support |
| Le Monde | HLS | No | Full support |
| Netflix | DASH | Widevine | Manifest only (DRM blocks download) |

### DRM Warning

For DRM-protected content (Netflix, etc.), the manifest URL is captured but direct download won't work due to encryption. Use specialized tools like `anystream` or screen recording.

## CSS/JS Injection

Inject custom CSS and JavaScript into web pages. Workflow: Dev in HydraSpecter → Publish to Chrome extension.

### Quick Injection

```javascript
// Inject CSS (live preview)
browser({ action: "inject_css", pageId: "abc", options: { css: "body { background: #000; }" } })

// Inject JS
browser({ action: "inject_js", pageId: "abc", options: { js: "document.title = 'Modified'" } })

// With ID for later removal/update
browser({ action: "inject_css", pageId: "abc", options: { css: "...", id: "my-style" } })
```

### Save & Publish Rules

```javascript
// Save rule (status: dev - only in HydraSpecter)
browser({ action: "save_rule", options: {
  name: "Google Dark Mode",
  urlPattern: "*://www.google.com/*",
  css: "body { background: #1a1a1a !important; }"
}})

// List all rules
browser({ action: "rules" })

// Publish to Chrome extension (status: prod)
browser({ action: "publish_rule", options: { ruleId: "google-dark-mode-xyz" } })

// Delete rule
browser({ action: "delete_rule", options: { ruleId: "..." } })
```

### Rule Status

| Status | Description |
|--------|-------------|
| `dev` | Only applied in HydraSpecter (for testing) |
| `prod` | Synced to Chrome extension (for daily use) |

### URL Pattern

Glob-style patterns:
- `*://www.google.com/*` - Google homepage
- `*://*.google.com/*` - All Google subdomains
- `https://github.com/*/issues/*` - GitHub issues

### Storage

Rules are stored in `~/.hydraspecter/injection-rules.json`.

## Troubleshooting

### Camoufox Session Persistence (Fixed 2026-01-30)

**Problem**: Camoufox sessions weren't persisting between browser restarts on Windows.

**Root Cause**: The `data_dir` option in camoufox-js causes a crash on Windows:
```
browserType.launchPersistentContext: Target page, context or browser has been closed
```

**Solution Implemented**: Manual `storageState` save/restore instead of `data_dir`:

1. **On browser close** (`camoufox-backend.ts:close()`):
   - Call `context.storageState()` to get all cookies + localStorage
   - Save to `~/.hydraspecter/camoufox-state.json`

2. **On browser create** (`camoufox-backend.ts:create()`):
   - Load state from `camoufox-state.json` if exists
   - Pass to `browser.newContext({ storageState: savedState })`
   - Or call `context.addCookies(savedState.cookies)` for persistent context

**Files Modified**:
- `src/backends/camoufox-backend.ts` - Added `loadState()`, `saveState()` methods
- `src/tools.ts` - Fixed auto-selection to actually use selected backend

**Debug Steps if Broken Again**:
1. Check if state file exists: `ls -la ~/.hydraspecter/camoufox-state.json`
2. Check file size (should be >100KB after login): `wc -c camoufox-state.json`
3. Check cookies count in file: `grep -c '"name":' camoufox-state.json`
4. Look for errors in logs: `[CamoufoxBackend] Failed to save/load state`
5. If state file is small (<10KB), cookies weren't saved - check `close()` was called

**Known Limitations**:
- Single camoufox profile (all AI sites share same session)
- If you need multi-account, use different backends or manual cookie management

**Tested & Working (2026-01-30)**:
| Site | Backend | Persistence | Notes |
|------|---------|-------------|-------|
| ChatGPT | camoufox (auto) | ✅ | Full interface, GPTs list, account visible |
| Perplexity | camoufox (auto) | ✅ | Pro account, auto-login via Google cookies |
| Claude.ai | camoufox (auto) | ✅ | "Evening, Julien", Opus 4.5 available |

**How Google SSO works across sites**:
1. Login to ChatGPT with Google → Google cookies saved to `camoufox-state.json`
2. Open Perplexity → Detects Google cookies → Auto-login
3. Open Claude.ai → Same Google cookies → Auto-login
4. All sessions persist because they share the same state file

### Auto-Selection Not Working (Fixed 2026-01-30)

**Problem**: `browser({ action: "create", target: "https://chatgpt.com" })` was using Playwright instead of camoufox.

**Root Cause**: In `tools.ts`, the auto-selection check was done but the result wasn't used:
```typescript
// BEFORE (broken)
const requestedBackend = args.backend || 'auto';
if (requestedBackend === 'auto' && args.url) {
  const selectedBackend = backendSelector.selectBackend(args.url);
  // selectedBackend was IGNORED! requestedBackend stayed 'auto'
}
```

**Solution**: Use the auto-selected backend value:
```typescript
// AFTER (fixed)
let effectiveBackend = args.backend || 'auto';
if (effectiveBackend === 'auto' && args.url) {
  const selectedBackend = backendSelector.selectBackend(args.url);
  if (stealthBackends.includes(selectedBackend)) {
    effectiveBackend = selectedBackend; // Now it's actually used!
  }
}
```

**Debug Steps if Broken Again**:
1. Check backend rules exist: `browser({ action: "backend_rules" })`
2. Look for log: `[AUTO-SELECT] URL https://chatgpt.com → backend camoufox`
3. If log missing, check `getBackendSelector().selectBackend(url)` returns correct backend
4. Verify MCP was restarted after code changes (or use `restart_server` action)

### Not logged in (session not synced)

**Chrome v127+ uses App-Bound encryption (v20)** - cookies are tied to Chrome's identity and CANNOT be copied from real Chrome to HydraSpecter.

**Solution: Manual login once per site in HydraSpecter**
1. Create a browser: `browser({ action: "create", target: "https://notion.so/login" })`
2. Login manually in the visible HydraSpecter window (pool-0)
3. Close browser, then sync to all pools:
```powershell
.\scripts\sync-pools.ps1
```

**What sync-pools.ps1 copies (CRITICAL for session persistence)**:

| Data | Location | Why |
|------|----------|-----|
| **Cookies** | `Default/Network/Cookies` | Authentication tokens |
| **IndexedDB** | `Default/IndexedDB/` | Modern app sessions (React/Vue SPAs) |
| **Local Storage** | `Default/Local Storage/` | JWT tokens, user preferences |
| **Session Storage** | `Default/Session Storage/` | Temporary session data |
| **Service Worker** | `Default/Service Worker/` | PWA cache, offline data |
| **Local State** | `Local State` | Chrome encryption key |
| **History** | `Default/History` | Anti-detection (looks lived-in) |
| **Web Data** | `Default/Web Data` | Form autofill |

**IndexedDB is critical!** Many modern sites (HomeExchange, Notion, etc.) store auth tokens in IndexedDB, not cookies. Without IndexedDB sync, sessions appear logged out even with cookies present.

**Debug if sessions don't work after sync**:
```powershell
# Check IndexedDB size (should be >1MB if logged into sites)
(Get-Item "$env:USERPROFILE\.hydraspecter\profiles\pool-0\Default\IndexedDB").Length / 1MB

# Compare pool-0 vs pool-4
(Get-Item "$env:USERPROFILE\.hydraspecter\profiles\pool-4\Default\IndexedDB").Length / 1MB
```

If sizes differ significantly, run sync again after closing all browsers.

### Pool sync worked but still not logged in (Fixed 2026-01-30)

**Problem**: `sync-pools.ps1` reported "9/9 pools synced" but sessions on pool-1+ were not logged in.

**Root Cause**: The sync script was NOT copying **IndexedDB** where modern SPAs store auth tokens.

| Pool | IndexedDB Size | Result |
|------|----------------|--------|
| pool-0 | 11 MB | Logged in |
| pool-4 | 11 KB | NOT logged in |

**Solution**: Added IndexedDB, Session Storage, and Service Worker to sync script.

**Files Modified**:
- `scripts/sync-pools.ps1` - Added `Default\IndexedDB`, `Default\Session Storage`, `Default\Service Worker` to `$SyncDirs`

**After fix**:
```
pool-0: 11 MB IndexedDB → Logged in
pool-4: 11 MB IndexedDB → Logged in (synced correctly)
```

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
- **Messaging apps**: web.whatsapp.com, web.telegram.org (QR code login, auto-switches to pool-0)

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
├── camoufox-profile/        # Camoufox Firefox profile (not used for persistence)
├── camoufox-state.json      # Camoufox session state (cookies, localStorage) - THIS is the persistence
├── seleniumbase-profile/    # SeleniumBase Chrome profile
├── downloads/{pageId}/      # Persistent downloads per instance
├── domain-intelligence.json # Protection levels
├── backend-rules.json       # Backend auto-selection rules
├── api-bookmarks.json       # Saved API endpoints
├── injection-rules.json     # CSS/JS injection rules
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
├── injection/
│   ├── types.ts              # InjectionRule interface
│   ├── rule-manager.ts       # CRUD for injection rules
│   └── injector.ts           # CSS/JS injection utilities
├── extension/            # Chrome extension (HydraSpecter Inject)
│   ├── manifest.json         # Manifest V3
│   ├── background.js         # Service worker
│   ├── content.js            # CSS/JS injection
│   └── popup.html/js         # Extension UI
├── native-host/          # Native messaging host
│   ├── host.js               # Node.js bridge
│   ├── host.bat              # Windows wrapper
│   └── install.ps1           # Registry installer
└── utils/                # Humanize, detection, resilience
```

## Don't

- Modify tool names in tools.ts
- Hardcode viewport sizes
- Store sessions per-project
