import { Browser, BrowserContext, Page } from 'playwright';

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

export interface ServerConfig {
  maxInstances: number;
  defaultBrowserConfig: BrowserConfig;
  instanceTimeout: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  proxy?: ProxyConfig; // Global proxy configuration
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  instanceId?: string;
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
}

export interface TypeOptions {
  delay?: number;
  timeout?: number;
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