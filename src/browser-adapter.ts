/**
 * Browser Adapter Interface
 *
 * Abstraction layer that allows HydraSpecter to use different browser backends:
 * - Playwright (default): Full features, network interception, ARIA tree
 * - SeleniumBase UC: Cloudflare bypass, anti-detection, but limited features
 *
 * The adapter provides a common interface for core browser operations.
 */

/** Backend type selection */
export type BackendType = 'playwright' | 'seleniumbase' | 'auto';

/** Screenshot options */
export interface ScreenshotOptions {
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
  quality?: number;
  path?: string;
}

/** Click options */
export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  timeout?: number;
  position?: { x: number; y: number };
  force?: boolean;
}

/** Type options */
export interface TypeOptions {
  delay?: number;
  timeout?: number;
}

/** Navigation options */
export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

/** Scroll options */
export interface ScrollOptions {
  direction?: 'up' | 'down';
  amount?: number;
}

/** Page info returned by adapter */
export interface AdapterPageInfo {
  url: string;
  title: string;
}

/**
 * Browser page adapter interface.
 * Provides a unified API for both Playwright and SeleniumBase backends.
 *
 * IMPORTANT: Not all methods are supported by all backends.
 * Use `supportsFeature()` to check before using optional features.
 */
export interface IBrowserPage {
  /** Backend type */
  readonly backend: BackendType;

  // ===== Core Navigation =====

  /** Navigate to a URL */
  goto(url: string, options?: NavigationOptions): Promise<void>;

  /** Go back in history */
  goBack(options?: NavigationOptions): Promise<void>;

  /** Go forward in history */
  goForward(options?: NavigationOptions): Promise<void>;

  /** Reload the page */
  reload(options?: NavigationOptions): Promise<void>;

  // ===== Core Interaction =====

  /** Click an element */
  click(selector: string, options?: ClickOptions): Promise<void>;

  /** Type text (keystroke by keystroke) */
  type(selector: string, text: string, options?: TypeOptions): Promise<void>;

  /** Fill input (instant, clears first) */
  fill(selector: string, text: string, options?: TypeOptions): Promise<void>;

  /** Scroll the page */
  scroll(options?: ScrollOptions): Promise<void>;

  /** Wait for an element */
  waitForSelector(selector: string, options?: { timeout?: number; state?: 'attached' | 'visible' }): Promise<void>;

  // ===== Content Extraction =====

  /** Execute JavaScript in the page */
  evaluate<R>(script: string | Function, ...args: any[]): Promise<R>;

  /** Take a screenshot */
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  /** Get page title */
  title(): Promise<string>;

  /** Get current URL */
  url(): string;

  /** Get page HTML content */
  content(): Promise<string>;

  /** Get page info (title + url) */
  getInfo(): Promise<AdapterPageInfo>;

  // ===== Lifecycle =====

  /** Close the page */
  close(): Promise<void>;

  /** Check if page is closed */
  isClosed(): boolean;

  // ===== Feature Detection =====

  /**
   * Check if a feature is supported by this backend.
   *
   * Playwright supports: all features
   * SeleniumBase supports: core features only (no network interception, no ARIA tree)
   */
  supportsFeature(feature: BrowserFeature): boolean;
}

/** Features that may or may not be supported by backends */
export type BrowserFeature =
  | 'network_interception'  // Playwright only
  | 'aria_tree'             // Playwright only (via accessibility API)
  | 'route_control'         // Playwright only
  | 'multi_context'         // Playwright only (multiple isolated contexts)
  | 'console_capture'       // Playwright only
  | 'cloudflare_bypass'     // SeleniumBase only (native UC mode)
  | 'captcha_solve'         // SeleniumBase only (built-in handlers)
  ;

/**
 * Browser instance adapter interface.
 * Wraps browser instance creation and lifecycle.
 */
export interface IBrowserInstance {
  /** Unique instance ID */
  readonly id: string;

  /** Backend type */
  readonly backend: BackendType;

  /** Get the page adapter */
  readonly page: IBrowserPage;

  /** Creation timestamp */
  readonly createdAt: Date;

  /** Last activity timestamp */
  lastUsed: Date;

  /** Whether the instance is active */
  isActive: boolean;

  /** Optional metadata */
  metadata?: {
    name?: string;
    tags?: string[];
    description?: string;
  };

  /** Close the instance */
  close(): Promise<void>;
}

/**
 * Result of Cloudflare detection check.
 */
export interface CloudflareDetectionResult {
  /** Whether Cloudflare block was detected */
  blocked: boolean;
  /** Type of challenge if any */
  challengeType?: 'turnstile' | 'captcha' | 'waf' | 'unknown';
  /** Confidence level (0-1) */
  confidence: number;
  /** Additional details */
  details?: string;
}

/**
 * Detect if a page is blocked by Cloudflare.
 * Used for auto-fallback to SeleniumBase when Playwright is blocked.
 */
export async function detectCloudflareBlock(page: IBrowserPage): Promise<CloudflareDetectionResult> {
  try {
    const html = await page.content();
    const title = await page.title();

    // Check for Turnstile challenge
    if (html.includes('challenges.cloudflare.com') || html.includes('cf-turnstile')) {
      return {
        blocked: true,
        challengeType: 'turnstile',
        confidence: 0.95,
        details: 'Cloudflare Turnstile challenge detected'
      };
    }

    // Check for CAPTCHA challenge
    if (html.includes('cf-captcha-container') || html.includes('hcaptcha')) {
      return {
        blocked: true,
        challengeType: 'captcha',
        confidence: 0.9,
        details: 'Cloudflare CAPTCHA challenge detected'
      };
    }

    // Check for WAF block
    if (title.includes('Just a moment') || title.includes('Checking your browser')) {
      return {
        blocked: true,
        challengeType: 'waf',
        confidence: 0.85,
        details: 'Cloudflare WAF checking page detected'
      };
    }

    // Check for generic Cloudflare block page
    if (html.includes('cf-browser-verification') || html.includes('Ray ID:')) {
      return {
        blocked: true,
        challengeType: 'unknown',
        confidence: 0.7,
        details: 'Generic Cloudflare protection detected'
      };
    }

    // Check for specific blocked patterns
    if (html.includes('You have been blocked') && html.includes('Cloudflare')) {
      return {
        blocked: true,
        challengeType: 'waf',
        confidence: 0.95,
        details: 'Explicit Cloudflare block message'
      };
    }

    return {
      blocked: false,
      confidence: 0.9
    };
  } catch (error) {
    // If we can't check, assume not blocked
    return {
      blocked: false,
      confidence: 0.5,
      details: `Could not check: ${error}`
    };
  }
}

/**
 * Features supported by each backend.
 * Used for feature detection and capability checking.
 */
export const BACKEND_FEATURES: Record<BackendType, BrowserFeature[]> = {
  playwright: [
    'network_interception',
    'aria_tree',
    'route_control',
    'multi_context',
    'console_capture',
  ],
  seleniumbase: [
    'cloudflare_bypass',
    'captcha_solve',
  ],
  auto: [], // Auto doesn't have fixed features - depends on which backend is used
};

/**
 * Check if a backend supports a specific feature.
 */
export function backendSupportsFeature(backend: BackendType, feature: BrowserFeature): boolean {
  if (backend === 'auto') {
    // Auto mode supports the union of both backends' features
    return BACKEND_FEATURES.playwright.includes(feature) ||
           BACKEND_FEATURES.seleniumbase.includes(feature);
  }
  return BACKEND_FEATURES[backend].includes(feature);
}
