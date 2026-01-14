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

## Troubleshooting

### Not logged in (session not synced)
Chrome must be **closed** for auto-sync to copy cookies. If Chrome is open:
1. Close Chrome → restart Claude Code → sessions will sync
2. Or login manually in HydraSpecter browser (session persists in pool-0)

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
1. Sessions persist in ALL pools (pool-0 to pool-4), not just pool-0
2. `pool-0` gets Chrome cookies synced on first launch (when Chrome is closed)
3. Once logged in to any pool, that session persists forever
4. Auto-switch tries pool-0 first for auth domains, falls back to other pools if busy

### If not logged in:
Login manually once in the HydraSpecter browser - session will persist in that pool.

### Copy session between pools:
```powershell
Copy-Item -Path "$env:USERPROFILE\.hydraspecter\profiles\pool-1\*" -Destination "$env:USERPROFILE\.hydraspecter\profiles\pool-0\" -Recurse -Force
```

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
├── profiles/pool-{0-4}/     # Session data (cookies, localStorage)
├── domain-intelligence.json # Protection levels
└── api-bookmarks.json       # Saved API endpoints
```

## Architecture

```
src/
├── index.ts           # CLI
├── server.ts          # MCP handlers
├── browser-manager.ts # Instance lifecycle
├── global-profile.ts  # Session persistence
├── domain-intelligence.ts
├── api-bookmarks.ts
├── tools.ts           # Tool definitions
└── utils/             # Humanize, detection, resilience
```

## Don't

- Modify tool names in tools.ts
- Hardcode viewport sizes
- Store sessions per-project
