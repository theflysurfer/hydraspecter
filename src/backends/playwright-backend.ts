/**
 * Playwright Backend for HydraSpecter
 *
 * Default backend using Playwright with rebrowser-playwright for enhanced stealth.
 * Supports Chromium, Firefox, and WebKit.
 */

import { firefox, webkit, Browser, BrowserContext, Page, devices } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  IBrowserBackend,
  BackendType,
  BackendPage,
  BackendInstance,
  BackendCreateOptions,
  BackendNavigateOptions,
  BackendClickOptions,
  BackendTypeOptions,
  BackendScreenshotOptions,
  BackendSnapshotResult,
  BackendResult,
} from './types.js';

// Stealth plugin singleton
let stealthInitialized = false;
function initStealth() {
  if (stealthInitialized) return;
  const stealthPlugin = StealthPlugin();
  stealthPlugin.enabledEvasions.delete('navigator.webdriver');
  chromiumExtra.use(stealthPlugin);
  stealthInitialized = true;
}

/**
 * Wrap Playwright Page as BackendPage
 */
function wrapPage(page: Page, id: string): BackendPage {
  return {
    id,
    backend: 'playwright',
    url: () => Promise.resolve(page.url()),
    title: () => page.title(),
    native: page,
  };
}

/**
 * Playwright Backend Implementation
 */
export class PlaywrightBackend implements IBrowserBackend {
  readonly backendType: BackendType = 'playwright';
  readonly name = 'Playwright (rebrowser-playwright)';

  private instances: Map<string, { browser: Browser; context: BrowserContext; page: Page; instance: BackendInstance }> = new Map();

  async isAvailable(): Promise<boolean> {
    // Playwright is always available as a dependency
    return true;
  }

  async create(options: BackendCreateOptions = {}): Promise<BackendResult<BackendInstance>> {
    try {
      const id = uuidv4();
      const browserType = options.browserType || 'chromium';

      // Profile directory for persistence
      const profileDir = options.profileDir || path.join(
        os.homedir(),
        '.hydraspecter',
        'profiles',
        `playwright-${id.slice(0, 8)}`
      );

      // Ensure profile directory exists
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Launch options
      const launchOptions: any = {
        headless: options.headless ?? false,
        chromiumSandbox: true,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--disable-infobars',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
      };

      // Window size and position
      if (options.windowSize) {
        launchOptions.args.push(`--window-size=${options.windowSize.width},${options.windowSize.height}`);
      } else if (options.viewport !== null && options.viewport) {
        launchOptions.args.push(`--window-size=${options.viewport.width},${options.viewport.height}`);
      }

      if (options.windowPosition) {
        launchOptions.args.push(`--window-position=${options.windowPosition.x},${options.windowPosition.y}`);
      }

      // Channel (chrome, msedge)
      if (options.channel && browserType === 'chromium') {
        launchOptions.channel = options.channel;
      }

      // Proxy
      if (options.proxy) {
        launchOptions.args.push(`--proxy-server=${options.proxy}`);
      }

      let browser: Browser;
      let context: BrowserContext;
      let page: Page;

      // Launch based on browser type
      if (browserType === 'chromium') {
        initStealth();

        // Use persistent context for session persistence
        context = await chromiumExtra.launchPersistentContext(profileDir, {
          ...launchOptions,
          viewport: options.viewport === null ? null : options.viewport,
        });

        // Add webdriver override
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
          });
        });

        browser = context.browser()!;
        const pages = context.pages();
        page = pages.length > 0 ? pages[0]! : await context.newPage();
      } else if (browserType === 'firefox') {
        browser = await firefox.launch(launchOptions);
        context = await browser.newContext({
          viewport: options.viewport === null ? null : options.viewport,
        });
        page = await context.newPage();
      } else if (browserType === 'webkit') {
        browser = await webkit.launch(launchOptions);
        context = await browser.newContext({
          viewport: options.viewport === null ? null : options.viewport,
        });
        page = await context.newPage();
      } else {
        return {
          success: false,
          error: `Unsupported browser type: ${browserType}`,
        };
      }

      // Device emulation
      if (options.device) {
        const deviceConfig = devices[options.device];
        if (deviceConfig) {
          await page.setViewportSize(deviceConfig.viewport);
          // Note: UA is set at context level, would need new context for full emulation
        }
      }

      // Navigate to initial URL if provided
      if (options.url) {
        await page.goto(options.url, { waitUntil: 'domcontentloaded' });
      }

      const backendPage = wrapPage(page, `page-${uuidv4().slice(0, 8)}`);
      const instance: BackendInstance = {
        id,
        backend: 'playwright',
        page: backendPage,
        pages: async () => {
          const ctxPages = context.pages();
          return ctxPages.map((p, i) => wrapPage(p, `page-${i}`));
        },
        createdAt: new Date(),
        lastUsed: new Date(),
        native: { browser, context },
      };

      this.instances.set(id, { browser, context, page, instance });

      return {
        success: true,
        data: instance,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create Playwright instance: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async navigate(backendPage: BackendPage, url: string, options: BackendNavigateOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.goto(url, {
        timeout: options.timeout,
        waitUntil: options.waitUntil || 'domcontentloaded',
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Navigation failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async click(backendPage: BackendPage, selector: string, options: BackendClickOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.click(selector, {
        button: options.button,
        clickCount: options.clickCount,
        delay: options.delay,
        timeout: options.timeout,
        force: options.force,
        position: options.position,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async typeText(backendPage: BackendPage, selector: string, text: string, options: BackendTypeOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      const locator = page.locator(selector);
      await locator.waitFor({ timeout: options.timeout });

      if (options.clear) {
        await locator.clear();
      }

      await locator.pressSequentially(text, { delay: options.delay });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Type failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async fill(backendPage: BackendPage, selector: string, value: string, options: BackendTypeOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.fill(selector, value, { timeout: options.timeout });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Fill failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async screenshot(backendPage: BackendPage, options: BackendScreenshotOptions = {}): Promise<BackendResult<string>> {
    try {
      const page = backendPage.native as Page;
      const format = options.format || 'png';
      const buffer = await page.screenshot({
        fullPage: options.fullPage,
        type: format,
        quality: format === 'jpeg' ? options.quality : undefined,
        clip: options.clip,
      });
      return {
        success: true,
        data: buffer.toString('base64'),
      };
    } catch (error) {
      return {
        success: false,
        error: `Screenshot failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async snapshot(backendPage: BackendPage, options: { format?: 'aria' | 'html' | 'text' } = {}): Promise<BackendResult<BackendSnapshotResult>> {
    try {
      const page = backendPage.native as Page;
      const format = options.format || 'aria';

      let content: string;
      if (format === 'aria') {
        // Use Playwright's accessibility snapshot
        const snapshot = await page.accessibility.snapshot();
        content = JSON.stringify(snapshot, null, 2);
      } else if (format === 'html') {
        content = await page.content();
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }

      return {
        success: true,
        data: { content, format },
      };
    } catch (error) {
      return {
        success: false,
        error: `Snapshot failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async evaluate<T = any>(backendPage: BackendPage, script: string, ...args: any[]): Promise<BackendResult<T>> {
    try {
      const page = backendPage.native as Page;
      const result = await page.evaluate(new Function('return ' + script) as any, ...args);
      return {
        success: true,
        data: result as T,
      };
    } catch (error) {
      return {
        success: false,
        error: `Evaluate failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async waitForElement(backendPage: BackendPage, selector: string, options: { timeout?: number; state?: 'attached' | 'visible' } = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.waitForSelector(selector, {
        timeout: options.timeout,
        state: options.state,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Wait for element failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async waitForNavigation(backendPage: BackendPage, options: BackendNavigateOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.waitForLoadState(options.waitUntil || 'domcontentloaded', {
        timeout: options.timeout,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Wait for navigation failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async scroll(backendPage: BackendPage, options: { direction: 'up' | 'down'; amount?: number } | { selector: string }): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;

      if ('selector' in options) {
        await page.locator(options.selector).scrollIntoViewIfNeeded();
      } else {
        const amount = options.amount || 300;
        const delta = options.direction === 'down' ? amount : -amount;
        await page.mouse.wheel(0, delta);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Scroll failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async closePage(backendPage: BackendPage): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.close();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Close page failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async close(instance: BackendInstance): Promise<BackendResult<void>> {
    try {
      const stored = this.instances.get(instance.id);
      if (stored) {
        await stored.browser.close();
        this.instances.delete(instance.id);
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Close instance failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async setWindowBounds(instance: BackendInstance, bounds: { x?: number; y?: number; width?: number; height?: number }): Promise<BackendResult<void>> {
    try {
      const stored = this.instances.get(instance.id);
      if (!stored) {
        return { success: false, error: 'Instance not found' };
      }

      const page = stored.page;

      // Use CDP for window positioning
      const client = await page.context().newCDPSession(page);
      const { windowId } = await client.send('Browser.getWindowForTarget');

      await client.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          windowState: 'normal',
        },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Set window bounds failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async getCookies(backendPage: BackendPage): Promise<BackendResult<any[]>> {
    try {
      const page = backendPage.native as Page;
      const cookies = await page.context().cookies();
      return { success: true, data: cookies };
    } catch (error) {
      return {
        success: false,
        error: `Get cookies failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async setCookies(backendPage: BackendPage, cookies: any[]): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as Page;
      await page.context().addCookies(cookies);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Set cookies failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }
}
