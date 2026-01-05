import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Page } from 'playwright';
import { BrowserManager } from './browser-manager.js';
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
import { humanClick } from './utils/ghost-cursor.js';
import { humanType, humanTypeInElement } from './utils/human-typing.js';
import { humanScrollDown, humanScrollUp, humanScrollToElement, humanScrollToTop, humanScrollToBottom } from './utils/human-scroll.js';
import { DetectionMonitor, DetectionResult } from './utils/detection-monitor.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { getGlobalProfile, GlobalProfile, AllProfilesInUseError } from './global-profile.js';
import { getDomainIntelligence, DomainIntelligence } from './domain-intelligence.js';

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
      console.log(`[DetectionMonitor] ${result.type || 'detection'}: ${result.details} (confidence: ${result.confidence})`);
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
   * Get all tool definitions
   */
  getTools(): Tool[] {
    return [
      // Instance management tools
      {
        name: 'browser_create_instance',
        description: `Create an ISOLATED browser instance (no persistent sessions).

⚠️ IMPORTANT: For sites requiring login (e-commerce, social media, etc.), use browser_create_global instead - it automatically persists sessions.

Use browser_create_instance only when you need:
• Complete isolation from other sessions
• Custom browser settings (Firefox, WebKit)
• Manual session management via browser_save_session

Returns an instanceId to use with other browser_* tools.`,
        inputSchema: {
          type: 'object',
          properties: {
            browserType: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit'],
              description: 'Browser engine. Use "chromium" for best compatibility.',
              default: 'chromium'
            },
            headless: {
              type: 'boolean',
              description: 'Run without visible window. Set to false for better anti-detection.',
              default: true
            },
            viewport: {
              type: 'object',
              properties: {
                width: { type: 'number', default: 1280 },
                height: { type: 'number', default: 720 }
              },
              description: 'Fixed viewport size. Omit or set to null for natural viewport (better anti-detection).'
            },
            userAgent: {
              type: 'string',
              description: 'Custom user agent. Not recommended - browser default is less detectable.'
            },
            metadata: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Human-readable name for this instance' },
                description: { type: 'string', description: 'What this instance is used for' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering (e.g., ["shopping", "temu"])' }
              },
              description: 'Optional metadata to identify the instance in browser_list_instances'
            },
            storageStatePath: {
              type: 'string',
              description: 'Path to JSON file from browser_save_session. Restores cookies and localStorage to skip login.'
            }
          }
        },
        outputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Unique identifier for this browser instance' },
            browserType: { type: 'string' },
            createdAt: { type: 'string', description: 'ISO timestamp' }
          },
          required: ['instanceId']
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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

      // Zero-config global profile tools
      {
        name: 'browser_create_global',
        description: `🔑 RECOMMENDED - Create a page with persistent sessions.

**Use this tool for:**
• Sites requiring login (e-commerce, social media, email)
• Any site where you want to stay logged in
• Google OAuth flows (login once, works everywhere)

**Modes:**
• session (default): Persistent cookies/localStorage, auto-selects available profile from pool
• incognito: Fresh context, no stored data

**Multi-process:** Uses profile pool (5 profiles). If all in use, returns explicit error with suggestion.

Returns pageId to use with other browser_* tools.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Optional URL to navigate to after creating the page'
            },
            mode: {
              type: 'string',
              enum: ['session', 'incognito'],
              description: 'Browser mode: "session" (default) uses persistent profile with saved logins, "incognito" starts fresh with no cookies/history',
              default: 'session'
            }
          }
        },
        outputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Unique identifier - use this as instanceId in other tools' },
            url: { type: 'string' },
            mode: { type: 'string', description: 'Browser mode: "session" or "incognito"' },
            protectionLevel: { type: 'number', description: 'Current protection level (0-3) for this domain' },
            settings: {
              type: 'object',
              properties: {
                humanize: { type: 'boolean' },
                headless: { type: 'boolean' }
              }
            },
            profileDir: { type: 'string', description: 'Path to persistent Chrome profile (only in session mode)' }
          },
          required: ['pageId', 'mode']
        }
      },
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
        description: `Force release a locked profile.

Use when:
• A previous session crashed without cleanup
• The lock is stale (PID no longer running)

⚠️ Only use if you're sure the profile is not in active use.`,
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
            }
          },
          required: ['instanceId']
        }
      },

      // Page interaction tools
      {
        name: 'browser_click',
        description: 'Click on a page element. Use CSS selectors (e.g., "#btn", ".class") or ARIA refs from browser_snapshot (e.g., "aria-ref=e14"). For cross-origin iframes (like Google Sign-In), use position {x, y} to click at absolute coordinates.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
            autoDetected: { type: 'boolean' }
          },
          required: ['selector', 'clicked']
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
        description: 'Get page content in Markdown format, optimized for large language models',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
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
        description: 'Capture accessibility tree snapshot (ARIA). Much more token-efficient than screenshots (~2-8k tokens vs ~100k for screenshots). Returns structured YAML representation of page elements.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID (from browser_create_instance) or Page ID (from browser_create_global)'
            },
            selector: {
              type: 'string',
              description: 'Optional CSS selector to scope the snapshot to a specific element'
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
              description: 'Instance ID from browser_create_instance'
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
        case 'browser_create_instance':
          result = await this.browserManager.createInstance(
            {
              browserType: args.browserType || 'chromium',
              headless: args.headless ?? true,
              viewport: args.viewport || { width: 1280, height: 720 },
              userAgent: args.userAgent,
              storageStatePath: args.storageStatePath
            },
            args.metadata
          );
          break;

        case 'browser_save_session':
          result = await this.browserManager.saveSessionState(args.instanceId, args.filePath);
          break;

        case 'browser_create_global':
          result = await this.createGlobalPage(args.url, args.mode || 'session');
          break;

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
          result = this.releaseProfile(args.profileId);
          break;

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
            position: args.position
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
          result = await this.getSnapshot(args.instanceId, args.selector);
          break;

        case 'browser_batch_execute':
          result = await this.batchExecute(args.instanceId, args.steps, {
            stopOnFirstError: args.stopOnFirstError ?? true,
            returnOnlyFinal: args.returnOnlyFinal ?? false
          });
          break;

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

        console.log(`[Incognito] Created fresh context (no cookies, no history)`);
      } else {
        // Use persistent global profile (default)
        const result = await this.globalProfile.createPage();
        pageId = result.pageId;
        page = result.page;
        this.globalPages.set(pageId, page);
      }

      let protectionLevel = 0;
      let settings = this.domainIntelligence.getSettings('default');

      // Navigate if URL provided
      if (url) {
        const domain = this.domainIntelligence.getRootDomain(url);
        protectionLevel = this.domainIntelligence.getLevel(url);
        settings = this.domainIntelligence.getSettings(url);

        console.log(`[${mode === 'incognito' ? 'Incognito' : 'GlobalProfile'}] Creating page for ${domain} (protection level: ${protectionLevel})`);

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
   * Force release a profile
   */
  private releaseProfile(profileId: string): ToolResult {
    const released = this.globalProfile.forceReleaseProfile(profileId);

    return {
      success: released,
      data: {
        released,
        profileId,
      },
      error: released ? undefined : `Profile ${profileId} not found or could not be released`,
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
   * This enables tools to work with both browser_create_instance and browser_create_global
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
        console.log(`[Navigate] Detection on ${url}: ${detectionResult.type} (new level: ${newLevel})`);

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
      if (options.position) {
        const { x, y } = options.position;
        // Use human-like movement if enabled
        const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'mouse', options.humanize);

        if (useHumanize) {
          // Import and use bezier curve movement to coordinates
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

      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'mouse', options.humanize);

      // Get the target - either page or frame
      let target: any = pageResult.page;
      if (options.frame) {
        target = pageResult.page.frameLocator(options.frame);
      }

      if (useHumanize && !options.frame) {
        // Use human-like mouse movement with Bezier curves (only on main page, not frames)
        await humanClick(pageResult.page, selector);
        const detectionTriggered = options.humanize === 'auto' || this.humanizeConfig.mouse === 'auto';
        return {
          success: true,
          data: { selector, clicked: true, humanized: true, autoDetected: detectionTriggered, frame: options.frame },
          instanceId
        };
      }

      // Standard click (works on both page and frameLocator)
      const clickOptions: any = {
        button: options.button
      };
      if (options.clickCount) clickOptions.clickCount = options.clickCount;
      if (options.delay) clickOptions.delay = options.delay;
      if (options.timeout) clickOptions.timeout = options.timeout;

      await target.locator(selector).click(clickOptions);
      return {
        success: true,
        data: { selector, clicked: true, frame: options.frame },
        instanceId
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

    try {
      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'typing', options.humanize);

      if (useHumanize) {
        // Use human-like typing with delays and occasional typos
        await humanTypeInElement(pageResult.page, selector, text);
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
      await pageResult.page.type(selector, text, typeOptions);
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

    try {
      // Check if humanize should be enabled (supports "auto" mode with detection)
      const useHumanize = await this.shouldHumanizeAsync(pageResult.page, 'typing', options.humanize);

      if (useHumanize) {
        // Clear field first, then use human-like typing
        await pageResult.page.click(selector);
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
      await pageResult.page.fill(selector, value, { timeout: options.timeout });
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
      await pageResult.page.selectOption(selector, value, { timeout });
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
        if (useHumanScroll) {
          await humanScrollToElement(pageResult.page, options.selector);
        } else {
          await pageResult.page.locator(options.selector).scrollIntoViewIfNeeded({ timeout: options.timeout });
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
      const text = await pageResult.page.textContent(selector, { timeout });
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
      const value = await pageResult.page.getAttribute(selector, attribute, { timeout });
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
      
      if (selector) {
        const element = await pageResult.page.$(selector);
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
      await pageResult.page.waitForSelector(selector, { timeout });
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
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const result = await pageResult.page.evaluate(script);
      return {
        success: true,
        data: { script, result },
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
   */
  private async getSnapshot(instanceId: string, selector?: string): Promise<ToolResult> {
    const pageResult = this.getPageFromId(instanceId);
    if (!pageResult) {
      return { success: false, error: `Instance/Page ${instanceId} not found` };
    }

    try {
      const locator = selector
        ? pageResult.page.locator(selector)
        : pageResult.page.locator('body');

      const snapshot = await locator.ariaSnapshot();
      const url = pageResult.page.url();
      const title = await pageResult.page.title();

      return {
        success: true,
        data: {
          snapshot,
          url,
          title,
          selector: selector || 'body',
          snapshotLength: snapshot.length
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
            const evalResult = await pageResult.page.evaluate(step.args.script);
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
            const locator = step.args.selector
              ? pageResult.page.locator(step.args.selector)
              : pageResult.page.locator('body');
            const snapshot = await locator.ariaSnapshot();
            stepResult.result = { snapshot };
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