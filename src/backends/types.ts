/**
 * Backend Abstraction Types for HydraSpecter
 *
 * Unified interface for multiple browser automation backends:
 * - Playwright (default, full features)
 * - Camoufox (Firefox-based stealth, Cloudflare bypass)
 * - SeleniumBase (Chrome UC mode, Cloudflare bypass)
 */

/** Backend type identifier */
export type BackendType = 'playwright' | 'camoufox' | 'seleniumbase';

/** Screenshot format */
export type ScreenshotFormat = 'png' | 'jpeg';

/** Navigation wait condition */
export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

/** Click button type */
export type MouseButton = 'left' | 'right' | 'middle';

/** Backend-agnostic page reference */
export interface BackendPage {
  /** Unique page identifier */
  id: string;
  /** Backend type */
  backend: BackendType;
  /** Current URL */
  url(): Promise<string>;
  /** Page title */
  title(): Promise<string>;
  /** Underlying native page object (for advanced use) */
  native: any;
}

/** Backend-agnostic browser instance */
export interface BackendInstance {
  /** Unique instance identifier */
  id: string;
  /** Backend type */
  backend: BackendType;
  /** Primary page */
  page: BackendPage;
  /** All pages in this context */
  pages(): Promise<BackendPage[]>;
  /** Created timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsed: Date;
  /** Underlying native browser/context object */
  native: any;
}

/** Options for creating a backend instance */
export interface BackendCreateOptions {
  /** Run headless (not recommended for stealth backends) */
  headless?: boolean;
  /** Initial URL to navigate to */
  url?: string;
  /** Profile directory for session persistence */
  profileDir?: string;
  /** Viewport size (null for natural) */
  viewport?: { width: number; height: number } | null;
  /** Proxy server URL */
  proxy?: string;
  /** Window position */
  windowPosition?: { x: number; y: number };
  /** Window size */
  windowSize?: { width: number; height: number };
  /** Keep window always on top */
  alwaysOnTop?: boolean;
  /** Device emulation (Playwright-only) */
  device?: string;
  /** Browser type for Playwright (chromium/firefox/webkit) */
  browserType?: 'chromium' | 'firefox' | 'webkit';
  /** Channel for Playwright (chrome/msedge) */
  channel?: 'chrome' | 'msedge' | 'chrome-beta' | 'msedge-beta';
}

/** Options for navigation */
export interface BackendNavigateOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Wait condition */
  waitUntil?: WaitUntil;
}

/** Options for clicking */
export interface BackendClickOptions {
  /** Mouse button */
  button?: MouseButton;
  /** Number of clicks */
  clickCount?: number;
  /** Delay between mousedown and mouseup */
  delay?: number;
  /** Timeout for finding element */
  timeout?: number;
  /** Force click even if element is obscured */
  force?: boolean;
  /** Click at specific position within element */
  position?: { x: number; y: number };
  /** For stealth backends: use UC mode special click */
  ucClick?: boolean;
}

/** Options for typing */
export interface BackendTypeOptions {
  /** Delay between keystrokes in milliseconds */
  delay?: number;
  /** Timeout for finding element */
  timeout?: number;
  /** Clear field before typing */
  clear?: boolean;
}

/** Options for screenshot */
export interface BackendScreenshotOptions {
  /** Capture full page */
  fullPage?: boolean;
  /** Image format */
  format?: ScreenshotFormat;
  /** JPEG quality (0-100) */
  quality?: number;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
}

/** Snapshot/accessibility tree result */
export interface BackendSnapshotResult {
  /** Accessibility tree or DOM structure */
  content: string;
  /** Format type */
  format: 'aria' | 'html' | 'text';
}

/** Result of backend operations */
export interface BackendResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Unified Browser Backend Interface
 *
 * All backends must implement these methods for interoperability.
 * Method signatures are designed to be backend-agnostic.
 */
export interface IBrowserBackend {
  /** Backend type identifier */
  readonly backendType: BackendType;

  /** Backend display name */
  readonly name: string;

  /** Check if backend is available/installed */
  isAvailable(): Promise<boolean>;

  /**
   * Create a new browser instance
   * @param options Creation options
   * @returns Instance with page ready for use
   */
  create(options?: BackendCreateOptions): Promise<BackendResult<BackendInstance>>;

  /**
   * Navigate to URL
   * @param page Page to navigate
   * @param url Target URL
   * @param options Navigation options
   */
  navigate(page: BackendPage, url: string, options?: BackendNavigateOptions): Promise<BackendResult<void>>;

  /**
   * Click on an element
   * @param page Page containing element
   * @param selector CSS selector
   * @param options Click options
   */
  click(page: BackendPage, selector: string, options?: BackendClickOptions): Promise<BackendResult<void>>;

  /**
   * Type text into an element
   * @param page Page containing element
   * @param selector CSS selector (input/textarea)
   * @param text Text to type
   * @param options Type options
   */
  typeText(page: BackendPage, selector: string, text: string, options?: BackendTypeOptions): Promise<BackendResult<void>>;

  /**
   * Fill an input field (clears first, then types)
   * @param page Page containing element
   * @param selector CSS selector
   * @param value Value to fill
   * @param options Fill options
   */
  fill(page: BackendPage, selector: string, value: string, options?: BackendTypeOptions): Promise<BackendResult<void>>;

  /**
   * Take a screenshot
   * @param page Page to capture
   * @param options Screenshot options
   * @returns Base64-encoded image
   */
  screenshot(page: BackendPage, options?: BackendScreenshotOptions): Promise<BackendResult<string>>;

  /**
   * Get page content snapshot (accessibility tree or DOM)
   * @param page Page to snapshot
   * @param options Snapshot options
   */
  snapshot(page: BackendPage, options?: { format?: 'aria' | 'html' | 'text' }): Promise<BackendResult<BackendSnapshotResult>>;

  /**
   * Execute JavaScript in page context
   * @param page Page to execute in
   * @param script JavaScript code
   * @param args Arguments to pass
   */
  evaluate<T = any>(page: BackendPage, script: string, ...args: any[]): Promise<BackendResult<T>>;

  /**
   * Wait for element to appear
   * @param page Page to wait in
   * @param selector CSS selector
   * @param options Wait options
   */
  waitForElement(page: BackendPage, selector: string, options?: { timeout?: number; state?: 'attached' | 'visible' }): Promise<BackendResult<void>>;

  /**
   * Wait for navigation to complete
   * @param page Page to wait for
   * @param options Wait options
   */
  waitForNavigation(page: BackendPage, options?: BackendNavigateOptions): Promise<BackendResult<void>>;

  /**
   * Scroll the page
   * @param page Page to scroll
   * @param options Scroll direction/amount
   */
  scroll(page: BackendPage, options: { direction: 'up' | 'down'; amount?: number } | { selector: string }): Promise<BackendResult<void>>;

  /**
   * Close a page
   * @param page Page to close
   */
  closePage(page: BackendPage): Promise<BackendResult<void>>;

  /**
   * Close entire browser instance
   * @param instance Instance to close
   */
  close(instance: BackendInstance): Promise<BackendResult<void>>;

  /**
   * Set window size and position
   * @param instance Browser instance
   * @param bounds Window bounds
   */
  setWindowBounds?(instance: BackendInstance, bounds: { x?: number; y?: number; width?: number; height?: number }): Promise<BackendResult<void>>;

  /**
   * Set always-on-top flag
   * @param instance Browser instance
   * @param enabled Enable or disable
   */
  setAlwaysOnTop?(instance: BackendInstance, enabled: boolean): Promise<BackendResult<void>>;

  /**
   * Get cookies for current page
   * @param page Page to get cookies from
   */
  getCookies?(page: BackendPage): Promise<BackendResult<any[]>>;

  /**
   * Set cookies
   * @param page Page to set cookies on
   * @param cookies Cookies to set
   */
  setCookies?(page: BackendPage, cookies: any[]): Promise<BackendResult<void>>;
}

/** Events emitted by backends */
export interface BackendEvents {
  /** Page navigated */
  'navigation': { page: BackendPage; url: string };
  /** Console message */
  'console': { page: BackendPage; type: string; text: string };
  /** Page crashed or closed unexpectedly */
  'error': { page?: BackendPage; error: Error };
  /** Login detected */
  'login': { page: BackendPage; url: string };
}

/** Backend event handler */
export type BackendEventHandler<K extends keyof BackendEvents> = (event: BackendEvents[K]) => void;
