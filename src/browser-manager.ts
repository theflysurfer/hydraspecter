import { firefox, webkit, Browser } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { v4 as uuidv4 } from 'uuid';
import { BrowserInstance, BrowserConfig, ServerConfig, ToolResult } from './types.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Enable stealth mode but disable navigator.webdriver evasion
// (it adds --disable-blink-features=AutomationControlled which causes Chrome warning)
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('navigator.webdriver');
chromiumExtra.use(stealthPlugin);

export class BrowserManager {
  private instances: Map<string, BrowserInstance> = new Map();
  private config: ServerConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private detectedProxy?: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.startCleanupTimer();

    // Initialize proxy detection during construction
    this.initializeProxy();
  }

  /**
   * Initialize proxy configuration
   */
  private async initializeProxy(): Promise<void> {
    const globalProxy = this.config.proxy;
    if (globalProxy?.server) {
      this.detectedProxy = globalProxy.server;
      console.log(`Using configured proxy: ${this.detectedProxy}`);
    } else if (globalProxy?.autoDetect !== false) {
      // Enable auto-detection by default
      this.detectedProxy = await this.detectLocalProxy();
      if (this.detectedProxy) {
        console.log(`Auto-detected proxy: ${this.detectedProxy}`);
      }
    }
  }

  /**
   * Auto-detect local proxy
   */
  private async detectLocalProxy(): Promise<string | undefined> {
    // 1. Check environment variables
    const envProxy = this.getProxyFromEnv();
    if (envProxy) {
      console.log(`Proxy detected from environment variables: ${envProxy}`);
      return envProxy;
    }

    // 2. Check common proxy ports
    const commonPorts = [7890, 1087, 8080, 3128, 8888, 10809, 20171];
    for (const port of commonPorts) {
      const proxyUrl = `http://127.0.0.1:${port}`;
      if (await this.testProxyConnection(proxyUrl)) {
        console.log(`Local proxy port detected: ${port}`);
        return proxyUrl;
      }
    }

    // 3. Try to detect system proxy settings (macOS)
    if (process.platform === 'darwin') {
      const systemProxy = this.getMacOSSystemProxy();
      if (systemProxy) {
        console.log(`System proxy detected: ${systemProxy}`);
        return systemProxy;
      }
    }

    return undefined;
  }

  /**
   * Get proxy from environment variables
   */
  private getProxyFromEnv(): string | undefined {
    const httpProxy = process.env['HTTP_PROXY'] || process.env['http_proxy'];
    const httpsProxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
    const allProxy = process.env['ALL_PROXY'] || process.env['all_proxy'];
    
    return httpProxy || httpsProxy || allProxy;
  }

  /**
   * Get macOS system proxy settings
   */
  private getMacOSSystemProxy(): string | undefined {
    try {
      const result = execSync('networksetup -getwebproxy "Wi-Fi" 2>/dev/null || networksetup -getwebproxy "Ethernet" 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000
      });
      
      const lines = result.split('\n');
      const enabled = lines.find(line => line.includes('Enabled: Yes'));
      if (!enabled) return undefined;
      
      const server = lines.find(line => line.includes('Server:'))?.split(': ')[1];
      const port = lines.find(line => line.includes('Port:'))?.split(': ')[1];
      
      if (server && port) {
        return `http://${server}:${port}`;
      }
    } catch (error) {
      // Ignore errors and continue with other methods
    }
    return undefined;
  }

  /**
   * Test proxy connection
   */
  private async testProxyConnection(proxyUrl: string): Promise<boolean> {
    try {
      // Simple port detection to avoid network request complexity
      const url = new URL(proxyUrl);
      const net = require('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        
        socket.on('error', () => {
          resolve(false);
        });
        
        socket.connect(parseInt(url.port), url.hostname);
      });
    } catch (error) {
      return false;
    }
  }

  

  /**
   * Get effective proxy configuration
   */
  private getEffectiveProxy(browserConfig?: Partial<BrowserConfig>): string | undefined {
    // Priority: instance config > global config > auto-detected
    if (browserConfig?.proxy?.server) {
      return browserConfig.proxy.server;
    }
    
    if (browserConfig?.proxy?.autoDetect === false) {
      return undefined; // Explicitly disable proxy
    }
    
    return this.detectedProxy;
  }

  /**
   * Create a new browser instance
   * Supports two modes:
   * 1. Normal mode: launches fresh browser with optional storageState
   * 2. Persistent mode: uses userDataDir for full Chrome profile persistence
   */
  async createInstance(
    browserConfig?: Partial<BrowserConfig>,
    metadata?: BrowserInstance['metadata']
  ): Promise<ToolResult> {
    try {
      if (this.instances.size >= this.config.maxInstances) {
        return {
          success: false,
          error: `Maximum number of instances (${this.config.maxInstances}) reached`
        };
      }

      const config = { ...this.config.defaultBrowserConfig, ...browserConfig };
      const effectiveProxy = this.getEffectiveProxy(browserConfig);

      let browser: Browser;
      let context: any;
      let page: any;

      // Use persistent context if userDataDir is specified
      if (config.userDataDir) {
        console.log('Using persistent browser context mode');
        const result = await this.launchPersistentBrowser(config);
        browser = result.browser;
        context = result.context;
        page = result.page;
      } else {
        // Normal mode: launch browser and create context
        browser = await this.launchBrowser(config);

        const contextOptions: any = {
          ...config.contextOptions
        };

        // Handle viewport: null means natural viewport (anti-detection)
        if (config.viewport === null) {
          contextOptions.viewport = null;  // Use natural viewport
          console.log('Using natural viewport (anti-detection mode)');
        } else if (config.viewport) {
          contextOptions.viewport = config.viewport;
        }

        // Only set user agent if explicitly provided (not recommended for stealth)
        if (config.userAgent) {
          contextOptions.userAgent = config.userAgent;
          console.warn('Custom user agent set - this may affect stealth mode');
        }

        // Add proxy configuration to context
        if (effectiveProxy) {
          contextOptions.proxy = { server: effectiveProxy };
        }

        // Load storage state if path is provided and file exists
        if (config.storageStatePath && fs.existsSync(config.storageStatePath)) {
          try {
            contextOptions.storageState = config.storageStatePath;
            console.log(`Loading session state from: ${config.storageStatePath}`);
          } catch (error) {
            console.warn(`Failed to load storage state: ${error}`);
          }
        }

        context = await browser.newContext(contextOptions);

        // Hide navigator.webdriver via JavaScript injection
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true
          });
        });

        page = await context.newPage();
      }

      const instanceId = uuidv4();
      const instance: BrowserInstance = {
        id: instanceId,
        browser,
        context,
        page,
        createdAt: new Date(),
        lastUsed: new Date(),
        isActive: true,
        ...(metadata && { metadata })
      };

      this.instances.set(instanceId, instance);

      return {
        success: true,
        data: {
          instanceId,
          browserType: config.browserType,
          headless: config.headless,
          viewport: config.viewport,
          proxy: effectiveProxy,
          metadata
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create browser instance: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Get browser instance
   */
  getInstance(instanceId: string): BrowserInstance | undefined {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.lastUsed = new Date();
    }
    return instance;
  }

  /**
   * List all instances
   */
  listInstances(): ToolResult {
    const instanceList = Array.from(this.instances.values()).map(instance => ({
      id: instance.id,
      isActive: instance.isActive,
      createdAt: instance.createdAt.toISOString(),
      lastUsed: instance.lastUsed.toISOString(),
      metadata: instance.metadata,
      currentUrl: instance.page.url()
    }));

    return {
      success: true,
      data: {
        instances: instanceList,
        totalCount: this.instances.size,
        maxInstances: this.config.maxInstances
      }
    };
  }

  /**
   * Close browser instance
   */
  async closeInstance(instanceId: string): Promise<ToolResult> {
    try {
      const instance = this.instances.get(instanceId);
      if (!instance) {
        return {
          success: false,
          error: `Instance ${instanceId} not found`
        };
      }

      await instance.browser.close();
      this.instances.delete(instanceId);

      return {
        success: true,
        data: { instanceId, closed: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to close instance: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Save session state (cookies, localStorage) to a file
   */
  async saveSessionState(instanceId: string, filePath: string): Promise<ToolResult> {
    try {
      const instance = this.instances.get(instanceId);
      if (!instance) {
        return {
          success: false,
          error: `Instance ${instanceId} not found`
        };
      }

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Save storage state (cookies + localStorage + sessionStorage)
      await instance.context.storageState({ path: filePath });

      return {
        success: true,
        data: {
          instanceId,
          filePath,
          saved: true,
          message: `Session state saved to ${filePath}`
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save session state: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Close all instances
   */
  async closeAllInstances(): Promise<ToolResult> {
    try {
      const closePromises = Array.from(this.instances.values()).map(
        instance => instance.browser.close()
      );
      
      await Promise.all(closePromises);
      const closedCount = this.instances.size;
      this.instances.clear();

      return {
        success: true,
        data: { closedCount }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to close all instances: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Get standard launch options for anti-detection
   */
  private getLaunchOptions(config: BrowserConfig): any {
    const launchOptions: any = {
      headless: config.headless ?? true,
      // Enable sandbox to avoid Chrome warning banner
      chromiumSandbox: true,
      // Remove automation-revealing default arguments
      ignoreDefaultArgs: ['--enable-automation'],
      // Comprehensive anti-detection flags
      args: [
        '--disable-infobars',  // Hides "Chrome is being controlled" banner
        '--disable-dev-shm-usage',  // Improves stability
        '--no-first-run',  // Prevents first-run dialogs
        '--no-default-browser-check',  // Skips default browser check
        '--disable-background-timer-throttling',  // Better performance
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=IsolateOrigins,site-per-process',  // Better compatibility
      ]
    };

    // Use real Chrome/Edge channel if specified (recommended for anti-detection)
    if (config.channel && config.browserType === 'chromium') {
      launchOptions.channel = config.channel;
      console.log(`Using real browser channel: ${config.channel}`);
    }

    // Add window size only if not using natural viewport
    if (config.viewport !== null) {
      const width = config.viewport?.width || 1920;
      const height = config.viewport?.height || 1080;
      launchOptions.args.push(`--window-size=${width},${height}`);
    }

    // Add proxy arguments for Chromium
    const effectiveProxy = this.getEffectiveProxy(config);
    if (effectiveProxy && config.browserType === 'chromium') {
      launchOptions.args.push(`--proxy-server=${effectiveProxy}`);
    }

    return launchOptions;
  }

  /**
   * Launch browser with persistent context (userDataDir)
   * This maintains a real Chrome profile with all cookies, extensions, etc.
   */
  async launchPersistentBrowser(config: BrowserConfig): Promise<{ browser: Browser; context: any; page: any }> {
    if (!config.userDataDir) {
      throw new Error('userDataDir is required for persistent context');
    }

    const launchOptions = this.getLaunchOptions(config);

    // Ensure userDataDir exists
    if (!fs.existsSync(config.userDataDir)) {
      fs.mkdirSync(config.userDataDir, { recursive: true });
      console.log(`Created user data directory: ${config.userDataDir}`);
    }

    console.log(`Launching persistent context with userDataDir: ${config.userDataDir}`);

    // launchPersistentContext returns a BrowserContext directly (not a Browser)
    const context = await chromiumExtra.launchPersistentContext(config.userDataDir, {
      ...launchOptions,
      viewport: config.viewport === null ? null : config.viewport,
      ignoreHTTPSErrors: config.contextOptions?.ignoreHTTPSErrors,
      bypassCSP: config.contextOptions?.bypassCSP,
    });

    // Hide navigator.webdriver via JavaScript injection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true
      });
    });

    // Get or create a page
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // For persistent context, browser() returns the browser instance
    const browser = context.browser()!;

    return { browser, context, page };
  }

  /**
   * Launch browser
   * Uses playwright-extra with stealth plugin for Chromium to avoid bot detection
   * Supports channel option to use real Chrome/Edge instead of Chromium
   */
  private async launchBrowser(config: BrowserConfig): Promise<Browser> {
    const launchOptions = this.getLaunchOptions(config);

    switch (config.browserType) {
      case 'chromium':
        // Use playwright-extra with stealth plugin to avoid bot detection
        const channelInfo = config.channel ? ` (channel: ${config.channel})` : '';
        console.log(`Launching Chromium with enhanced stealth mode${channelInfo}`);
        return await chromiumExtra.launch(launchOptions);
      case 'firefox':
        return await firefox.launch(launchOptions);
      case 'webkit':
        return await webkit.launch(launchOptions);
      default:
        throw new Error(`Unsupported browser type: ${config.browserType}`);
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupInactiveInstances();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up inactive instances
   */
  private async cleanupInactiveInstances(): Promise<void> {
    const now = new Date();
    const instancesToClose: string[] = [];

    for (const [id, instance] of this.instances.entries()) {
      const timeSinceLastUsed = now.getTime() - instance.lastUsed.getTime();
      if (timeSinceLastUsed > this.config.instanceTimeout) {
        instancesToClose.push(id);
      }
    }

    for (const instanceId of instancesToClose) {
      await this.closeInstance(instanceId);
      console.log(`Cleaned up inactive instance: ${instanceId}`);
    }
  }

  /**
   * Destroy manager
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    await this.closeAllInstances();
  }
} 