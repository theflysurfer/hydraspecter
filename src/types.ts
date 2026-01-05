import { Browser, BrowserContext, Page } from 'playwright';

/** Humanize mode: true/false or "auto" for adaptive detection-based activation */
export type HumanizeMode = boolean | 'auto';

export interface BrowserInstance {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastUsed: Date;
  isActive: boolean;
  metadata?: {
    name?: string;
    tags?: string[];
    description?: string;
  };
}

export interface ProxyConfig {
  server?: string; // e.g., 'http://127.0.0.1:7890'
  autoDetect?: boolean; // Whether to auto-detect local proxy, defaults to true
}

export interface BrowserConfig {
  browserType: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: {
    width: number;
    height: number;
  } | null;  // null = natural viewport (anti-detection recommended)
  userAgent?: string;
  proxy?: ProxyConfig;
  storageStatePath?: string;  // Path to load session state from (cookies, localStorage)
  channel?: 'chrome' | 'msedge' | 'chrome-beta' | 'msedge-beta';  // Use real browser instead of Chromium
  userDataDir?: string;  // Persistent profile directory for launchPersistentContext
  contextOptions?: {
    ignoreHTTPSErrors?: boolean;
    bypassCSP?: boolean;
    storageState?: string;
  };
}

/** Global profile configuration for zero-config session persistence */
export interface GlobalProfileConfig {
  /** Custom profile directory (default: ~/.hydraspecter/profile/) */
  profileDir?: string;
  /** Run browser in headless mode (default: false for anti-detection) */
  headless?: boolean;
  /** Browser channel to use (chrome, msedge) */
  channel?: 'chrome' | 'msedge';
}

export interface ServerConfig {
  maxInstances: number;
  defaultBrowserConfig: BrowserConfig;
  instanceTimeout: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  proxy?: ProxyConfig; // Global proxy configuration
  humanize?: HumanizeConfig; // Global humanize defaults
  rateLimit?: RateLimitConfig; // Rate limiting configuration
  globalProfile?: GlobalProfileConfig; // Zero-config global profile settings
}

/** Legacy internal tool result (used internally before MCP conversion) */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  instanceId?: string;
}

/** MCP-compliant tool result format */
export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/** Rate limiting configuration */
export interface RateLimitConfig {
  enabled: boolean;
  maxRequests: number;    // Max requests per window
  windowMs: number;       // Window size in milliseconds
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  timeout?: number;
  humanize?: HumanizeMode;  // Use human-like mouse movement (true/false/"auto")
}

export interface TypeOptions {
  delay?: number;
  timeout?: number;
  humanize?: HumanizeMode;  // Use human-like typing with typos (true/false/"auto")
}

export interface ScrollOptions {
  amount?: number;
  direction?: 'up' | 'down' | 'top' | 'bottom';
  selector?: string;  // Optional: scroll to bring this element into view
  humanize?: HumanizeMode;  // Use physics-based scrolling (true/false/"auto")
  timeout?: number;
}

export interface HumanizeConfig {
  /** Enable human-like mouse movement (true/false or "auto" for adaptive) */
  mouse?: HumanizeMode;
  /** Enable human-like typing with typos (true/false or "auto" for adaptive) */
  typing?: HumanizeMode;
  /** Enable physics-based scrolling (true/false or "auto" for adaptive) */
  scroll?: HumanizeMode;
  /** Typo rate for typing (0-1) */
  typoRate?: number;
  /** Mouse overshoot probability (0-1) */
  overshootChance?: number;
  /** Domains that always use humanize regardless of detection */
  alwaysHumanizeDomains?: string[];
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  type?: 'png' | 'jpeg';
  quality?: number;
}

/** Delay range [min, max] in milliseconds */
export type DelayRange = [number, number];

/** Site-specific delays for human-like behavior */
export interface SiteDelays {
  /** Delay before clicking an element */
  beforeClick?: DelayRange;
  /** Delay before typing */
  beforeType?: DelayRange;
  /** Delay after navigation */
  afterNavigate?: DelayRange;
  /** Delay between batch operations */
  betweenOperations?: DelayRange;
}

/** Session persistence configuration for a site */
export interface SiteSessionConfig {
  /** Auto-save session after successful actions */
  autoSave?: boolean;
  /** Path to session file (relative to sessions directory) */
  path?: string;
  /** Auto-load session on instance creation */
  autoLoad?: boolean;
}

/** Site-specific profile configuration */
export interface SiteProfile {
  /** Run in headless mode */
  headless?: boolean;
  /** Humanize mode for this site */
  humanize?: HumanizeMode;
  /** Browser channel (chrome, msedge) */
  channel?: 'chrome' | 'msedge' | 'chrome-beta' | 'msedge-beta';
  /** Viewport size (null for natural) */
  viewport?: { width: number; height: number } | null;
  /** Custom user agent (not recommended) */
  userAgent?: string;
  /** Site-specific delays */
  delays?: SiteDelays;
  /** Session configuration */
  session?: SiteSessionConfig;
  /** Proxy configuration for this site */
  proxy?: string;
  /** Additional notes about this site's anti-bot */
  notes?: string;
}

/** Global sites configuration */
export interface SitesConfig {
  /** Site profiles keyed by domain pattern */
  profiles: Record<string, SiteProfile>;
  /** Global session settings */
  sessions?: {
    /** Directory to store sessions */
    directory?: string;
    /** Auto-load sessions by default */
    autoLoad?: boolean;
    /** Auto-save sessions by default */
    autoSave?: boolean;
    /** Max age for sessions (e.g., "7d", "24h") */
    maxAge?: string;
  };
  /** Default profile applied to all sites */
  defaults?: SiteProfile;
} 