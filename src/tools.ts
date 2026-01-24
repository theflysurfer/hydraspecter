import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Page, devices, ConsoleMessage, Request, Response } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { BrowserManager } from './browser-manager.js';
import { smartFormat } from './utils/toon-formatter.js';
import {
  ToolResult,
  NavigationOptions,
  ClickOptions,
  TypeOptions,
  ScreenshotOptions,
  ScrollOptions,
  HumanizeConfig,
  HumanizeMode,
  RateLimitConfig
} from './types.js';

/** Console log entry */
interface ConsoleLogEntry {
  type: string;
  text: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
  timestamp: number;
}

/** Network request/response entry */
interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  postData?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseSize?: number;
  timing?: { startTime: number; endTime?: number; duration?: number };
}

/** Download entry */
interface DownloadEntry {
  suggestedFilename: string;
  url: string;
  path?: string;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}
// humanClick removed - using locator.boundingBox() + humanMove directly for better index support
import { humanType, humanTypeInElement } from './utils/human-typing.js';
import { humanScrollDown, humanScrollUp, humanScrollToElement, humanScrollToTop, humanScrollToBottom } from './utils/human-scroll.js';
import { DetectionMonitor, DetectionResult } from './utils/detection-monitor.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { resilientClick, DEFAULT_RESILIENCE, type ResilienceOptions } from './utils/click-resilience.js';
import { getGlobalProfile, GlobalProfile, AllProfilesInUseError, switchToAuthProfile } from './global-profile.js';
import { getDomainIntelligence, DomainIntelligence, requiresAuth } from './domain-intelligence.js';
import { getApiBookmarks } from './api-bookmarks.js';
import { getJobManager } from './job-manager.js';

/**
 * Transform jQuery-style selectors to Playwright-compatible selectors.
 * Common LLM mistakes:
 * - :contains('text') → :has-text("text")  (jQuery → Playwright)
 * - :eq(0) → :nth-child(1)
 * - :first → :first-child
 * - :last → :last-child
 */
/**
 * Extract nth index from selector if present (e.g., "button >> nth=1" → { selector: "button", index: 1 })
 */
function extractNthFromSelector(selector: string): { selector: string; index?: number } {
  const nthMatch = selector.match(/\s*>>\s*nth=(\d+)\s*$/);
  if (nthMatch && nthMatch[1]) {
    return {
      selector: selector.replace(/\s*>>\s*nth=\d+\s*$/, '').trim(),
      index: parseInt(nthMatch[1], 10)
    };
  }
  return { selector };
}

function normalizeSelector(selector: string): string {
  if (!selector) return selector;

  let normalized = selector;

  // Transform :contains('text') or :contains("text") to :has-text("text")
  // jQuery: :contains('Portions') → Playwright: :has-text("Portions")
  normalized = normalized.replace(
    /:contains\(['"]([^'"]+)['"]\)/g,
    ':has-text("$1")'
  );

  // Transform :eq(n) to :nth-child(n+1)
  normalized = normalized.replace(
    /:eq\((\d+)\)/g,
    (_, n) => `:nth-child(${parseInt(n) + 1})`
  );

  // Transform :first to :first-child
  normalized = normalized.replace(/:first\b/g, ':first-child');

  // Transform :last to :last-child
  normalized = normalized.replace(/:last\b/g, ':last-child');

  // Log transformation if changed
  if (normalized !== selector) {
    console.error(`[Selector] Normalized: "${selector}" → "${normalized}"`);
  }

  return normalized;
}

/**
 * Generate fallback selectors when tag[attr] pattern fails.
 *
 * Problem: ARIA snapshots show "button 'text'" but the element is often
 * <div role="button" aria-label="text"> not <button>
 *
 * When button[aria-label="text"] fails, try:
 * 1. [aria-label="text"] (remove tag, let attr match any element)
 * 2. [role="button"][aria-label="text"] (use role instead of tag)
 *
 * @param selector Original selector that failed
 * @returns Array of fallback selectors to try (empty if not applicable)
 */
function generateTagAttrFallbacks(selector: string): string[] {
  // Match patterns like: tag[attr="value"] or tag[attr='value'] or tag[attr]
  // Examples: button[aria-label="Save"], a[href="/home"], div[data-testid]
  const tagAttrMatch = selector.match(/^([a-z][a-z0-9]*)\[([^\]]+)\]$/i);

  if (!tagAttrMatch || !tagAttrMatch[1] || !tagAttrMatch[2]) {
    return [];
  }

  const tag = tagAttrMatch[1];
  const attrPart = tagAttrMatch[2];

  // Don't generate fallbacks for generic tags that are usually correct
  const genericTags = ['div', 'span', 'section', 'article', 'main', 'nav', 'aside', 'header', 'footer'];
  if (genericTags.includes(tag.toLowerCase())) {
    return [];
  }

  const fallbacks: string[] = [];

  // Fallback 1: Remove tag, keep attribute (most likely to work)
  // button[aria-label="text"] → [aria-label="text"]
  fallbacks.push(`[${attrPart}]`);

  // Fallback 2: Use role instead of tag
  // button[aria-label="text"] → [role="button"][aria-label="text"]
  // Only for tags that have standard role mappings
  const roleMap: Record<string, string> = {
    'button': 'button',
    'a': 'link',
    'input': 'textbox',
    'select': 'combobox',
    'img': 'img',
    'table': 'table',
    'form': 'form',
    'dialog': 'dialog',
    'menu': 'menu',
    'menuitem': 'menuitem',
    'tab': 'tab',
    'tabpanel': 'tabpanel',
    'listbox': 'listbox',
    'option': 'option',
    'checkbox': 'checkbox',
    'radio': 'radio',
    'slider': 'slider',
    'switch': 'switch',
    'progressbar': 'progressbar',
    'alert': 'alert',
    'alertdialog': 'alertdialog',
    'tooltip': 'tooltip',
    'tree': 'tree',
    'treeitem': 'treeitem',
    'grid': 'grid',
    'gridcell': 'gridcell',
  };

  const role = roleMap[tag.toLowerCase()];
  if (role) {
    fallbacks.push(`[role="${role}"][${attrPart}]`);
  }

  return fallbacks;
}

export class BrowserTools {
  private humanizeConfig: HumanizeConfig;
  private detectionMonitor: DetectionMonitor;
  private rateLimiter: RateLimiter;
  private globalProfile: GlobalProfile;
  private domainIntelligence: DomainIntelligence;
  // Cache detection results per URL to avoid repeated checks
  private detectionCache: Map<string, { result: DetectionResult; timestamp: number }> = new Map();
  private readonly DETECTION_CACHE_TTL = 30000; // 30 seconds
  // Map pageId to Page for global profile pages
  private globalPages: Map<string, Page> = new Map();
  // Map pageId to Browser for incognito contexts (for cleanup)
  private incognitoBrowsers: Map<string, import('playwright').Browser> = new Map();
  // Console logs storage per instance/page
  private consoleLogs: Map<string, ConsoleLogEntry[]> = new Map();
  // Network logs storage per instance/page
  private networkLogs: Map<string, NetworkEntry[]> = new Map();
  // Network monitoring enabled flag per instance/page
  private networkMonitoringEnabled: Set<string> = new Set();
  // Downloads storage per instance/page
  private downloads: Map<string, DownloadEntry[]> = new Map();

  constructor(
    private browserManager: BrowserManager,
    humanizeConfig?: HumanizeConfig,
    rateLimitConfig?: RateLimitConfig,
    options?: { poolSize?: number; headless?: boolean; channel?: 'chrome' | 'msedge' }
  ) {
    this.humanizeConfig = humanizeConfig || {};
    this.detectionMonitor = new DetectionMonitor({
      alwaysHumanizeDomains: humanizeConfig?.alwaysHumanizeDomains
    });
    this.rateLimiter = new RateLimiter(rateLimitConfig);
    this.globalProfile = getGlobalProfile({
      headless: options?.headless ?? false, // Default visible for anti-detection
      channel: options?.channel,
      poolSize: options?.poolSize,
    });
    this.domainIntelligence = getDomainIntelligence();
  }

  /**
   * Get a Page object by instance ID (public method for MetaTool)
   * @param instanceId The instance or page ID
   * @returns Page object or null if not found
   */
  public getPage(instanceId: string): Page | null {
    // Check global pages first
    if (this.globalPages.has(instanceId)) {
      return this.globalPages.get(instanceId) || null;
    }

    // Check browser manager instances
    const instance = this.browserManager.getInstance(instanceId);
    if (instance) {
      return instance.page;
    }

    return null;
  }

  /**
   * Convert internal ToolResult to MCP-compliant CallToolResult format
   */
  private toMcpResult(result: ToolResult, options?: { isImage?: boolean }): CallToolResult {
    if (!result.success) {
      return {
        content: [{ type: 'text', text: result.error || 'Unknown error' }],
        isError: true,
      };
    }

    // Handle screenshot results (base64 image)
    if (options?.isImage && result.data?.screenshot) {
      return {
        content: [
          {
            type: 'image',
            data: result.data.screenshot,
            mimeType: result.data.type === 'jpeg' ? 'image/jpeg' : 'image/png',
          },
        ],
        isError: false,
      };
    }

    // Standard text result
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      isError: false,
    };
  }

  /**
   * Check if humanize should be enabled for a specific action
   * Supports: true, false, or "auto" (detection-based)
   */
  private async shouldHumanizeAsync(
    page: Page,
    actionType: 'mouse' | 'typing' | 'scroll',
    explicitValue?: HumanizeMode
  ): Promise<boolean> {
    // If explicitly set in the request (true/false), use that value
    if (explicitValue === true || explicitValue === false) {
      return explicitValue;
    }

    // Get the mode from config
    const mode = explicitValue === 'auto' ? 'auto' : this.humanizeConfig[actionType];

    // If mode is true/false, return it directly
    if (mode === true || mode === false) {
      return mode;
    }

    // If mode is "auto", run detection
    if (mode === 'auto') {
      return await this.checkDetectionForPage(page);
    }

    // Default: no humanize
    return false;
  }


  /**
   * Check if page shows detection signals (cached)
   */
  private async checkDetectionForPage(page: Page): Promise<boolean> {
    const url = page.url();
    const now = Date.now();

    // Check cache first
    const cached = this.detectionCache.get(url);
    if (cached && (now - cached.timestamp) < this.DETECTION_CACHE_TTL) {
      return cached.result.shouldHumanize;
    }

    // Run detection
    const result = await this.detectionMonitor.checkPage(page);

    // Cache result
    this.detectionCache.set(url, { result, timestamp: now });

    // Log if detection triggered
    if (result.detected) {
      console.error(`[DetectionMonitor] ${result.type || 'detection'}: ${result.details} (confidence: ${result.confidence})`);
    }

    return result.shouldHumanize;
  }

  /**
   * Get last detection result for a page
   */
  getLastDetectionResult(url: string): DetectionResult | null {
    const cached = this.detectionCache.get(url);
    return cached?.result || null;
  }

  /**
   * Clear detection cache for a URL
   */
  clearDetectionCache(url?: string): void {
    if (url) {
      this.detectionCache.delete(url);
    } else {
      this.detectionCache.clear();
    }
  }

  /**
   * Setup console log capture for a page
   */
  private setupConsoleCapture(instanceId: string, page: Page): void {
    if (!this.consoleLogs.has(instanceId)) {
      this.consoleLogs.set(instanceId, []);
    }

    page.on('console', (msg: ConsoleMessage) => {
      const logs = this.consoleLogs.get(instanceId) || [];
      const location = msg.location();
      logs.push({
        type: msg.type(),
        text: msg.text(),
        location: location ? {
          url: location.url,
          lineNumber: location.lineNumber,
          columnNumber: location.columnNumber
        } : undefined,
        timestamp: Date.now()
      });
      // Keep last 1000 logs
      if (logs.length > 1000) logs.shift();
      this.consoleLogs.set(instanceId, logs);
    });
  }

  /**
   * Setup network monitoring for a page
   */
  private setupNetworkMonitoring(instanceId: string, page: Page): void {
    if (this.networkMonitoringEnabled.has(instanceId)) return;

    if (!this.networkLogs.has(instanceId)) {
      this.networkLogs.set(instanceId, []);
    }

    const requestMap = new Map<string, { entry: NetworkEntry; startTime: number }>();

    page.on('request', (request: Request) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const entry: NetworkEntry = {
        id,
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        requestHeaders: request.headers(),
        postData: request.postData() || undefined,
        timing: { startTime: Date.now() }
      };
      requestMap.set(request.url() + request.method(), { entry, startTime: Date.now() });
    });

    page.on('response', async (response: Response) => {
      const request = response.request();
      const key = request.url() + request.method();
      const pending = requestMap.get(key);

      if (pending) {
        const endTime = Date.now();
        pending.entry.status = response.status();
        pending.entry.statusText = response.statusText();
        pending.entry.responseHeaders = response.headers();
        pending.entry.timing = {
          startTime: pending.startTime,
          endTime,
          duration: endTime - pending.startTime
        };

        // Try to get response size
        try {
          const body = await response.body();
          pending.entry.responseSize = body.length;
        } catch {
          // Response body not available
        }

        const logs = this.networkLogs.get(instanceId) || [];
        logs.push(pending.entry);
        // Keep last 500 network entries
        if (logs.length > 500) logs.shift();
        this.networkLogs.set(instanceId, logs);
        requestMap.delete(key);
      }
    });

    this.networkMonitoringEnabled.add(instanceId);
  }

  /**
   * Setup download handling for a page
   */
  private setupDownloadHandling(instanceId: string, page: Page): void {
    if (!this.downloads.has(instanceId)) {
      this.downloads.set(instanceId, []);
    }

    page.on('download', async (download) => {
      const entry: DownloadEntry = {
        suggestedFilename: download.suggestedFilename(),
        url: download.url(),
        status: 'pending'
      };

      const downloads = this.downloads.get(instanceId) || [];
      downloads.push(entry);
      this.downloads.set(instanceId, downloads);

      try {
        // Wait for download to complete
        const path = await download.path();
        entry.path = path || undefined;
        entry.status = 'completed';
      } catch (error) {
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : String(error);
      }
    });
  }

  /**
   * Get list of available device names for emulation
   */
  getAvailableDevices(): string[] {
    return Object.keys(devices);
  }

  /**
   * Get all tool definitions
   */
  getTools(): Tool[] {
    return [
      // Browser creation tool (unified)
      {
        name: 'browser_create',
        description: `Create a browser page.

🔑 DEFAULT: Use without parameters for Google, Amazon, Notion, GitHub - sessions persist forever, no login needed!

✅ PERSISTENT MODE (default):
• Cookies/localStorage saved automatically
• Google OAuth works - login once, use everywhere
• Best anti-detection (headless=false, stealth enabled)
• Uses REAL Chrome browser (not Chromium) for best session compatibility
• Auto-syncs sessions from your Chrome profile (cookies, localStorage, IndexedDB)
• Recommended for 90% of use cases

**Modes:**
• persistent (default): Session persists between MCP restarts, perfect for authenticated sites
• incognito: Fresh context each time, no saved data, still uses profile pool for anti-detection
• isolated: Completely separate browser (Firefox/WebKit, device emulation, multi-account)

**Browser Engine:**
• persistent/incognito: Uses real Chrome (better session handling, anti-detection)
• isolated: Uses Chromium (required for Firefox/WebKit, device emulation)

**Examples:**
• Default (persistent) → browser_create({ url: "https://google.com" })
• Anonymous scraping → browser_create({ mode: "incognito", url: "https://example.com" })
• Mobile testing → browser_create({ mode: "isolated", device: "iPhone 14" })
• Firefox testing → browser_create({ mode: "isolated", browserType: "firefox" })

⚠️ ISOLATED MODE - Only use when you specifically need:
• Non-Chromium browsers (Firefox, WebKit)
• Device emulation (mobile, tablet)
• Multiple accounts on same site simultaneously
• Custom viewport or user agent
Note: Isolated mode creates a fresh browser each time (no session persistence by default)

Returns id to use with other browser_* tools.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Optional URL to navigate to after creating the browser'
            },
            mode: {
              type: 'string',
              enum: ['persistent', 'incognito', 'isolated'],
              description: 'Browser mode (default: persistent)',
              default: 'persistent'
            },
            // Options for isolated mode only
            browserType: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit'],
              description: 'Browser engine (isolated mode only). Use "chromium" for best compatibility.',
              default: 'chromium'
            },
            headless: {
              type: 'boolean',
              description: 'Run without visible window (isolated mode only). Default false for better anti-detection.',
              default: false
            },
            device: {
              type: 'string',
              description: 'Device to emulate (isolated mode only). E.g., "iPhone 14", "Pixel 7", "iPad Pro 11". Use browser_list_devices for full list.'
            },
            viewport: {
              type: 'object',
              properties: {
                width: { type: 'number', default: 1280 },
                height: { type: 'number', default: 720 }
              },
              description: 'Fixed viewport size (isolated mode only). Ignored if device is specified.'
            },
            userAgent: {
              type: 'string',
              description: 'Custom user agent (isolated mode only). Ignored if device is specified. Not recommended - browser default is less detectable.'
            },
            metadata: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Human-readable name for this browser' },
                description: { type: 'string', description: 'What this browser is used for' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering (e.g., ["shopping", "temu"])' }
              },
              description: 'Optional metadata (isolated mode only)'
            },
            storageStatePath: {
              type: 'string',
              description: 'Path to JSON file from browser_save_session (isolated mode only). Restores cookies and localStorage.'
            },
            // Monitoring options (all modes)
            enableConsoleCapture: {
              type: 'boolean',
              description: 'Enable console log capture. Use browser_get_console_logs to retrieve.',
              default: false
            },
            enableNetworkMonitoring: {
              type: 'boolean',
              description: 'Enable network request/response monitoring. Use browser_get_network_logs to retrieve.',
              default: false
            },
            // Backend selection (all modes - stealth backends persist sessions too)
            backend: {
              type: 'string',
              enum: ['auto', 'playwright', 'camoufox', 'seleniumbase'],
              description: 'Browser backend. "auto" uses playwright (default). "camoufox" for Firefox stealth (Cloudflare bypass), "seleniumbase" for Chrome UC (anti-bot sites). Sessions persist for all backends.',
              default: 'auto'
            },
            // Async mode for slow backends (camoufox, seleniumbase)
            async: {
              type: 'boolean',
              description: 'Return immediately with jobId instead of waiting. Use job_status to check completion. Auto-enabled for slow backends (camoufox, seleniumbase) to avoid MCP timeout.',
              default: false
            }
          }
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier - use this as instanceId in other tools' },
            mode: { type: 'string', description: 'Browser mode: persistent/incognito/isolated' },
            backend: { type: 'string', description: 'Backend used: playwright/camoufox/seleniumbase (isolated mode)' },
            url: { type: 'string' },
            browserType: { type: 'string', description: 'Browser engine (isolated mode only)' },
            protectionLevel: { type: 'number', description: 'Current protection level 0-3 (persistent/incognito modes)' },
            settings: {
              type: 'object',
              properties: {
                humanize: { type: 'boolean' },
                headless: { type: 'boolean' }
              }
            },
            profileDir: { type: 'string', description: 'Path to persistent profile (persistent mode only)' },
            createdAt: { type: 'string', description: 'ISO timestamp' },
            // Async job fields
            jobId: { type: 'string', description: 'Job ID when async=true. Use job_status to check completion.' },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'], description: 'Job status when async=true' },
            progress: { type: 'string', description: 'Progress message when async=true' }
          },
          required: ['id', 'mode']
        }
      },
      {
        name: 'browser_save_session',
        description: 'Save the current session state (cookies, localStorage) to a JSON file for later restoration',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            filePath: {
              type: 'string',
              description: 'Path where to save the session state JSON file'
            }
          },
          required: ['instanceId', 'filePath']
        },
        outputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            saved: { type: 'boolean' }
          },
          required: ['filePath', 'saved']
        }
      },

      // Async job status
      {
        name: 'job_status',
        description: `Check status of an async browser creation job.

When browser_create returns a jobId (for slow backends like camoufox/seleniumbase),
use this tool to check if the browser is ready.

**Status values:**
• pending - Job queued, not started yet
• running - Browser is being created (may take 30-60s for stealth backends)
• completed - Browser ready! Use the returned instanceId with browser_* tools
• failed - Creation failed, check error message

**Tip:** Poll every 5-10s until status is "completed" or "failed".`,
        inputSchema: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'Job ID from browser_create async response'
            }
          },
          required: ['jobId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] },
            progress: { type: 'string', description: 'Human-readable progress message' },
            progressPercent: { type: 'number', description: 'Progress percentage 0-100' },
            result: {
              type: 'object',
              description: 'Browser details when status=completed',
              properties: {
                instanceId: { type: 'string' },
                backend: { type: 'string' },
                url: { type: 'string' }
              }
            },
            error: { type: 'string', description: 'Error message when status=failed' },
            createdAt: { type: 'string' },
            completedAt: { type: 'string' }
          },
          required: ['jobId', 'status']
        }
      },

      // Zero-config global profile tools
      {
        name: 'browser_get_protection_level',
        description: `Get the current protection level for a domain. Levels are AUTO-LEARNED from detection events:
• 0 = standard (no humanize, headless)
• 1 = humanize enabled (mouse, typing, scroll simulation)
• 2 = visible browser + delays (300-800ms)
• 3 = aggressive delays (500-1500ms)
Levels increase automatically when anti-bot detection is encountered.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL or domain to check'
            }
          },
          required: ['url']
        },
        outputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Normalized root domain (e.g., google.com)' },
            level: { type: 'number', description: 'Protection level 0-3' },
            settings: { type: 'object', description: 'Applied settings for this level' },
            lastDetection: { type: 'string', description: 'ISO timestamp of last detection event' },
            detectionCount: { type: 'number', description: 'Total detection events for this domain' }
          }
        }
      },
      {
        name: 'browser_set_protection_level',
        description: 'Manually set protection level for a domain. Use this to pre-configure known difficult sites or override auto-learned levels.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL or domain to configure'
            },
            level: {
              type: 'number',
              enum: [0, 1, 2, 3],
              description: 'Protection level: 0=standard, 1=humanize, 2=visible+delays, 3=aggressive'
            }
          },
          required: ['url', 'level']
        },
        outputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            level: { type: 'number' },
            settings: { type: 'object' }
          }
        }
      },
      {
        name: 'browser_reset_protection',
        description: 'Reset protection level for a domain back to 0 (standard). Use after site changes or if current level is too aggressive.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL or domain to reset'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'browser_list_domains',
        description: 'List all domains with learned protection levels. Shows which sites have been accessed and their current anti-detection settings.',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        outputSchema: {
          type: 'object',
          properties: {
            domains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  level: { type: 'number' },
                  lastSuccess: { type: 'string' },
                  lastDetection: { type: 'string' },
                  detectionCount: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'browser_list_profiles',
        description: `List all profiles in the pool and their lock status.

Returns:
• Available profiles (ready to use)
• Locked profiles (PID, started time, can be force-released if stale)

Use this to troubleshoot "all profiles in use" errors.`,
        inputSchema: {
          type: 'object',
          properties: {}
        },
        outputSchema: {
          type: 'object',
          properties: {
            profiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  path: { type: 'string' },
                  available: { type: 'boolean' },
                  lock: {
                    type: 'object',
                    properties: {
                      pid: { type: 'number' },
                      startedAt: { type: 'string' },
                      mcpId: { type: 'string' }
                    }
                  },
                  isStale: { type: 'boolean' }
                }
              }
            },
            currentProfile: { type: 'string', description: 'Profile ID used by this process (null if none)' }
          }
        }
      },
      {
        name: 'browser_release_profile',
        description: `Force release a locked profile AND close its browser context.

Use when:
• A previous session crashed without cleanup
• The lock is stale (PID no longer running)
• You need to access locked files (cookies, localStorage)

Returns: { released: true, contextClosed: true } when browser was closed.

⚠️ This closes all pages in the profile. Only use if you're sure the profile is not in active use.`,
        inputSchema: {
          type: 'object',
          properties: {
            profileId: {
              type: 'string',
              description: 'Profile ID to release (e.g., "pool-0")'
            }
          },
          required: ['profileId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            released: { type: 'boolean' },
            profileId: { type: 'string' }
          }
        }
      },
      {
        name: 'browser_switch_auth_profile',
        description: `Switch to pool-0 (the authenticated profile with synced Chrome sessions).

Use when navigating to auth-required domains like:
• Notion (notion.so)
• Gmail (mail.google.com)
• Google Calendar (calendar.google.com)
• Slack, Teams, etc.

This closes the current browser context and reopens with pool-0.
pool-0 is automatically synced from your real Chrome profile.

Returns:
• success: true if switched to pool-0
• previousProfile: the profile that was closed
• newProfile: should be "pool-0"
• error: if pool-0 is locked by another process`,
        inputSchema: {
          type: 'object',
          properties: {}
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            previousProfile: { type: 'string' },
            newProfile: { type: 'string' },
            error: { type: 'string' }
          }
        }
      },

      // Device emulation
      {
        name: 'browser_list_devices',
        description: `List all available devices for emulation.

Returns device names that can be used with browser_create in isolated mode.
Common devices: "iPhone 14", "iPhone 14 Pro Max", "Pixel 7", "iPad Pro 11", "Galaxy S23".`,
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Filter devices by name (case-insensitive). E.g., "iphone", "pixel", "ipad"'
            }
          }
        },
        outputSchema: {
          type: 'object',
          properties: {
            devices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  viewport: { type: 'object' },
                  userAgent: { type: 'string' },
                  isMobile: { type: 'boolean' },
                  hasTouch: { type: 'boolean' }
                }
              }
            },
            count: { type: 'number' }
          }
        }
      },

      // Console logs
      {
        name: 'browser_get_console_logs',
        description: `Get captured console logs from a page.

Console capture must be enabled when creating the instance (enableConsoleCapture: true) or use browser_enable_console_capture.

Returns: log entries with type (log, warn, error, info, debug), text, location, and timestamp.

**Auto Token Optimization:** Large result sets (>500 tokens) are automatically formatted as TOON (40-60% fewer tokens).`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            },
            filter: {
              type: 'string',
              enum: ['all', 'error', 'warn', 'log', 'info', 'debug'],
              description: 'Filter by log type',
              default: 'all'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of logs to return (default: 100)',
              default: 100
            },
            clear: {
              type: 'boolean',
              description: 'Clear logs after retrieval',
              default: false
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_enable_console_capture',
        description: 'Enable console log capture for an existing page. Logs are stored per instance.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            }
          },
          required: ['instanceId']
        }
      },

      // Network monitoring
      {
        name: 'browser_enable_network_monitoring',
        description: `Enable network request/response monitoring for a page.

Captures: URL, method, headers, status, timing, response size.
Use browser_get_network_logs to retrieve captured data.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_get_network_logs',
        description: `Get captured network requests/responses.

Returns: URL, method, status, timing, response size.
By default excludes headers and truncates POST data to save tokens.

**Filters:** resourceType (xhr, fetch, document), urlPattern (regex)
**Token saving:** compact=true (default) excludes headers, truncates postData`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            },
            filter: {
              type: 'string',
              description: 'Filter by resource type (e.g., "xhr", "fetch", "document", "script")'
            },
            urlPattern: {
              type: 'string',
              description: 'Filter by URL pattern (regex supported)'
            },
            limit: {
              type: 'number',
              description: 'Maximum entries to return (default: 30)',
              default: 30
            },
            compact: {
              type: 'boolean',
              description: 'Exclude headers, truncate postData (default: true). Set false for full details.',
              default: true
            },
            clear: {
              type: 'boolean',
              description: 'Clear logs after retrieval',
              default: false
            }
          },
          required: ['instanceId']
        }
      },

      // PDF generation
      {
        name: 'browser_generate_pdf',
        description: `Generate a PDF from the current page. Only works with Chromium in headless mode.

Options: page size, margins, scale, header/footer templates, page ranges.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            },
            path: {
              type: 'string',
              description: 'File path to save PDF. If omitted, returns base64 encoded PDF.'
            },
            format: {
              type: 'string',
              enum: ['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
              description: 'Paper format (default: Letter)',
              default: 'Letter'
            },
            landscape: {
              type: 'boolean',
              description: 'Use landscape orientation',
              default: false
            },
            scale: {
              type: 'number',
              description: 'Scale of the webpage rendering (0.1-2.0, default: 1)',
              default: 1
            },
            margin: {
              type: 'object',
              properties: {
                top: { type: 'string', description: 'Top margin (e.g., "1cm", "0.5in")' },
                right: { type: 'string' },
                bottom: { type: 'string' },
                left: { type: 'string' }
              },
              description: 'Page margins'
            },
            printBackground: {
              type: 'boolean',
              description: 'Print background graphics',
              default: true
            },
            pageRanges: {
              type: 'string',
              description: 'Page ranges to print (e.g., "1-5, 8, 11-13")'
            }
          },
          required: ['instanceId']
        }
      },

      // File downloads
      {
        name: 'browser_wait_for_download',
        description: `Wait for a download to start and complete.

Use this after clicking a download link. Returns download path and filename.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            },
            saveAs: {
              type: 'string',
              description: 'Custom path to save the downloaded file'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000)',
              default: 30000
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_wait_for_request',
        description: `Wait for a network request matching a URL pattern.

**Workflow:**
1. Enable network monitoring (create with enableNetworkMonitoring or enable_network)
2. Call wait_request with urlPattern
3. Perform the UI action that triggers the request
4. Get the captured request details

Returns: URL, method, headers, postData, status, response details.
Ideal for capturing API calls during user interactions.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            },
            urlPattern: {
              type: 'string',
              description: 'URL pattern to match (regex supported)'
            },
            method: {
              type: 'string',
              description: 'HTTP method filter (GET, POST, etc.)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 10000)',
              default: 10000
            }
          },
          required: ['instanceId', 'urlPattern']
        }
      },
      {
        name: 'browser_get_downloads',
        description: 'Get list of downloads for an instance (completed and pending).',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID or Page ID'
            }
          },
          required: ['instanceId']
        }
      },

      {
        name: 'browser_list_instances',
        description: 'List all browser instances',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        outputSchema: {
          type: 'object',
          properties: {
            instances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  createdAt: { type: 'string' },
                  lastUsed: { type: 'string' },
                  isActive: { type: 'boolean' },
                  metadata: { type: 'object' }
                }
              }
            },
            count: { type: 'number' }
          },
          required: ['instances', 'count']
        }
      },
      {
        name: 'browser_close_instance',
        description: 'Close the specified browser instance',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            }
          },
          required: ['instanceId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            closed: { type: 'boolean' },
            instanceId: { type: 'string' }
          },
          required: ['closed']
        }
      },
      {
        name: 'browser_close_all_instances',
        description: 'Close all browser instances',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        outputSchema: {
          type: 'object',
          properties: {
            closed: { type: 'number', description: 'Number of instances closed' }
          },
          required: ['closed']
        }
      },

      // Navigation tools
      {
        name: 'browser_navigate',
        description: 'Navigate to a specified URL',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            url: {
              type: 'string',
              description: 'Target URL',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            },
            waitUntil: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle'],
              description: 'Wait condition',
              default: 'load'
            }
          },
          required: ['instanceId', 'url']
        },
        outputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Current URL after navigation' },
            title: { type: 'string', description: 'Page title' }
          },
          required: ['url', 'title']
        }
      },
      {
        name: 'browser_go_back',
        description: 'Go back to the previous page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_go_forward',
        description: 'Go forward to the next page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_refresh',
        description: 'Refresh the current page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            }
          },
          required: ['instanceId']
        }
      },

      // Page interaction tools
      {
        name: 'browser_click',
        description: `Click on a page element with **automatic resilience**. Auto-recovers from common failures:
• Element not visible → auto-scroll into view
• Overlay blocks click → auto-retry with force, dismiss overlays
• Selector timeout → fallback to position-based click

Use CSS selectors (e.g., "#btn", ".class") or ARIA refs from browser_snapshot (e.g., "aria-ref=e14"). For cross-origin iframes (like Google Sign-In), use position {x, y} to click at absolute coordinates.

⚠️ MULTIPLE ELEMENTS? Use 'index' parameter:
- "strict mode violation: resolved to 2 elements" → Add index: 0 for first element

Resilience is enabled by default (maxRetries: 3). Set maxRetries: 0 to disable.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'CSS selector ("#id", ".class", "button") or ARIA ref from snapshot ("aria-ref=e14"). Optional if position is provided.',
            },
            position: {
              type: 'object',
              description: 'Click at absolute coordinates (useful for cross-origin iframes like Google Sign-In). Use browser_evaluate to get element position first.',
              properties: {
                x: { type: 'number', description: 'X coordinate in pixels' },
                y: { type: 'number', description: 'Y coordinate in pixels' }
              },
              required: ['x', 'y']
            },
            frame: {
              type: 'string',
              description: 'Optional: CSS selector for iframe to click inside (e.g., "iframe[src*=\\"google\\"]" for Google login buttons)',
            },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button',
              default: 'left'
            },
            clickCount: {
              type: 'number',
              description: 'Number of clicks',
              default: 1
            },
            delay: {
              type: 'number',
              description: 'Click delay in milliseconds',
              default: 0
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            },
            humanize: {
              type: ['boolean', 'string'],
              enum: [true, false, 'auto'],
              description: 'Use human-like mouse movement: true (always), false (never), or "auto" (only when detection signals are found like Cloudflare, CAPTCHAs, rate limits)',
              default: false
            },
            index: {
              type: 'number',
              description: 'Select nth matching element (0-based). Use when "strict mode violation" error shows multiple elements. E.g., index: 0 for first match.',
            },
            force: {
              type: 'boolean',
              description: 'Force click even if another element obscures the target. Use when "pointer events intercepted" error occurs.',
              default: false
            },
            // Resilience options
            autoScroll: {
              type: 'boolean',
              description: 'Auto-scroll to element if not visible (default: true)',
              default: true
            },
            autoForce: {
              type: 'boolean',
              description: 'Auto-retry with force:true on overlay interception errors (default: true)',
              default: true
            },
            positionFallback: {
              type: 'boolean',
              description: 'Fall back to position-based click on selector timeout (default: true)',
              default: true
            },
            maxRetries: {
              type: 'number',
              description: 'Max retry attempts for recoverable errors (default: 3). Set to 0 to disable resilience.',
              default: 3
            },
            retryDelay: {
              type: 'number',
              description: 'Base delay between retries in ms (default: 500)',
              default: 500
            },
            dismissOverlays: {
              type: 'boolean',
              description: 'Try to dismiss known overlays (cookie consent, modals, Gemini panel) blocking the click (default: true)',
              default: true
            }
          },
          required: ['instanceId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string' },
            clicked: { type: 'boolean' },
            humanized: { type: 'boolean' },
            autoDetected: { type: 'boolean' },
            attempts: { type: 'number', description: 'Number of click attempts made' },
            recoveryApplied: {
              type: 'array',
              items: { type: 'string' },
              description: 'Recovery strategies applied (e.g., "scroll", "force", "dismiss_overlay", "position_fallback")'
            },
            fallbackUsed: { type: 'boolean', description: 'True if position fallback was used' }
          },
          required: ['clicked']
        }
      },
      {
        name: 'browser_type',
        description: 'Type text into an element',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            text: {
              type: 'string',
              description: 'Text to input',
            },
            delay: {
              type: 'number',
              description: 'Input delay in milliseconds',
              default: 0
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            },
            humanize: {
              type: ['boolean', 'string'],
              enum: [true, false, 'auto'],
              description: 'Use human-like typing: true (always), false (never), or "auto" (only when detection signals are found)',
              default: false
            }
          },
          required: ['instanceId', 'selector', 'text']
        },
        outputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string' },
            text: { type: 'string' },
            typed: { type: 'boolean' },
            humanized: { type: 'boolean' },
            autoDetected: { type: 'boolean' }
          },
          required: ['selector', 'typed']
        }
      },
      {
        name: 'browser_fill',
        description: 'Fill a form field',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            value: {
              type: 'string',
              description: 'Value to fill',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            },
            humanize: {
              type: ['boolean', 'string'],
              enum: [true, false, 'auto'],
              description: 'Use human-like typing: true (always), false (never), or "auto" (only when detection signals are found)',
              default: false
            }
          },
          required: ['instanceId', 'selector', 'value']
        }
      },
      {
        name: 'browser_select_option',
        description: 'Select an option from a dropdown',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            value: {
              type: 'string',
              description: 'Value to select',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'value']
        }
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page with optional human-like physics (momentum, overshoot, micro-pauses)',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'top', 'bottom'],
              description: 'Scroll direction: up/down for relative scroll, top/bottom for absolute',
              default: 'down'
            },
            amount: {
              type: 'number',
              description: 'Amount to scroll in pixels (for up/down directions)',
              default: 300
            },
            selector: {
              type: 'string',
              description: 'Optional: scroll to bring this element into view'
            },
            humanize: {
              type: ['boolean', 'string'],
              enum: [true, false, 'auto'],
              description: 'Use physics-based scrolling: true (always), false (never), or "auto" (only when detection signals are found)',
              default: false
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId']
        }
      },

      // Page information tools
      {
        name: 'browser_get_page_info',
        description: 'Get page info with FULL HTML content. WARNING: HTML can be ~90k tokens. Prefer browser_snapshot (~2-8k) or browser_get_markdown (~2k) for content extraction.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_get_element_text',
        description: 'Get element text content',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_get_element_attribute',
        description: 'Get element attribute value',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            attribute: {
              type: 'string',
              description: 'Attribute name',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'attribute']
        }
      },

      // Screenshot tool
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the page or element. WARNING: Screenshots consume ~50-100k tokens. Prefer browser_snapshot (ARIA tree, ~2-8k tokens) when possible.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            fullPage: {
              type: 'boolean',
              description: 'Whether to capture the full page',
              default: false
            },
            selector: {
              type: 'string',
              description: 'Element selector (capture specific element)'
            },
            type: {
              type: 'string',
              enum: ['png', 'jpeg'],
              description: 'Image format',
              default: 'png'
            },
            quality: {
              type: 'number',
              description: 'Image quality (1-100, JPEG only)',
              minimum: 1,
              maximum: 100,
              default: 80
            }
          },
          required: ['instanceId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            screenshot: { type: 'string', description: 'Base64-encoded image data' },
            type: { type: 'string', enum: ['png', 'jpeg'] },
            selector: { type: 'string' }
          },
          required: ['screenshot', 'type']
        }
      },

      // Wait tools
      {
        name: 'browser_wait_for_element',
        description: 'Wait for an element to appear',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_wait_for_navigation',
        description: 'Wait for page navigation to complete',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId']
        }
      },

      // JavaScript execution tool
      {
        name: 'browser_evaluate',
        description: 'Execute JavaScript code in the page context',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            script: {
              type: 'string',
              description: 'JavaScript code to execute',
            }
          },
          required: ['instanceId', 'script']
        }
      },

      // Content extraction tool
      {
        name: 'browser_get_markdown',
        description: `Get page content in Markdown format, optimized for large language models.

**Token Optimization:** Use truncateStrategy: "smart" to preserve:
- All headings (h1-h6)
- First paragraph after each heading
- Important semantic markers
Instead of just cutting off at maxLength.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            includeLinks: {
              type: 'boolean',
              description: 'Whether to include links',
              default: true
            },
            maxLength: {
              type: 'number',
              description: 'Maximum content length in characters',
              default: 10000
            },
            truncateStrategy: {
              type: 'string',
              enum: ['simple', 'smart'],
              description: '"simple" (default): cut at maxLength. "smart": preserve headings and first paragraphs',
              default: 'simple'
            },
            selector: {
              type: 'string',
              description: 'Optional CSS selector to extract content from specific element only'
            }
          },
          required: ['instanceId']
        }
      },

      // ARIA Snapshot tool - Token-efficient accessibility tree
      {
        name: 'browser_snapshot',
        description: `Capture accessibility tree snapshot (ARIA). Much more token-efficient than screenshots (~2-8k tokens vs ~100k for screenshots). Returns structured YAML representation of page elements.

**Token Optimization:** Use 'expectation' parameter to filter results:
- expectation: "login form" → Returns only form fields, buttons, inputs
- expectation: "navigation" → Returns only nav, links, menus
- expectation: "products" → Returns only product cards, prices, images
Reduces tokens by 30-50% for focused queries.`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create'
            },
            selector: {
              type: 'string',
              description: 'Optional CSS selector to scope the snapshot to a specific element'
            },
            expectation: {
              type: 'string',
              description: 'Filter results to match expectation (e.g., "login form", "navigation", "products", "search results"). Returns only relevant elements, reducing tokens by 30-50%.'
            },
            maxElements: {
              type: 'number',
              description: 'Maximum number of elements to return (default: unlimited). Use to limit token usage.',
              default: 0
            }
          },
          required: ['instanceId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            snapshot: { type: 'string', description: 'YAML representation of accessibility tree' },
            url: { type: 'string' },
            title: { type: 'string' },
            selector: { type: 'string' },
            snapshotLength: { type: 'number' }
          },
          required: ['snapshot', 'url', 'title']
        }
      },

      // Batch execution tool - Execute multiple operations in sequence
      {
        name: 'browser_batch_execute',
        description: 'Execute multiple browser operations in sequence. Saves ~20% tokens compared to individual calls. Ideal for form filling, multi-step navigation, or any workflow with 2+ known steps.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser ID from browser_create (isolated mode)'
            },
            steps: {
              type: 'array',
              description: 'Operations to execute. Args per action: navigate({url}), click({selector}), type({selector,text}), fill({selector,value}), evaluate({script}), wait({selector} or {ms}), snapshot({})',
              items: {
                type: 'object',
                properties: {
                  action: {
                    type: 'string',
                    enum: ['navigate', 'click', 'type', 'fill', 'evaluate', 'wait', 'snapshot'],
                    description: 'Action: navigate|click|type|fill|evaluate|wait|snapshot'
                  },
                  args: {
                    type: 'object',
                    description: 'Action-specific args. Examples: {url:"..."}, {selector:"#btn"}, {selector:"#input",text:"hello"}, {script:"return document.title"}, {ms:1000}'
                  },
                  continueOnError: {
                    type: 'boolean',
                    description: 'Continue execution if this step fails',
                    default: false
                  }
                },
                required: ['action', 'args']
              }
            },
            stopOnFirstError: {
              type: 'boolean',
              description: 'Stop execution on first error',
              default: true
            },
            returnOnlyFinal: {
              type: 'boolean',
              description: 'Only return the result of the last step (saves tokens)',
              default: false
            }
          },
          required: ['instanceId', 'steps']
        },
        outputSchema: {
          type: 'object',
          properties: {
            completedSteps: { type: 'number' },
            totalSteps: { type: 'number' },
            results: { type: 'array', items: { type: 'object' } },
            lastResult: { type: 'object' },
            allSuccessful: { type: 'boolean' }
          },
          required: ['completedSteps', 'totalSteps', 'allSuccessful']
        }
      },

      // API Bookmarks tools - LLM memory for endpoints
      {
        name: 'browser_save_endpoint',
        description: `Save an API endpoint discovered during navigation for later reuse.

Use this to bookmark important endpoints (add to cart, login, search, etc.) so you can reuse them in future scraping sessions without re-discovering them.

**When to use:**
- You discovered an API call that will be useful later
- Repetitive actions on a site (cart, checkout, forms)
- Important endpoints you don't want to search for again

**Security:** Sensitive headers (Authorization, Cookie, API keys) are automatically removed.`,
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'Domain for this endpoint (e.g., "amazon.com"). If omitted, extracted from URL.'
            },
            name: {
              type: 'string',
              description: 'Descriptive name for the endpoint (e.g., "Add to cart", "Search products")'
            },
            endpoint: {
              type: 'object',
              properties: {
                method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE)' },
                url: { type: 'string', description: 'Full URL or path (e.g., "/api/cart/add")' },
                headers: { type: 'object', description: 'Important headers (auth headers auto-removed)' },
                queryParams: { type: 'object', description: 'Query parameters as key-value pairs' },
                bodyTemplate: { type: 'string', description: 'Body template with {{placeholders}} for variables' }
              },
              required: ['method', 'url']
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization (e.g., ["cart", "critical"])'
            },
            notes: {
              type: 'string',
              description: 'Notes about usage, requirements, or quirks'
            }
          },
          required: ['name', 'endpoint']
        },
        outputSchema: {
          type: 'object',
          properties: {
            saved: { type: 'boolean' },
            id: { type: 'string', description: 'Unique ID for the endpoint (domain/slug)' },
            domain: { type: 'string' },
            created: { type: 'boolean', description: 'True if new, false if updated existing' },
            totalEndpoints: { type: 'number' }
          }
        }
      },
      {
        name: 'browser_list_endpoints',
        description: `List saved API endpoints. Filter by domain, tags, or search text.

Use this to recall endpoints you've previously saved for a domain before starting scraping work.`,
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'Filter by domain (e.g., "amazon.com")'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags (e.g., ["cart", "checkout"])'
            },
            search: {
              type: 'string',
              description: 'Search in name, path, notes, and tags'
            }
          }
        },
        outputSchema: {
          type: 'object',
          properties: {
            endpoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  domain: { type: 'string' },
                  name: { type: 'string' },
                  method: { type: 'string' },
                  path: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  usageCount: { type: 'number' },
                  lastUsed: { type: 'string' }
                }
              }
            },
            totalCount: { type: 'number' }
          }
        }
      },
      {
        name: 'browser_get_endpoint',
        description: `Get full details of a saved endpoint by ID. Also increments usage count.

Use this to retrieve the complete endpoint data (URL, headers, body template) when you're ready to use it.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Endpoint ID in format "domain/slug" (e.g., "amazon.com/add-to-cart")'
            }
          },
          required: ['id']
        },
        outputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            method: { type: 'string' },
            path: { type: 'string' },
            fullUrl: { type: 'string' },
            headers: { type: 'object' },
            queryParams: { type: 'object' },
            bodyTemplate: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
            usageCount: { type: 'number' },
            lastUsed: { type: 'string' },
            createdAt: { type: 'string' }
          }
        }
      },
      {
        name: 'browser_delete_endpoint',
        description: 'Delete a saved endpoint by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Endpoint ID to delete (e.g., "amazon.com/add-to-cart")'
            }
          },
          required: ['id']
        },
        outputSchema: {
          type: 'object',
          properties: {
            deleted: { type: 'boolean' },
            id: { type: 'string' }
          }
        }
      },
      {
        name: 'browser_capture_from_network',
        description: `Capture an endpoint directly from network logs and save it as a bookmark.

**Smart filtering (enabled by default):**
- Excludes static files (.js, .css, .png, etc.)
- Excludes CDN domains (media-amazon.com, cloudfront, etc.)
- Prioritizes POST requests over GET for automation

**Workflow:**
1. Enable network monitoring: browser_create or enable_network
2. Perform the action (add to cart, search, etc.)
3. Call this tool with urlPattern to capture the endpoint`,
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser instance ID'
            },
            urlPattern: {
              type: 'string',
              description: 'Regex pattern to match the request URL (e.g., "cart", "api/search")'
            },
            name: {
              type: 'string',
              description: 'Name for the saved endpoint'
            },
            methodFilter: {
              type: 'string',
              description: 'Filter by HTTP method: "POST", "GET", "PUT", "DELETE". If not set, POST is prioritized.'
            },
            excludeStatic: {
              type: 'boolean',
              description: 'Exclude static files and CDN domains (default: true)'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for the endpoint'
            },
            notes: {
              type: 'string',
              description: 'Notes about the endpoint'
            }
          },
          required: ['instanceId', 'urlPattern', 'name']
        },
        outputSchema: {
          type: 'object',
          properties: {
            captured: { type: 'boolean' },
            id: { type: 'string' },
            matchedUrl: { type: 'string' },
            method: { type: 'string' },
            domain: { type: 'string' }
          }
        }
      }
    ];
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Execute tools with MCP-compliant response format
   */
  async executeTools(name: string, args: any): Promise<CallToolResult> {
    // Check rate limit
    if (!this.rateLimiter.isAllowed()) {
      const status = this.rateLimiter.getStatus();
      return {
        content: [{
          type: 'text',
          text: `Rate limit exceeded. Try again in ${Math.ceil(status.resetMs / 1000)} seconds.`
        }],
        isError: true,
      };
    }

    try {
      let result: ToolResult;
      let isImageResult = false;

      switch (name) {
        case 'browser_create': {
          // Auto-detect session-required sites
          const sessionRequiredDomains = [
            'notion.so', 'notion.com',
            'google.com', 'gmail.com', 'drive.google.com', 'docs.google.com',
            'github.com', 'gitlab.com',
            'amazon.com', 'amazon.fr',
            'facebook.com', 'twitter.com', 'x.com',
            'linkedin.com',
            'spotify.com', 'netflix.com',
            'dropbox.com', 'onedrive.com',
            'slack.com', 'discord.com'
          ];

          let mode = args.mode || 'persistent';

          // Override to persistent if URL matches session-required domain
          if (args.url && mode !== 'isolated') {
            try {
              const urlObj = new URL(args.url);
              const hostname = urlObj.hostname.toLowerCase();
              const isSessionRequired = sessionRequiredDomains.some(domain =>
                hostname === domain || hostname.endsWith('.' + domain)
              );

              if (isSessionRequired && mode === 'incognito') {
                console.error(`[AUTO] Detected session-required site (${hostname}), using persistent mode instead of incognito`);
                mode = 'persistent';
              }
            } catch {
              // Invalid URL, keep original mode
            }
          }

          // Check if a stealth backend is requested
          const requestedBackend = args.backend || 'auto';
          const stealthBackends = ['camoufox', 'seleniumbase'];
          const needsStealthBackend = stealthBackends.includes(requestedBackend);

          // Use browserManager for isolated mode OR when a stealth backend is explicitly requested
          if (mode === 'isolated' || needsStealthBackend) {
            // Log when stealth backend forces browserManager path
            if (needsStealthBackend && mode !== 'isolated') {
              console.error(`[STEALTH] Backend ${requestedBackend} requested with mode=${mode}, using browserManager with session persistence`);
            }
            // Isolated mode: use BrowserManager (separate instance)
            let viewport = args.viewport || { width: 1280, height: 720 };
            let userAgent = args.userAgent;

            if (args.device) {
              const deviceConfig = devices[args.device as keyof typeof devices];
              if (deviceConfig) {
                viewport = deviceConfig.viewport;
                userAgent = deviceConfig.userAgent;
              }
            }

            // Slow backends that benefit from async mode to avoid MCP timeout
            const isSlowBackend = stealthBackends.includes(requestedBackend);
            // Auto-enable async for slow backends unless explicitly disabled
            const useAsync = args.async === true || (args.async !== false && isSlowBackend);

            if (useAsync && isSlowBackend) {
              // Async mode: use JobManager to avoid MCP timeout
              console.error(`[ASYNC] Creating ${requestedBackend} browser in background (async mode)`);

              const jobManager = getJobManager();
              const job = jobManager.createJob<any>(
                'browser_create',
                async (signal, reportProgress) => {
                  reportProgress('Starting browser creation...', 10);

                  const createResult = await this.browserManager.createInstance(
                    {
                      browserType: args.browserType || 'chromium',
                      headless: args.headless ?? false,
                      viewport,
                      userAgent,
                      storageStatePath: args.storageStatePath,
                      url: args.url,
                      backend: requestedBackend,
                    },
                    args.metadata
                  );

                  if (signal.aborted) {
                    throw new Error('Job cancelled');
                  }

                  reportProgress('Browser created, setting up...', 80);

                  // Setup console capture if enabled
                  if (createResult.success && createResult.instanceId && args.enableConsoleCapture) {
                    const instance = this.browserManager.getInstance(createResult.instanceId);
                    if (instance) {
                      this.setupConsoleCapture(createResult.instanceId, instance.page);
                    }
                  }

                  // Setup network monitoring if enabled
                  if (createResult.success && createResult.instanceId && args.enableNetworkMonitoring) {
                    const instance = this.browserManager.getInstance(createResult.instanceId);
                    if (instance) {
                      this.setupNetworkMonitoring(createResult.instanceId, instance.page);
                    }
                  }

                  // Setup download handling
                  if (createResult.success && createResult.instanceId) {
                    const instance = this.browserManager.getInstance(createResult.instanceId);
                    if (instance) {
                      this.setupDownloadHandling(createResult.instanceId, instance.page);
                    }
                  }

                  reportProgress('Ready', 100);

                  return {
                    instanceId: createResult.instanceId,
                    backend: createResult.data?.backend || requestedBackend,
                    url: args.url,
                    success: createResult.success,
                    error: createResult.error
                  };
                },
                { metadata: { url: args.url, backend: requestedBackend } }
              );

              // Return immediately with job info
              result = {
                success: true,
                data: {
                  id: `job:${job.id}`, // Prefix to indicate this is a job, not an instance
                  mode: mode,
                  backend: requestedBackend,
                  jobId: job.id,
                  status: job.status,
                  progress: 'Starting browser creation...',
                  message: `Browser creation started in background. Use job_status with jobId "${job.id}" to check when ready.`
                }
              };
            } else {
              // Sync mode: wait for browser creation (Playwright or explicit sync)
              result = await this.browserManager.createInstance(
                {
                  browserType: args.browserType || 'chromium',
                  headless: args.headless ?? false, // Default false for better anti-detection
                  viewport,
                  userAgent,
                  storageStatePath: args.storageStatePath,
                  // Backend selection: pass URL for auto-detection, or explicit backend
                  url: args.url,
                  backend: requestedBackend,
                },
                args.metadata
              );

              // Setup console capture if enabled
              if (result.success && result.instanceId && args.enableConsoleCapture) {
                const instance = this.browserManager.getInstance(result.instanceId);
                if (instance) {
                  this.setupConsoleCapture(result.instanceId, instance.page);
                }
              }

              // Setup network monitoring if enabled
              if (result.success && result.instanceId && args.enableNetworkMonitoring) {
                const instance = this.browserManager.getInstance(result.instanceId);
                if (instance) {
                  this.setupNetworkMonitoring(result.instanceId, instance.page);
                }
              }

              // Setup download handling
              if (result.success && result.instanceId) {
                const instance = this.browserManager.getInstance(result.instanceId);
                if (instance) {
                  this.setupDownloadHandling(result.instanceId, instance.page);
                }
              }

              // Transform output to match new schema
              if (result.success && result.data) {
                result.data = {
                  id: result.data.instanceId,
                  mode: mode,
                  backend: result.data.backend || 'playwright',
                  browserType: result.data.browserType,
                  createdAt: result.data.createdAt
                };
              }
            }
          } else {
            // Persistent or incognito mode: use GlobalProfile
            const globalMode = mode === 'incognito' ? 'incognito' : 'session';
            result = await this.createGlobalPage(args.url, globalMode);

            // Setup console/network monitoring if enabled
            if (result.success && result.data?.pageId) {
              const page = this.globalPages.get(result.data.pageId);
              if (page) {
                if (args.enableConsoleCapture) {
                  this.setupConsoleCapture(result.data.pageId, page);
                }
                if (args.enableNetworkMonitoring) {
                  this.setupNetworkMonitoring(result.data.pageId, page);
                }
                this.setupDownloadHandling(result.data.pageId, page);
              }
            }

            // Transform output to match new schema
            if (result.success && result.data) {
              result.data = {
                id: result.data.pageId,
                mode: mode,
                url: result.data.url,
                protectionLevel: result.data.protectionLevel,
                settings: result.data.settings,
                profileDir: result.data.profileDir,
                createdAt: new Date().toISOString()
              };
            }
          }
          break;
        }

        case 'browser_save_session': {
          // Check if it's a GlobalProfile page first
          const globalPage = this.globalPages.get(args.instanceId);
          if (globalPage) {
            // Save from GlobalProfile page context
            try {
              const context = globalPage.context();
              const dir = path.dirname(args.filePath);
              await fs.mkdir(dir, { recursive: true });
              const storageState = await context.storageState();
              await fs.writeFile(args.filePath, JSON.stringify(storageState, null, 2));
              result = {
                success: true,
                data: {
                  path: args.filePath,
                  source: 'global_profile',
                  cookies: storageState.cookies?.length || 0,
                  origins: storageState.origins?.length || 0
                }
              };
            } catch (error) {
              result = {
                success: false,
                error: `Failed to save session: ${error instanceof Error ? error.message : error}`
              };
            }
          } else {
            // Fall back to browserManager
            result = await this.browserManager.saveSessionState(args.instanceId, args.filePath);
          }
          break;
        }

        case 'job_status': {
          const jobManager = getJobManager();
          const job = jobManager.getJob(args.jobId);

          if (!job) {
            result = {
              success: false,
              error: `Job not found: ${args.jobId}. Jobs are cleaned up 1 hour after completion.`
            };
          } else {
            result = {
              success: true,
              data: {
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                progressPercent: job.progressPercent,
                createdAt: job.createdAt.toISOString(),
                completedAt: job.completedAt?.toISOString(),
                ...(job.status === 'completed' && job.result && {
                  result: {
                    instanceId: job.result.instanceId,
                    backend: job.result.backend,
                    url: job.result.url
                  }
                }),
                ...(job.status === 'failed' && { error: job.error })
              }
            };
          }
          break;
        }

        case 'browser_get_protection_level':
          result = this.getProtectionLevel(args.url);
          break;

        case 'browser_reset_protection':
          result = this.resetProtection(args.url);
          break;

        case 'browser_set_protection_level':
          result = this.setProtectionLevel(args.url, args.level);
          break;

        case 'browser_list_domains':
          result = this.listDomains();
          break;

        case 'browser_list_profiles':
          result = this.listProfiles();
          break;

        case 'browser_release_profile':
          result = await this.releaseProfile(args.profileId);
          break;

        case 'browser_switch_auth_profile':
          result = await this.switchToAuthProfile();
          break;

        // Device emulation
        case 'browser_list_devices': {
          const filter = args.filter?.toLowerCase();
          const deviceList = Object.entries(devices)
            .filter(([name]) => !filter || name.toLowerCase().includes(filter))
            .map(([name, device]) => ({
              name,
              viewport: device.viewport,
              userAgent: device.userAgent,
              isMobile: device.isMobile || false,
              hasTouch: device.hasTouch || false
            }));
          result = {
            success: true,
            data: {
              devices: deviceList,
              count: deviceList.length
            }
          };
          break;
        }

        // Console logs
        case 'browser_enable_console_capture': {
          const page = this.getPage(args.instanceId);
          if (!page) {
            result = { success: false, error: `Instance ${args.instanceId} not found` };
          } else {
            this.setupConsoleCapture(args.instanceId, page);
            result = { success: true, data: { enabled: true, instanceId: args.instanceId } };
          }
          break;
        }

        case 'browser_get_console_logs': {
          let logs = this.consoleLogs.get(args.instanceId) || [];

          // Filter by type
          if (args.filter && args.filter !== 'all') {
            logs = logs.filter(log => log.type === args.filter);
          }

          // Limit results
          const limit = args.limit || 100;
          logs = logs.slice(-limit);

          // Clear if requested
          if (args.clear) {
            this.consoleLogs.delete(args.instanceId);
          }

          const data = {
            logs,
            count: logs.length,
            totalCount: this.consoleLogs.get(args.instanceId)?.length || 0
          };

          // Auto-apply TOON format for large tabular data
          const formatted = smartFormat(data);
          result = {
            success: true,
            data: formatted.format === 'toon' ? {
              format: 'toon',
              content: formatted.content,
              count: logs.length,
              tokenStats: formatted.tokenStats
            } : data
          };
          break;
        }

        // Network monitoring
        case 'browser_enable_network_monitoring': {
          const page = this.getPage(args.instanceId);
          if (!page) {
            result = { success: false, error: `Instance ${args.instanceId} not found` };
          } else {
            this.setupNetworkMonitoring(args.instanceId, page);
            result = { success: true, data: { enabled: true, instanceId: args.instanceId } };
          }
          break;
        }

        case 'browser_get_network_logs': {
          let logs = this.networkLogs.get(args.instanceId) || [];

          // Filter by resource type
          if (args.filter) {
            logs = logs.filter(log => log.resourceType === args.filter);
          }

          // Filter by URL pattern
          if (args.urlPattern) {
            const regex = new RegExp(args.urlPattern, 'i');
            logs = logs.filter(log => regex.test(log.url));
          }

          // Limit results (default: 30, reduced from 100 to save tokens)
          const limit = args.limit || 30;
          logs = logs.slice(-limit);

          // Compact mode (default: true) - exclude headers, truncate postData
          const compact = args.compact !== false;
          let outputLogs: any[] = logs;

          if (compact) {
            outputLogs = logs.map(log => ({
              id: log.id,
              url: log.url,
              method: log.method,
              resourceType: log.resourceType,
              status: log.status,
              statusText: log.statusText,
              responseSize: log.responseSize,
              timing: log.timing,
              // Truncate postData to 200 chars in compact mode
              postData: log.postData
                ? (log.postData.length > 200 ? log.postData.substring(0, 200) + '...[truncated]' : log.postData)
                : undefined
            }));
          }

          // Clear if requested
          if (args.clear) {
            this.networkLogs.delete(args.instanceId);
          }

          const totalCount = this.networkLogs.get(args.instanceId)?.length || 0;
          const data = {
            logs: outputLogs,
            count: outputLogs.length,
            totalCount,
            compact,
            hint: compact ? 'Use compact=false for full headers/postData' : undefined
          };

          // Auto-apply TOON format for large tabular data
          const formatted = smartFormat(data);
          result = {
            success: true,
            data: formatted.format === 'toon' ? {
              format: 'toon',
              content: formatted.content,
              count: outputLogs.length,
              tokenStats: formatted.tokenStats
            } : data
          };
          break;
        }

        // PDF generation
        case 'browser_generate_pdf': {
          const page = this.getPage(args.instanceId);
          if (!page) {
            result = { success: false, error: `Instance ${args.instanceId} not found` };
          } else {
            try {
              const pdfOptions: any = {
                format: args.format || 'Letter',
                landscape: args.landscape || false,
                scale: args.scale || 1,
                printBackground: args.printBackground !== false,
              };

              if (args.margin) {
                pdfOptions.margin = args.margin;
              }

              if (args.pageRanges) {
                pdfOptions.pageRanges = args.pageRanges;
              }

              if (args.path) {
                pdfOptions.path = args.path;
                await page.pdf(pdfOptions);
                result = {
                  success: true,
                  data: { path: args.path, saved: true }
                };
              } else {
                const buffer = await page.pdf(pdfOptions);
                result = {
                  success: true,
                  data: {
                    pdf: buffer.toString('base64'),
                    size: buffer.length
                  }
                };
              }
            } catch (error) {
              result = {
                success: false,
                error: `PDF generation failed: ${error instanceof Error ? error.message : error}`
              };
            }
          }
          break;
        }

        // Download handling
        case 'browser_wait_for_download': {
          const page = this.getPage(args.instanceId);
          if (!page) {
            result = { success: false, error: `Instance ${args.instanceId} not found` };
          } else {
            try {
              const download = await page.waitForEvent('download', { timeout: args.timeout || 30000 });

              let path: string | null;
              if (args.saveAs) {
                await download.saveAs(args.saveAs);
                path = args.saveAs;
              } else {
                path = await download.path();
              }

              result = {
                success: true,
                data: {
                  filename: download.suggestedFilename(),
                  url: download.url(),
                  path
                }
              };
            } catch (error) {
              result = {
                success: false,
                error: `Download failed: ${error instanceof Error ? error.message : error}`
              };
            }
          }
          break;
        }

        case 'browser_wait_for_request': {
          const page = this.getPage(args.instanceId);
          if (!page) {
            result = { success: false, error: `Instance ${args.instanceId} not found` };
          } else if (!this.networkMonitoringEnabled.has(args.instanceId)) {
            result = {
              success: false,
              error: 'Network monitoring not enabled. Use browser_create with enableNetworkMonitoring: true, or call enable_network first.'
            };
          } else {
            try {
              const urlPattern = new RegExp(args.urlPattern, 'i');
              const methodFilter = args.method?.toUpperCase();
              const timeout = args.timeout || 10000;
              const startTime = Date.now();

              // Poll network logs for matching request
              let matchedRequest: NetworkEntry | null = null;
              const initialLogCount = this.networkLogs.get(args.instanceId)?.length || 0;

              while (Date.now() - startTime < timeout) {
                const logs = this.networkLogs.get(args.instanceId) || [];
                // Only check new entries since we started waiting
                for (let i = initialLogCount; i < logs.length; i++) {
                  const log = logs[i];
                  if (log && urlPattern.test(log.url)) {
                    if (!methodFilter || log.method === methodFilter) {
                      matchedRequest = log;
                      break;
                    }
                  }
                }
                if (matchedRequest) break;
                await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
              }

              if (matchedRequest) {
                result = {
                  success: true,
                  data: {
                    id: matchedRequest.id,
                    url: matchedRequest.url,
                    method: matchedRequest.method,
                    status: matchedRequest.status,
                    statusText: matchedRequest.statusText,
                    resourceType: matchedRequest.resourceType,
                    requestHeaders: matchedRequest.requestHeaders,
                    responseHeaders: matchedRequest.responseHeaders,
                    postData: matchedRequest.postData,
                    responseSize: matchedRequest.responseSize,
                    timing: matchedRequest.timing,
                    waitTime: Date.now() - startTime
                  }
                };
              } else {
                result = {
                  success: false,
                  error: `No request matching "${args.urlPattern}" found within ${timeout}ms`,
                  data: {
                    urlPattern: args.urlPattern,
                    method: methodFilter,
                    timeout,
                    logsChecked: (this.networkLogs.get(args.instanceId)?.length || 0) - initialLogCount
                  }
                };
              }
            } catch (error) {
              result = {
                success: false,
                error: `Wait for request failed: ${error instanceof Error ? error.message : error}`
              };
            }
          }
          break;
        }

        case 'browser_get_downloads': {
          const downloads = this.downloads.get(args.instanceId) || [];
          result = {
            success: true,
            data: {
              downloads,
              count: downloads.length
            }
          };
          break;
        }

        case 'browser_list_instances':
          result = this.browserManager.listInstances();
          break;

        case 'browser_close_instance':
          // Check if it's a global page or incognito first
          if (this.globalPages.has(args.instanceId)) {
            const page = this.globalPages.get(args.instanceId)!;
            await page.close();
            this.globalPages.delete(args.instanceId);

            // If it's an incognito browser, close the whole browser
            if (this.incognitoBrowsers.has(args.instanceId)) {
              const browser = this.incognitoBrowsers.get(args.instanceId)!;
              await browser.close();
              this.incognitoBrowsers.delete(args.instanceId);
            }

            result = { success: true, data: { closed: true, instanceId: args.instanceId } };
          } else {
            result = await this.browserManager.closeInstance(args.instanceId);
          }
          break;

        case 'browser_close_all_instances':
          result = await this.browserManager.closeAllInstances();
          break;

        case 'browser_navigate':
          result = await this.navigate(args.instanceId, args.url, {
            timeout: args.timeout || 30000,
            waitUntil: args.waitUntil || 'load'
          });
          break;

        case 'browser_go_back':
          result = await this.goBack(args.instanceId);
          break;

        case 'browser_go_forward':
          result = await this.goForward(args.instanceId);
          break;

        case 'browser_refresh':
          result = await this.refresh(args.instanceId);
          break;

        case 'browser_click':
          result = await this.click(args.instanceId, args.selector, {
            button: args.button || 'left',
            clickCount: args.clickCount || 1,
            delay: args.delay || 0,
            timeout: args.timeout || 30000,
            humanize: args.humanize || false,
            frame: args.frame,
            position: args.position,
            index: args.index,
            force: args.force || false
          });
          break;

        case 'browser_type':
          result = await this.type(args.instanceId, args.selector, args.text, {
            delay: args.delay || 0,
            timeout: args.timeout || 30000,
            humanize: args.humanize || false
          });
          break;

        case 'browser_fill':
          result = await this.fill(args.instanceId, args.selector, args.value, {
            timeout: args.timeout || 30000,
            humanize: args.humanize || false
          });
          break;

        case 'browser_select_option':
          result = await this.selectOption(args.instanceId, args.selector, args.value, args.timeout || 30000);
          break;

        case 'browser_scroll':
          result = await this.scroll(args.instanceId, {
            direction: args.direction || 'down',
            amount: args.amount || 300,
            selector: args.selector,
            humanize: args.humanize || false,
            timeout: args.timeout || 30000
          });
          break;

        case 'browser_get_page_info':
          result = await this.getPageInfo(args.instanceId);
          break;

        case 'browser_get_element_text':
          result = await this.getElementText(args.instanceId, args.selector, args.timeout || 30000);
          break;

        case 'browser_get_element_attribute':
          result = await this.getElementAttribute(args.instanceId, args.selector, args.attribute, args.timeout || 30000);
          break;

        case 'browser_screenshot':
          result = await this.screenshot(args.instanceId, {
            fullPage: args.fullPage || false,
            type: args.type || 'png',
            quality: args.quality || 80
          }, args.selector);
          isImageResult = true;
          break;

        case 'browser_wait_for_element':
          result = await this.waitForElement(args.instanceId, args.selector, args.timeout || 30000);
          break;

        case 'browser_wait_for_navigation':
          result = await this.waitForNavigation(args.instanceId, args.timeout || 30000);
          break;

        case 'browser_evaluate':
          result = await this.evaluate(args.instanceId, args.script);
          break;

        case 'browser_get_markdown':
          result = await this.getMarkdown(args.instanceId, {
            includeLinks: args.includeLinks ?? true,
            maxLength: args.maxLength || 10000,
            selector: args.selector
          });
          break;

        case 'browser_snapshot':
          result = await this.getSnapshot(args.instanceId, {
            selector: args.selector,
            expectation: args.expectation,
            maxElements: args.maxElements || 0
          });
          break;

        case 'browser_batch_execute':
          result = await this.batchExecute(args.instanceId, args.steps, {
            stopOnFirstError: args.stopOnFirstError ?? true,
            returnOnlyFinal: args.returnOnlyFinal ?? false
          });
          break;

        // API Bookmarks handlers
        case 'browser_save_endpoint': {
          const bookmarks = getApiBookmarks();
          const endpoint = args.endpoint as { method: string; url: string; headers?: Record<string, string>; queryParams?: Record<string, string>; bodyTemplate?: string };

          // Extract domain from URL if not provided
          let domain = args.domain;
          if (!domain && endpoint.url) {
            domain = bookmarks.getRootDomain(endpoint.url);
          }
          if (!domain) {
            result = { success: false, error: 'Could not determine domain. Provide domain parameter or use a full URL.' };
            break;
          }

          const { id, created } = bookmarks.addEndpoint(
            domain,
            args.name,
            endpoint,
            { tags: args.tags, notes: args.notes }
          );

          result = {
            success: true,
            data: {
              saved: true,
              id,
              domain: bookmarks.getRootDomain(domain),
              created,
              totalEndpoints: bookmarks.getTotalCount()
            }
          };
          break;
        }

        case 'browser_list_endpoints': {
          const bookmarks = getApiBookmarks();
          const endpoints = bookmarks.listEndpoints({
            domain: args.domain,
            tags: args.tags,
            search: args.search
          });

          const endpointList = endpoints.map(e => ({
            id: e.id,
            domain: e.domain,
            name: e.endpoint.name,
            method: e.endpoint.method,
            path: e.endpoint.path,
            tags: e.endpoint.tags,
            usageCount: e.endpoint.usageCount,
            lastUsed: e.endpoint.lastUsed
          }));

          // Use TOON format for large lists
          const formatted = smartFormat({ endpoints: endpointList, totalCount: endpoints.length });
          result = {
            success: true,
            data: formatted.format === 'toon'
              ? { ...formatted, endpoints: endpointList, totalCount: endpoints.length }
              : { endpoints: endpointList, totalCount: endpoints.length }
          };
          break;
        }

        case 'browser_get_endpoint': {
          const bookmarks = getApiBookmarks();
          const endpoint = bookmarks.getEndpoint(args.id);

          if (!endpoint) {
            result = { success: false, error: `Endpoint not found: ${args.id}` };
            break;
          }

          result = {
            success: true,
            data: endpoint
          };
          break;
        }

        case 'browser_delete_endpoint': {
          const bookmarks = getApiBookmarks();
          const deleted = bookmarks.deleteEndpoint(args.id);

          result = {
            success: true,
            data: { deleted, id: args.id }
          };
          break;
        }

        case 'browser_capture_from_network': {
          const bookmarks = getApiBookmarks();

          // Get network logs for the instance
          const logs = this.networkLogs.get(args.instanceId);
          if (!logs || logs.length === 0) {
            result = {
              success: false,
              error: 'No network logs found. Enable network monitoring with browser_create({ enableNetworkMonitoring: true }) first.'
            };
            break;
          }

          // Static file extensions to exclude by default
          const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|avif)(\?|$)/i;

          // CDN/static domains to exclude by default
          const CDN_DOMAINS = /^(media-amazon|images-amazon|cloudfront|cdn\.|static\.|assets\.)/i;

          // Filter logs: exclude static files and CDN domains unless explicitly disabled
          const excludeStatic = args.excludeStatic !== false; // default true
          const methodFilter = args.methodFilter?.toUpperCase(); // optional: 'POST', 'GET', etc.

          let filteredLogs = logs.filter(entry => {
            // Apply method filter if specified
            if (methodFilter && entry.method !== methodFilter) return false;

            // Apply static filter unless disabled
            if (excludeStatic) {
              if (STATIC_EXTENSIONS.test(entry.url)) return false;
              try {
                const hostname = new URL(entry.url).hostname;
                if (CDN_DOMAINS.test(hostname)) return false;
              } catch { /* ignore parse errors */ }
            }

            return true;
          });

          // Find matching request with pattern
          const pattern = new RegExp(args.urlPattern, 'i');
          let matchedEntry = filteredLogs.find(entry => pattern.test(entry.url));

          // If no match and no method filter, try POST first (more useful for automation)
          if (!matchedEntry && !methodFilter) {
            const postLogs = filteredLogs.filter(e => e.method === 'POST');
            matchedEntry = postLogs.find(entry => pattern.test(entry.url));

            // Fall back to any method
            if (!matchedEntry) {
              matchedEntry = filteredLogs.find(entry => pattern.test(entry.url));
            }
          }

          if (!matchedEntry) {
            // Show available API-like URLs for debugging
            const apiUrls = filteredLogs.slice(0, 15).map(e => `${e.method} ${e.url.substring(0, 100)}`);
            result = {
              success: false,
              error: `No request found matching pattern: ${args.urlPattern}`,
              data: {
                hint: 'Use methodFilter:"POST" to target POST requests specifically',
                availableUrls: apiUrls
              }
            };
            break;
          }

          // Extract domain from matched URL
          const domain = bookmarks.getRootDomain(matchedEntry.url);

          // Build endpoint from network entry
          const endpoint = {
            method: matchedEntry.method,
            url: matchedEntry.url,
            headers: matchedEntry.requestHeaders ? bookmarks.sanitizeHeaders(matchedEntry.requestHeaders) : undefined,
            bodyTemplate: matchedEntry.postData
          };

          const { id, created } = bookmarks.addEndpoint(
            domain,
            args.name,
            endpoint,
            { tags: args.tags, notes: args.notes }
          );

          result = {
            success: true,
            data: {
              captured: true,
              id,
              matchedUrl: matchedEntry.url,
              method: matchedEntry.method,
              domain,
              created
            }
          };
          break;
        }

        default:
          result = {
            success: false,
            error: `Unknown tool: ${name}`
          };
      }

      return this.toMcpResult(result, { isImage: isImageResult });
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Tool execution failed: ${error instanceof Error ? error.message : error}`
        }],
        isError: true,
      };
    }
  }

  // ============= Global Profile Methods =============

  /**
   * Create a page in the global persistent profile or incognito mode
   * Zero-config: auto-applies protection settings based on domain
   * @param url - Optional URL to navigate to
   * @param mode - 'session' (persistent profile) or 'incognito' (fresh context)
   */
  private async createGlobalPage(url?: string, mode: 'session' | 'incognito' = 'session'): Promise<ToolResult> {
    try {
      // Auto-switch to pool-0 if URL requires auth and we're not already on it
      let autoSwitched = false;
      if (url && mode !== 'incognito' && requiresAuth(url)) {
        const currentProfile = this.globalProfile.getProfileId();
        if (currentProfile !== 'pool-0') {
          console.error(`[AutoSwitch] Domain requires auth, switching to pool-0...`);
          const switchResult = await switchToAuthProfile();
          if (switchResult.success) {
            this.globalProfile = getGlobalProfile();
            autoSwitched = true;
            console.error(`[AutoSwitch] Switched from ${switchResult.previousProfile} to pool-0`);
          } else {
            console.warn(`[AutoSwitch] Failed to switch to pool-0: ${switchResult.error}`);
          }
        }
      }

      let pageId: string;
      let page: import('playwright').Page;

      if (mode === 'incognito') {
        // Create a fresh incognito context with no persistent data
        pageId = `incognito-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { chromium } = await import('playwright');

        // Get protection settings for anti-detection
        const settings = url ? this.domainIntelligence.getSettings(url) : this.domainIntelligence.getSettings('default');

        const browser = await chromium.launch({
          headless: settings.headless,
          channel: 'chrome',
        });

        const context = await browser.newContext({
          viewport: null, // Natural viewport for anti-detection
        });

        page = await context.newPage();

        // Store with cleanup handler
        this.globalPages.set(pageId, page);
        this.incognitoBrowsers.set(pageId, browser);

        // Clean up globalPages when page is closed
        page.on('close', () => {
          this.globalPages.delete(pageId);
          console.error(`[Incognito] Page ${pageId} closed, cleaned up from globalPages`);
        });

        console.error(`[Incognito] Created fresh context (no cookies, no history)`);
      } else {
        // Use persistent global profile (default)
        const result = await this.globalProfile.createPage();
        pageId = result.pageId;
        page = result.page;
        this.globalPages.set(pageId, page);

        // Clean up globalPages when page is closed
        page.on('close', () => {
          this.globalPages.delete(pageId);
          console.error(`[GlobalProfile] Page ${pageId} closed, cleaned up from globalPages`);
        });
      }

      let protectionLevel = 0;
      let settings = this.domainIntelligence.getSettings('default');

      // Check if URL requires authenticated session
      let authRequired = false;
      let authWarning: string | undefined;

      // Navigate if URL provided
      if (url) {
        const domain = this.domainIntelligence.getRootDomain(url);
        protectionLevel = this.domainIntelligence.getLevel(url);
        settings = this.domainIntelligence.getSettings(url);
        authRequired = requiresAuth(url);

        console.error(`[${mode === 'incognito' ? 'Incognito' : 'GlobalProfile'}] Creating page for ${domain} (protection level: ${protectionLevel}, authRequired: ${authRequired})`);

        // Warn if auth-required domain but not using pool-0 (the synced profile)
        const currentProfile = this.globalProfile.getProfileId();
        if (authRequired && currentProfile !== 'pool-0' && mode !== 'incognito') {
          authWarning = `This domain (${domain}) requires authentication. You are using ${currentProfile} instead of pool-0 (the Chrome-synced profile). You may not be logged in. Consider restarting Claude Code to get pool-0.`;
          console.warn(`[AuthWarning] ${authWarning}`);
        }

        await page.goto(url, { waitUntil: 'load' });
      }

      return {
        success: true,
        data: {
          pageId,
          url: page.url(),
          title: await page.title(),
          mode,
          protectionLevel,
          authRequired,
          ...(autoSwitched && { autoSwitched: 'Automatically switched to pool-0 (auth profile)' }),
          ...(authWarning && { authWarning }),
          settings: {
            humanize: settings.humanizeMouse,
            headless: settings.headless,
            delays: settings.delays,
          },
          profileDir: mode === 'session' ? this.globalProfile.getProfileDir() : null,
        },
      };
    } catch (error) {
      // Handle all profiles in use error specially
      if (error instanceof AllProfilesInUseError) {
        return {
          success: false,
          error: 'All profiles are in use',
          data: {
            lockedProfiles: error.lockedProfiles.map(p => ({
              id: p.id,
              pid: p.lock?.pid,
              since: p.lock?.startedAt,
              isStale: p.isStale,
            })),
            suggestion: 'Close other HydraSpecter sessions, use browser_release_profile to release stale locks, or use mode: "incognito"',
          },
        };
      }

      return {
        success: false,
        error: `Failed to create global page: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Get protection level for a domain
   */
  private getProtectionLevel(url: string): ToolResult {
    const domain = this.domainIntelligence.getRootDomain(url);
    const level = this.domainIntelligence.getLevel(url);
    const settings = this.domainIntelligence.getSettings(url);

    return {
      success: true,
      data: {
        domain,
        level,
        settings: {
          humanizeMouse: settings.humanizeMouse,
          humanizeTyping: settings.humanizeTyping,
          humanizeScroll: settings.humanizeScroll,
          headless: settings.headless,
          delays: settings.delays,
        },
      },
    };
  }

  /**
   * Reset protection level for a domain
   */
  private resetProtection(url: string): ToolResult {
    const domain = this.domainIntelligence.getRootDomain(url);
    this.domainIntelligence.resetLevel(url);

    return {
      success: true,
      data: {
        domain,
        message: `Protection level reset to 0 for ${domain}`,
      },
    };
  }

  /**
   * Manually set protection level for a domain
   */
  private setProtectionLevel(url: string, level: number): ToolResult {
    if (level < 0 || level > 3) {
      return {
        success: false,
        error: `Invalid protection level: ${level}. Must be 0, 1, 2, or 3.`,
      };
    }

    const domain = this.domainIntelligence.getRootDomain(url);
    this.domainIntelligence.setLevel(url, level as 0 | 1 | 2 | 3);
    const settings = this.domainIntelligence.getSettings(url);

    return {
      success: true,
      data: {
        domain,
        level,
        settings: {
          humanizeMouse: settings.humanizeMouse,
          humanizeTyping: settings.humanizeTyping,
          humanizeScroll: settings.humanizeScroll,
          headless: settings.headless,
          delays: settings.delays,
        },
      },
    };
  }

  /**
   * List all domains with learned protection levels
   */
  private listDomains(): ToolResult {
    const profiles = this.domainIntelligence.getAllProfiles();

    return {
      success: true,
      data: {
        domains: profiles.map(({ domain, profile }) => ({
          domain,
          level: profile.level,
          lastSuccess: profile.lastSuccess,
          lastDetection: profile.lastDetection,
          detectionCount: profile.detectionCount || 0,
        })),
        count: profiles.length,
      },
    };
  }

  /**
   * List all profiles in the pool
   */
  private listProfiles(): ToolResult {
    const profiles = this.globalProfile.listProfiles();
    const currentProfile = this.globalProfile.getProfileId();

    return {
      success: true,
      data: {
        profiles,
        currentProfile,
        available: profiles.filter(p => p.available).length,
        inUse: profiles.filter(p => !p.available).length,
        stale: profiles.filter(p => p.isStale).length,
      },
    };
  }

  /**
   * Force release a profile and close its browser context
   */
  private async releaseProfile(profileId: string): Promise<ToolResult> {
    const result = await this.globalProfile.forceReleaseProfile(profileId);

    return {
      success: result.released,
      data: {
        released: result.released,
        contextClosed: result.contextClosed,
        profileId,
      },
      error: result.released ? undefined : `Profile ${profileId} not found or could not be released`,
    };
  }

  /**
   * Switch to the authenticated profile (pool-0) for auth-required domains
   */
  private async switchToAuthProfile(): Promise<ToolResult> {
    const result = await switchToAuthProfile();

    // Update our reference to the global profile singleton
    this.globalProfile = getGlobalProfile();

    return {
      success: result.success,
      data: {
        previousProfile: result.previousProfile,
        newProfile: result.newProfile,
      },
      error: result.error,
    };
  }

  /**
   * Get a global page by ID
   */
  getGlobalPage(pageId: string): Page | undefined {
    return this.globalPages.get(pageId);
  }

  /**
   * Get a Page from either instanceId or pageId
   * This enables tools to work with all browser_create modes (persistent, incognito, isolated)
   */
  private getPageFromId(id: string): { page: Page; source: 'instance' | 'global' } | null {
    // First try as instanceId
    const instance = this.browserManager.getInstance(id);
    if (instance) {
      return { page: instance.page, source: 'instance' };
    }

    // Then try as pageId from global profile
    const globalPage = this.globalPages.get(id);
    if (globalPage) {
      return { page: globalPage, source: 'global' };
    }

    return null;
  }

  // ============= Implementation of specific tool methods =============

  private async navigate(instanceId: string, url: string, options: NavigationOptions): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const gotoOptions: any = {
        waitUntil: options.waitUntil
      };
      if (options.timeout) {
        gotoOptions.timeout = options.timeout;
      }
      await pageResult.page.goto(url, gotoOptions);

      // Check for detection signals after navigation
      const detectionResult = await this.detectionMonitor.checkPage(pageResult.page);

      if (detectionResult.detected) {
        // Report detection to domain intelligence
        const newLevel = this.domainIntelligence.reportDetection(url);
        console.error(`[Navigate] Detection on ${url}: ${detectionResult.type} (new level: ${newLevel})`);

        return {
          success: true,
          data: {
            url: pageResult.page.url(),
            title: await pageResult.page.title(),
            detection: {
              detected: true,
              type: detectionResult.type,
              details: detectionResult.details,
              newProtectionLevel: newLevel,
            },
          },
          instanceId
        };
      }

      // Report success
      this.domainIntelligence.reportSuccess(url);

      return {
        success: true,
        data: { url: pageResult.page.url(), title: await pageResult.page.title() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Navigation failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async goBack(instanceId: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      await pageResult.page.goBack();
      return {
        success: true,
        data: { url: pageResult.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Go back failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async goForward(instanceId: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      await pageResult.page.goForward();
      return {
        success: true,
        data: { url: pageResult.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Go forward failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async refresh(instanceId: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      await pageResult.page.reload();
      return {
        success: true,
        data: { url: pageResult.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Refresh failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async click(instanceId: string, selector: string | undefined, options: ClickOptions): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      // Click at absolute coordinates (useful for cross-origin iframes like Google Sign-In)
      // Position-based clicks don't need resilience - they're direct mouse clicks
      if (options.position) {
        const { x, y } = options.position;
        const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'mouse', options.humanize);

        if (useHumanize) {
          const { humanMove } = await import('./utils/ghost-cursor.js');
          await humanMove(pageResult.page, { x, y });
        }

        await pageResult.page.mouse.click(x, y, {
          button: options.button || 'left',
          clickCount: options.clickCount || 1,
          delay: options.delay || 0
        });

        return {
          success: true,
          data: { position: { x, y }, clicked: true, humanized: useHumanize },
          instanceId
        };
      }

      // Selector-based click requires a selector
      if (!selector) {
        return { success: false, error: 'Either selector or position must be provided' };
      }

      // Extract >> nth=N from selector (e.g., "button >> nth=1")
      const { selector: cleanSelector, index: selectorIndex } = extractNthFromSelector(selector);
      // options.index takes precedence over selector-embedded index
      const effectiveIndex = typeof options.index === 'number' ? options.index : selectorIndex;

      // Normalize jQuery-style selectors to Playwright format
      const normalizedSelector = normalizeSelector(cleanSelector);

      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'mouse', options.humanize);

      // Frame-based clicks - use simple click without resilience (frame contexts are complex)
      if (options.frame) {
        const frameLocator = pageResult.page.frameLocator(options.frame);
        let locator = frameLocator.locator(normalizedSelector);
        if (typeof effectiveIndex === 'number') {
          locator = locator.nth(effectiveIndex);
        }

        const clickOptions: any = { button: options.button };
        if (options.clickCount) clickOptions.clickCount = options.clickCount;
        if (options.delay) clickOptions.delay = options.delay;
        if (options.timeout) clickOptions.timeout = options.timeout;
        if (options.force) clickOptions.force = true;

        await locator.click(clickOptions);
        return {
          success: true,
          data: { selector, clicked: true, frame: options.frame, index: effectiveIndex },
          instanceId
        };
      }

      // Build locator with optional index for multiple elements
      let locator = pageResult.page.locator(normalizedSelector);
      if (typeof effectiveIndex === 'number') {
        locator = locator.nth(effectiveIndex);
      }

      // Check element count and provide helpful error for strict mode violations
      let elementCount = await locator.count();
      let workingSelector = normalizedSelector;
      let fallbacksAttempted: string[] = [];

      // If no elements found, try tag[attr] fallbacks before position fallback
      // This handles the common case where ARIA shows "button" but element is <div role="button">
      if (elementCount === 0) {
        const selectorFallbacks = generateTagAttrFallbacks(normalizedSelector);

        for (const fallbackSelector of selectorFallbacks) {
          fallbacksAttempted.push(fallbackSelector);
          let fallbackLocator = pageResult.page.locator(fallbackSelector);
          if (typeof effectiveIndex === 'number') {
            fallbackLocator = fallbackLocator.nth(effectiveIndex);
          }

          const fallbackCount = await fallbackLocator.count();
          if (fallbackCount > 0) {
            // Found elements with fallback selector - use it
            console.error(`[Selector Fallback] "${normalizedSelector}" → "${fallbackSelector}" (found ${fallbackCount} elements)`);
            locator = fallbackLocator;
            workingSelector = fallbackSelector;
            elementCount = fallbackCount;
            break;
          }
        }
      }

      // Still no elements? Try position fallback
      if (elementCount === 0) {
        const shouldTryFallback = options.positionFallback ?? DEFAULT_RESILIENCE.positionFallback;
        if (shouldTryFallback) {
          const { getPositionFallback } = await import('./utils/click-resilience.js');
          const pos = await getPositionFallback(pageResult.page, cleanSelector, effectiveIndex);
          if (pos) {
            const useHumanizeForFallback = await this.shouldHumanizeAsync(pageResult.page, 'mouse', options.humanize);
            if (useHumanizeForFallback) {
              const { humanMove } = await import('./utils/ghost-cursor.js');
              await humanMove(pageResult.page, pos);
            }
            await pageResult.page.mouse.click(pos.x, pos.y, {
              button: options.button || 'left',
              clickCount: options.clickCount || 1,
              delay: options.delay || 0
            });
            return {
              success: true,
              data: {
                selector,
                clicked: true,
                position: pos,
                fallbackUsed: true,
                humanized: useHumanizeForFallback,
                recoveryApplied: ['position_fallback'],
                selectorFallbacksAttempted: fallbacksAttempted.length > 0 ? fallbacksAttempted : undefined
              },
              instanceId
            };
          }
        }

        // All fallbacks failed - build helpful error
        const tips: string[] = [];
        if (fallbacksAttempted.length > 0) {
          tips.push(`Tried selector fallbacks: ${fallbacksAttempted.join(', ')}`);
        }
        if (cleanSelector.includes(':has-text(')) {
          if (cleanSelector.startsWith('button')) {
            tips.push('Try: [role="button"]:has-text("text") - many sites use role="button" instead of <button>');
            tips.push('Or use Playwright role selector: role=button[name="text"]');
          }
          tips.push('ARIA snapshots show accessibility roles, not HTML tags');
        }
        tips.push('Use position: { x, y } for cross-origin iframes or complex elements');
        tips.push('Use browser_evaluate to find element coordinates dynamically');

        return {
          success: false,
          error: `No elements found for selector: ${selector}`,
          instanceId,
          data: {
            suggestion: 'Element might use role= instead of HTML tag. Try role-based selectors or position fallback.',
            tips,
            selectorFallbacksAttempted: fallbacksAttempted.length > 0 ? fallbacksAttempted : undefined,
            alternatives: cleanSelector.startsWith('button') ? [
              `[role="button"]:has-text("${cleanSelector.match(/:has-text\(["'](.+?)["']\)/)?.[1] || 'text'}")`,
              `text=${cleanSelector.match(/:has-text\(["'](.+?)["']\)/)?.[1] || 'text'}`
            ] : undefined
          }
        };
      }

      if (elementCount > 1 && typeof effectiveIndex !== 'number') {
        return {
          success: false,
          error: `Strict mode violation: selector "${selector}" resolved to ${elementCount} elements. Use 'index' parameter (0-${elementCount - 1}) to select one, or use >> nth=N syntax.`,
          instanceId,
          data: {
            elementCount,
            suggestion: 'Add options.index: 0 for first element, or use selector >> nth=0',
            examples: [
              `{ "options": { "index": 0 } }`,
              `{ "target": "${cleanSelector} >> nth=0" }`
            ]
          }
        };
      }

      // Build resilience options with defaults
      const resilienceOptions: ResilienceOptions = {
        autoScroll: options.autoScroll ?? DEFAULT_RESILIENCE.autoScroll,
        autoForce: options.autoForce ?? DEFAULT_RESILIENCE.autoForce,
        positionFallback: options.positionFallback ?? DEFAULT_RESILIENCE.positionFallback,
        maxRetries: options.maxRetries ?? DEFAULT_RESILIENCE.maxRetries,
        retryDelay: options.retryDelay ?? DEFAULT_RESILIENCE.retryDelay,
        dismissOverlays: options.dismissOverlays ?? DEFAULT_RESILIENCE.dismissOverlays,
        timeout: options.timeout || DEFAULT_RESILIENCE.timeout
      };

      // If maxRetries is 0, skip resilience entirely (backward compatibility mode)
      if (resilienceOptions.maxRetries === 0) {
        // Human-like click
        if (useHumanize) {
          const boundingBox = await locator.boundingBox();
          if (boundingBox) {
            const { humanMove } = await import('./utils/ghost-cursor.js');
            const targetX = boundingBox.x + boundingBox.width / 2;
            const targetY = boundingBox.y + boundingBox.height / 2;
            await humanMove(pageResult.page, { x: targetX, y: targetY });
          }
          await locator.click({ force: options.force || false });
          return {
            success: true,
            data: {
              selector,
              clicked: true,
              humanized: true,
              autoDetected: options.humanize === 'auto',
              index: effectiveIndex,
              selectorFallbackUsed: workingSelector !== normalizedSelector ? workingSelector : undefined
            },
            instanceId
          };
        }

        // Standard click
        const clickOptions: any = { button: options.button };
        if (options.clickCount) clickOptions.clickCount = options.clickCount;
        if (options.delay) clickOptions.delay = options.delay;
        if (options.timeout) clickOptions.timeout = options.timeout;
        if (options.force) clickOptions.force = true;

        await locator.click(clickOptions);
        return {
          success: true,
          data: {
            selector,
            clicked: true,
            index: effectiveIndex,
            selectorFallbackUsed: workingSelector !== normalizedSelector ? workingSelector : undefined
          },
          instanceId
        };
      }

      // Human-like movement before resilient click
      if (useHumanize) {
        try {
          const boundingBox = await locator.boundingBox();
          if (boundingBox) {
            const { humanMove } = await import('./utils/ghost-cursor.js');
            const targetX = boundingBox.x + boundingBox.width / 2;
            const targetY = boundingBox.y + boundingBox.height / 2;
            await humanMove(pageResult.page, { x: targetX, y: targetY });
          }
        } catch {
          // Element might not be visible yet, resilientClick will handle it
        }
      }

      // Use resilient click with automatic recovery
      const result = await resilientClick(
        pageResult.page,
        locator,
        cleanSelector,  // Use clean selector without >> nth=N for fallback
        {
          force: options.force,
          button: options.button,
          clickCount: options.clickCount,
          delay: options.delay,
          timeout: options.timeout,
          index: effectiveIndex  // Pass effective index for position fallback
        },
        resilienceOptions
      );

      if (result.success) {
        return {
          success: true,
          data: {
            selector,
            clicked: true,
            humanized: useHumanize,
            autoDetected: options.humanize === 'auto',
            index: effectiveIndex,
            attempts: result.attempts.length,
            recoveryApplied: result.recoveryApplied.length > 0 ? result.recoveryApplied : undefined,
            fallbackUsed: result.recoveryApplied.includes('position_fallback'),
            selectorFallbackUsed: workingSelector !== normalizedSelector ? workingSelector : undefined,
            ...result.data
          },
          instanceId
        };
      }

      // Return failure with diagnostic info
      return {
        success: false,
        error: result.error,
        instanceId,
        data: {
          selector,
          attempts: result.attempts,
          recoveryApplied: result.recoveryApplied,
          suggestion: result.suggestion
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async type(instanceId: string, selector: string, text: string, options: TypeOptions): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    // Normalize jQuery-style selectors to Playwright format
    const normalizedSelector = normalizeSelector(selector);

    try {
      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'typing', options.humanize);

      if (useHumanize) {
        // Use human-like typing with delays and occasional typos
        await humanTypeInElement(pageResult.page, normalizedSelector, text);
        const detectionTriggered = options.humanize === 'auto' || this.humanizeConfig.typing === 'auto';
        return {
          success: true,
          data: { selector, text, typed: true, humanized: true, autoDetected: detectionTriggered },
          instanceId
        };
      }

      // Standard typing
      const typeOptions: any = {};
      if (options.delay) typeOptions.delay = options.delay;
      if (options.timeout) typeOptions.timeout = options.timeout;
      await pageResult.page.type(normalizedSelector, text, typeOptions);
      return {
        success: true,
        data: { selector, text, typed: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Type failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async fill(instanceId: string, selector: string, value: string, options: { timeout: number; humanize?: HumanizeMode }): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    // Normalize jQuery-style selectors to Playwright format
    const normalizedSelector = normalizeSelector(selector);

    try {
      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'typing', options.humanize);

      if (useHumanize) {
        // Clear field first, then use human-like typing
        await pageResult.page.click(normalizedSelector);
        await pageResult.page.keyboard.press('Control+a');
        await pageResult.page.keyboard.press('Backspace');
        await humanType(pageResult.page, value);
        const detectionTriggered = options.humanize === 'auto' || this.humanizeConfig.typing === 'auto';
        return {
          success: true,
          data: { selector, value, filled: true, humanized: true, autoDetected: detectionTriggered },
          instanceId
        };
      }

      // Standard fill (instant)
      await pageResult.page.fill(normalizedSelector, value, { timeout: options.timeout });
      return {
        success: true,
        data: { selector, value, filled: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Fill failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async selectOption(instanceId: string, selector: string, value: string, timeout: number): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const normalizedSelector = normalizeSelector(selector);
      await pageResult.page.selectOption(normalizedSelector, value, { timeout });
      return {
        success: true,
        data: { selector, value, selected: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Select option failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async scroll(instanceId: string, options: ScrollOptions): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const direction = options.direction || 'down';
      const amount = options.amount || 300;

      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanScroll = await this.shouldHumanizeAsync(pageResult.page, 'scroll', options.humanize);
      const detectionTriggered = options.humanize === 'auto' || this.humanizeConfig.scroll === 'auto';

      // If selector provided, scroll to element
      if (options.selector) {
        const selector = normalizeSelector(options.selector);
        if (useHumanScroll) {
          await humanScrollToElement(pageResult.page, selector);
        } else {
          await pageResult.page.locator(selector).scrollIntoViewIfNeeded({ timeout: options.timeout });
        }
        return {
          success: true,
          data: { scrolledTo: options.selector, humanized: useHumanScroll, autoDetected: detectionTriggered && useHumanScroll },
          instanceId
        };
      }

      // Direction-based scrolling
      if (useHumanScroll) {
        switch (direction) {
          case 'up':
            await humanScrollUp(pageResult.page, amount);
            break;
          case 'down':
            await humanScrollDown(pageResult.page, amount);
            break;
          case 'top':
            await humanScrollToTop(pageResult.page);
            break;
          case 'bottom':
            await humanScrollToBottom(pageResult.page);
            break;
        }
      } else {
        // Standard instant scroll
        switch (direction) {
          case 'up':
            await pageResult.page.evaluate((amt) => window.scrollBy(0, -amt), amount);
            break;
          case 'down':
            await pageResult.page.evaluate((amt) => window.scrollBy(0, amt), amount);
            break;
          case 'top':
            await pageResult.page.evaluate(() => window.scrollTo(0, 0));
            break;
          case 'bottom':
            await pageResult.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            break;
        }
      }

      // Get final scroll position
      const scrollPosition = await pageResult.page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
        maxY: document.documentElement.scrollHeight - window.innerHeight
      }));

      return {
        success: true,
        data: {
          direction,
          amount: direction === 'top' || direction === 'bottom' ? null : amount,
          humanized: useHumanScroll,
          autoDetected: detectionTriggered && useHumanScroll,
          scrollPosition
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Scroll failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getPageInfo(instanceId: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const url = pageResult.page.url();
      const title = await pageResult.page.title();
      const content = await pageResult.page.content();
      
      // Get additional page information
      const viewport = pageResult.page.viewportSize();
      const loadState = await pageResult.page.evaluate(() => document.readyState);
      
      // Get basic page statistics
      const pageStats = await pageResult.page.evaluate(() => {
        const links = document.querySelectorAll('a[href]').length;
        const images = document.querySelectorAll('img').length;
        const forms = document.querySelectorAll('form').length;
        const scripts = document.querySelectorAll('script').length;
        const stylesheets = document.querySelectorAll('link[rel="stylesheet"]').length;
        
        return {
          linksCount: links,
          imagesCount: images,
          formsCount: forms,
          scriptsCount: scripts,
          stylesheetsCount: stylesheets
        };
      });
      
      return {
        success: true,
        data: { 
          url, 
          title, 
          content,  // Return complete HTML content
          contentLength: content.length,
          viewport,
          loadState,
          stats: pageStats,
          timestamp: new Date().toISOString()
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get page info failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getElementText(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const normalizedSelector = normalizeSelector(selector);
      const text = await pageResult.page.textContent(normalizedSelector, { timeout });
      return {
        success: true,
        data: { selector, text },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get element text failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getElementAttribute(instanceId: string, selector: string, attribute: string, timeout: number): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const normalizedSelector = normalizeSelector(selector);
      const value = await pageResult.page.getAttribute(normalizedSelector, attribute, { timeout });
      return {
        success: true,
        data: { selector, attribute, value },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get element attribute failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async screenshot(instanceId: string, options: ScreenshotOptions, selector?: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      let screenshotData: Buffer;
      const normalizedSelector = selector ? normalizeSelector(selector) : undefined;

      if (normalizedSelector) {
        const element = await pageResult.page.$(normalizedSelector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}`, instanceId };
        }
        screenshotData = await element.screenshot({
          type: options.type,
          quality: options.type === 'jpeg' ? options.quality : undefined
        });
      } else {
        screenshotData = await pageResult.page.screenshot({
          fullPage: options.fullPage,
          type: options.type,
          quality: options.type === 'jpeg' ? options.quality : undefined,
          clip: options.clip
        });
      }

      return {
        success: true,
        data: { 
          screenshot: screenshotData.toString('base64'),
          type: options.type,
          selector
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Screenshot failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async waitForElement(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const normalizedSelector = normalizeSelector(selector);
      await pageResult.page.waitForSelector(normalizedSelector, { timeout });
      return {
        success: true,
        data: { selector, found: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Wait for element failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async waitForNavigation(instanceId: string, timeout: number): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      await pageResult.page.waitForNavigation({ timeout });
      return {
        success: true,
        data: { url: pageResult.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Wait for navigation failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async evaluate(instanceId: string, script: string): Promise<ToolResult> {
    // Validate script parameter
    if (!script || typeof script !== 'string') {
      return {
        success: false,
        error: 'Script parameter is required. Use "script" property or "expression" in options.',
        data: { suggestion: 'browser({ action: "evaluate", pageId: "...", options: { script: "document.title" } })' }
      };
    }

    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      // Auto-wrap scripts with return statements in IIFE to prevent SyntaxError
      let wrappedScript = script;
      const hasReturn = /\breturn\b/.test(script);
      const isAlreadyIIFE = /^\s*\(\s*(async\s+)?(function|\()/.test(script.trim());
      const isFunction = /^\s*(async\s+)?function\s/.test(script.trim());

      if (hasReturn && !isAlreadyIIFE && !isFunction) {
        wrappedScript = `(() => { ${script} })()`;
      }

      const result = await pageResult.page.evaluate(wrappedScript);
      return {
        success: true,
        data: { script: wrappedScript, result },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Evaluate failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getMarkdown(instanceId: string, options: {
    includeLinks: boolean;
    maxLength: number;
    selector?: string;
  }): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      // JavaScript function to extract page content and convert to Markdown
      const markdownContent = await pageResult.page.evaluate((opts) => {
        const { includeLinks, maxLength, selector } = opts;
        
        // Select the root element to process
        const rootElement = selector ? document.querySelector(selector) : document.body;
        if (!rootElement) {
          return 'Specified element or page content not found';
        }

        // HTML to Markdown conversion function
        function htmlToMarkdown(element: any, depth = 0) {
          let markdown = '';
          const indent = '  '.repeat(depth);
          
          for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent?.trim();
              if (text) {
                markdown += text + ' ';
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              const tagName = el.tagName.toLowerCase();
              
              switch (tagName) {
                case 'h1':
                  markdown += `\n\n# ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h2':
                  markdown += `\n\n## ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h3':
                  markdown += `\n\n### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h4':
                  markdown += `\n\n#### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h5':
                  markdown += `\n\n##### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h6':
                  markdown += `\n\n###### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'p':
                  const pText = htmlToMarkdown(el, depth);
                  if (pText.trim()) {
                    markdown += `\n\n${pText.trim()}\n`;
                  }
                  break;
                case 'br':
                  markdown += '\n';
                  break;
                case 'strong':
                case 'b':
                  markdown += `**${el.textContent?.trim()}**`;
                  break;
                case 'em':
                case 'i':
                  markdown += `*${el.textContent?.trim()}*`;
                  break;
                case 'code':
                  markdown += `\`${el.textContent?.trim()}\``;
                  break;
                case 'pre':
                  markdown += `\n\`\`\`\n${el.textContent?.trim()}\n\`\`\`\n`;
                  break;
                case 'a':
                  const href = el.getAttribute('href');
                  const linkText = el.textContent?.trim();
                  if (includeLinks && href && linkText) {
                    if (href.startsWith('http')) {
                      markdown += `[${linkText}](${href})`;
                    } else {
                      markdown += linkText;
                    }
                  } else {
                    markdown += linkText || '';
                  }
                  break;
                case 'ul':
                case 'ol':
                  markdown += '\n';
                  const listItems = el.querySelectorAll('li');
                  listItems.forEach((li, index) => {
                    const bullet = tagName === 'ul' ? '-' : `${index + 1}.`;
                    markdown += `${indent}${bullet} ${li.textContent?.trim()}\n`;
                  });
                  markdown += '\n';
                  break;
                case 'blockquote':
                  const quoteText = el.textContent?.trim();
                  if (quoteText) {
                    markdown += `\n> ${quoteText}\n\n`;
                  }
                  break;
                case 'div':
                case 'section':
                case 'article':
                case 'main':
                  // Recursively process container elements
                  markdown += htmlToMarkdown(el, depth);
                  break;
                case 'table':
                  // Simplified table processing
                  const rows = el.querySelectorAll('tr');
                  if (rows.length > 0) {
                    markdown += '\n\n';
                    rows.forEach((row, rowIndex) => {
                      const cells = row.querySelectorAll('td, th');
                      const cellTexts = Array.from(cells).map(cell => cell.textContent?.trim() || '');
                      markdown += '| ' + cellTexts.join(' | ') + ' |\n';
                      if (rowIndex === 0) {
                        markdown += '|' + ' --- |'.repeat(cells.length) + '\n';
                      }
                    });
                    markdown += '\n';
                  }
                  break;
                case 'script':
                case 'style':
                case 'nav':
                case 'footer':
                case 'aside':
                  // Ignore these elements
                  break;
                default:
                  // For other elements, continue recursive processing of child elements
                  markdown += htmlToMarkdown(el, depth);
                  break;
              }
            }
          }
          
          return markdown;
        }

        // Extract page title
        const title = document.title;
        const url = window.location.href;
        
        // Generate Markdown content
        let content = `# ${title}\n\n**URL:** ${url}\n\n`;
        content += htmlToMarkdown(rootElement);
        
        // Clean up extra line breaks and spaces
        content = content
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]+/g, ' ')
          .trim();
        
        // Truncate content if exceeds maximum length
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
        }
        
        return content;
      }, options);

      return {
        success: true,
        data: {
          markdown: markdownContent,
          length: markdownContent.length,
          truncated: markdownContent.length >= options.maxLength,
          url: pageResult.page.url(),
          title: await pageResult.page.title()
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get markdown failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  /**
   * Get ARIA accessibility snapshot - Token-efficient alternative to screenshots
   * Returns ~2-8k tokens vs ~100k+ for screenshots
   * Supports expectation-based filtering for additional 30-50% token reduction
   */
  private async getSnapshot(
    instanceId: string,
    options: { selector?: string; expectation?: string; maxElements?: number } = {}
  ): Promise<ToolResult> {
    // Check if this is a stealth backend instance that needs special handling
    const instance = this.browserManager.getInstance(instanceId);
    if (instance && 'backendType' in instance && 'backendInstance' in instance) {
      const adaptedInstance = instance as any;
      if (adaptedInstance.backendType === 'seleniumbase') {
        // Use backend's snapshot method directly for SeleniumBase
        const backend = adaptedInstance.backend;
        const backendPage = adaptedInstance.backendInstance.page;
        const result = await backend.snapshot(backendPage, { format: 'html' });

        if (!result.success) {
          return { success: false, error: result.error, instanceId };
        }

        const snapshot = result.data?.content || '';
        const url = await backendPage.url();
        const title = await backendPage.title();

        return {
          success: true,
          data: {
            snapshot: `[SeleniumBase HTML snapshot - ${snapshot.length} chars]\n${snapshot.slice(0, 2000)}${snapshot.length > 2000 ? '...' : ''}`,
            url,
            title,
            selector: options.selector || 'body',
            snapshotLength: snapshot.length,
            backend: 'seleniumbase'
          },
          instanceId
        };
      }
    }

    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const locator = options.selector
        ? pageResult.page.locator(options.selector)
        : pageResult.page.locator('body');

      let snapshot: string;

      // Try ARIA snapshot first (Playwright), fall back to text content
      try {
        if (typeof locator.ariaSnapshot === 'function') {
          snapshot = await locator.ariaSnapshot();
        } else {
          throw new Error('ariaSnapshot not available');
        }
      } catch {
        // Fallback: get text content
        console.error('[Snapshot] ariaSnapshot not available, falling back to text content');
        const textContent = await locator.textContent?.();
        snapshot = textContent || await pageResult.page.evaluate(() => document.body?.innerText || '');
      }

      const url = pageResult.page.url();
      const title = await pageResult.page.title();
      const originalLength = snapshot.length;
      let filtered = false;

      // Apply expectation-based filtering
      if (options.expectation) {
        snapshot = this.filterSnapshotByExpectation(snapshot, options.expectation);
        filtered = true;
      }

      // Apply maxElements limit
      if (options.maxElements && options.maxElements > 0) {
        snapshot = this.limitSnapshotElements(snapshot, options.maxElements);
        filtered = true;
      }

      return {
        success: true,
        data: {
          snapshot,
          url,
          title,
          selector: options.selector || 'body',
          snapshotLength: snapshot.length,
          originalLength: filtered ? originalLength : undefined,
          tokensSaved: filtered ? `${Math.round((1 - snapshot.length / originalLength) * 100)}%` : undefined,
          expectation: options.expectation,
          maxElements: options.maxElements
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Snapshot failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  /**
   * Filter ARIA snapshot based on expectation keywords
   * Maps expectations to relevant ARIA roles and element types
   */
  private filterSnapshotByExpectation(snapshot: string, expectation: string): string {
    const exp = expectation.toLowerCase();

    // Define expectation-to-pattern mappings
    const patterns: Record<string, RegExp[]> = {
      // Form-related expectations
      'login': [/textbox|password|button.*sign|button.*log|form|checkbox.*remember/gi],
      'form': [/textbox|combobox|listbox|checkbox|radio|button|spinbutton|slider|switch/gi],
      'search': [/searchbox|textbox.*search|button.*search|combobox/gi],

      // Navigation expectations
      'navigation': [/navigation|menu|menubar|menuitem|link|tab|tablist/gi],
      'nav': [/navigation|menu|menubar|menuitem|link|tab|tablist/gi],
      'menu': [/menu|menubar|menuitem|menuitemcheckbox|menuitemradio/gi],

      // Content expectations
      'products': [/listitem|img|heading|button.*add|button.*cart|price|\$|€|£/gi],
      'articles': [/article|heading|paragraph|time|author|img/gi],
      'list': [/list|listitem|grid|row|cell/gi],
      'table': [/table|row|cell|columnheader|rowheader|grid/gi],

      // Interactive expectations
      'buttons': [/button/gi],
      'links': [/link/gi],
      'inputs': [/textbox|combobox|listbox|checkbox|radio|spinbutton|slider|searchbox/gi],

      // Modal/dialog expectations
      'dialog': [/dialog|alertdialog|modal/gi],
      'modal': [/dialog|alertdialog|modal/gi],
      'popup': [/dialog|alertdialog|tooltip|menu/gi],
    };

    // Find matching patterns
    let relevantPatterns: RegExp[] = [];
    for (const [key, regexes] of Object.entries(patterns)) {
      if (exp.includes(key)) {
        relevantPatterns.push(...regexes);
      }
    }

    // If no specific pattern matched, do a general keyword search
    if (relevantPatterns.length === 0) {
      // Create pattern from expectation words
      const words = exp.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        relevantPatterns.push(new RegExp(words.join('|'), 'gi'));
      }
    }

    if (relevantPatterns.length === 0) {
      return snapshot; // No filtering if no patterns
    }

    // Filter snapshot lines
    const lines = snapshot.split('\n');
    const filteredLines: string[] = [];
    let currentIndent = 0;
    let includeChildren = false;

    for (const line of lines) {
      const indent = line.search(/\S/);
      if (indent === -1) continue; // Skip empty lines

      // Check if line matches any pattern
      const matches = relevantPatterns.some(pattern => pattern.test(line));

      if (matches) {
        filteredLines.push(line);
        currentIndent = indent;
        includeChildren = true;
      } else if (includeChildren && indent > currentIndent) {
        // Include children of matched elements
        filteredLines.push(line);
      } else {
        includeChildren = false;
      }
    }

    // If filtering removed everything, return a summary
    if (filteredLines.length === 0) {
      return `# No elements matching "${expectation}" found\n# Full snapshot has ${lines.length} lines`;
    }

    return filteredLines.join('\n');
  }

  /**
   * Limit the number of elements in a snapshot
   */
  private limitSnapshotElements(snapshot: string, maxElements: number): string {
    const lines = snapshot.split('\n');
    let elementCount = 0;
    const limitedLines: string[] = [];

    for (const line of lines) {
      // Count elements (lines that define roles or content)
      if (line.trim() && !line.trim().startsWith('#')) {
        elementCount++;
      }

      if (elementCount <= maxElements) {
        limitedLines.push(line);
      } else {
        limitedLines.push(`# ... truncated (${lines.length - limitedLines.length} more lines)`);
        break;
      }
    }

    return limitedLines.join('\n');
  }

  /**
   * Execute multiple browser operations in sequence
   * Saves ~90% tokens compared to individual calls
   */
  private async batchExecute(
    instanceId: string,
    steps: Array<{ action: string; args: any; continueOnError?: boolean }>,
    options: { stopOnFirstError: boolean; returnOnlyFinal: boolean }
  ): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    const results: Array<{ step: number; action: string; success: boolean; result?: any; error?: string }> = [];
    let lastResult: any = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;  // TypeScript guard
      const stepResult: any = { step: i + 1, action: step.action, success: false };

      try {
        switch (step.action) {
          case 'navigate':
            await pageResult.page.goto(step.args.url, {
              waitUntil: step.args.waitUntil || 'load',
              timeout: step.args.timeout || 30000
            });
            stepResult.result = { url: pageResult.page.url() };
            break;

          case 'click':
            await pageResult.page.click(step.args.selector, {
              timeout: step.args.timeout || 30000
            });
            stepResult.result = { clicked: step.args.selector };
            break;

          case 'type':
            await pageResult.page.type(step.args.selector, step.args.text, {
              delay: step.args.delay || 0,
              timeout: step.args.timeout || 30000
            });
            stepResult.result = { typed: step.args.text.length + ' chars' };
            break;

          case 'fill':
            await pageResult.page.fill(step.args.selector, step.args.value, {
              timeout: step.args.timeout || 30000
            });
            stepResult.result = { filled: step.args.selector };
            break;

          case 'evaluate':
            // Auto-wrap scripts with return statements in IIFE
            let batchScript = step.args.script;
            const batchHasReturn = /\breturn\b/.test(batchScript);
            const batchIsIIFE = /^\s*\(\s*(async\s+)?(function|\()/.test(batchScript.trim());
            const batchIsFunction = /^\s*(async\s+)?function\s/.test(batchScript.trim());
            if (batchHasReturn && !batchIsIIFE && !batchIsFunction) {
              batchScript = `(() => { ${batchScript} })()`;
            }
            const evalResult = await pageResult.page.evaluate(batchScript);
            stepResult.result = evalResult;
            break;

          case 'wait':
            if (step.args.selector) {
              await pageResult.page.waitForSelector(step.args.selector, {
                timeout: step.args.timeout || 30000
              });
              stepResult.result = { waited: step.args.selector };
            } else if (step.args.ms) {
              await pageResult.page.waitForTimeout(step.args.ms);
              stepResult.result = { waited: step.args.ms + 'ms' };
            }
            break;

          case 'snapshot':
            const batchLocator = step.args.selector
              ? pageResult.page.locator(step.args.selector)
              : pageResult.page.locator('body');
            let batchSnapshot: string;
            try {
              if (typeof batchLocator.ariaSnapshot === 'function') {
                batchSnapshot = await batchLocator.ariaSnapshot();
              } else {
                throw new Error('ariaSnapshot not available');
              }
            } catch {
              const textContent = await batchLocator.textContent();
              batchSnapshot = textContent || await pageResult.page.evaluate(() => document.body.innerText);
            }
            stepResult.result = { snapshot: batchSnapshot };
            break;

          default:
            stepResult.error = `Unknown action: ${step.action}`;
            break;
        }

        if (!stepResult.error) {
          stepResult.success = true;
          lastResult = stepResult.result;
        }

      } catch (error) {
        stepResult.error = error instanceof Error ? error.message : String(error);

        if (options.stopOnFirstError && !step.continueOnError) {
          results.push(stepResult);
          return {
            success: false,
            data: {
              completedSteps: i,
              totalSteps: steps.length,
              results: options.returnOnlyFinal ? undefined : results,
              lastResult,
              stoppedAtStep: i + 1,
              error: stepResult.error
            },
            instanceId
          };
        }
      }

      results.push(stepResult);
    }

    const allSuccessful = results.every(r => r.success);

    return {
      success: allSuccessful,
      data: {
        completedSteps: steps.length,
        totalSteps: steps.length,
        results: options.returnOnlyFinal ? undefined : results,
        lastResult,
        allSuccessful
      },
      instanceId
    };
  }
} 