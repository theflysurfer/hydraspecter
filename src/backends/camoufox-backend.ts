/**
 * Camoufox Backend for HydraSpecter
 *
 * Firefox-based stealth browser using camoufox-js npm package.
 * Excellent for Cloudflare bypass with built-in fingerprint spoofing.
 *
 * Key features:
 * - Firefox-based (different fingerprint than Chrome)
 * - Built-in fingerprint generation
 * - GeoIP-based locale/timezone
 * - Human-like cursor movement
 */

import { Camoufox } from 'camoufox';
import type { LaunchOptions } from 'camoufox';
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

// Use 'any' for playwright types to avoid version conflicts between
// camoufox's bundled playwright-core and our playwright package
type AnyPage = any;
type AnyContext = any;
type AnyBrowser = any;

/**
 * Wrap Camoufox Page as BackendPage
 */
function wrapPage(page: AnyPage, id: string): BackendPage {
  return {
    id,
    backend: 'camoufox',
    url: () => Promise.resolve(page.url()),
    title: () => page.title(),
    native: page,
  };
}

/**
 * Camoufox Backend Implementation
 *
 * Uses the camoufox-js npm package for native TypeScript integration.
 * Firefox-based with anti-fingerprinting and stealth features.
 */
export class CamoufoxBackend implements IBrowserBackend {
  readonly backendType: BackendType = 'camoufox';
  readonly name = 'Camoufox (Firefox Stealth)';

  private instances: Map<string, { context: AnyContext | AnyBrowser; page: AnyPage; instance: BackendInstance }> = new Map();

  async isAvailable(): Promise<boolean> {
    try {
      // Check if camoufox is importable
      const { Camoufox } = await import('camoufox');
      return typeof Camoufox === 'function';
    } catch {
      return false;
    }
  }

  async create(options: BackendCreateOptions = {}): Promise<BackendResult<BackendInstance>> {
    try {
      const id = uuidv4();

      // Profile directory for persistence
      const profileDir = options.profileDir || path.join(
        os.homedir(),
        '.hydraspecter',
        'camoufox-profile'
      );

      // Ensure profile directory exists
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Camoufox launch options
      const launchOptions: LaunchOptions = {
        // Persistence via data_dir
        data_dir: profileDir,

        // Anti-detection: headless is risky for stealth
        headless: options.headless ?? false,

        // Operating system fingerprint (match real system)
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',

        // Human-like cursor movement (built-in)
        humanize: true,

        // Auto-detect GeoIP for locale/timezone
        geoip: true,

        // Block common fingerprinting
        block_webrtc: false, // Keep WebRTC for some sites
        block_webgl: false,  // WebGL is common, blocking is suspicious

        // Window size
        window: options.windowSize
          ? [options.windowSize.width, options.windowSize.height]
          : options.viewport
            ? [options.viewport.width, options.viewport.height]
            : [1280, 720],

        // Proxy support
        proxy: options.proxy,
      };

      // Launch Camoufox - returns Browser or BrowserContext
      const result = await Camoufox(launchOptions);

      // Handle both Browser and BrowserContext return types
      let context: AnyContext;
      let page: AnyPage;

      if ('newContext' in result) {
        // It's a Browser
        const browser = result as AnyBrowser;
        context = await browser.newContext();
        page = await context.newPage();
      } else {
        // It's a BrowserContext (persistent)
        context = result as AnyContext;
        const pages = context.pages();
        page = pages.length > 0 ? pages[0] : await context.newPage();
      }

      // Navigate to initial URL if provided
      if (options.url) {
        await page.goto(options.url, { waitUntil: 'domcontentloaded' });
      }

      const backendPage = wrapPage(page, `page-${uuidv4().slice(0, 8)}`);
      const instance: BackendInstance = {
        id,
        backend: 'camoufox',
        page: backendPage,
        pages: async () => {
          const ctxPages = context.pages();
          return ctxPages.map((p: AnyPage, i: number) => wrapPage(p, `page-${i}`));
        },
        createdAt: new Date(),
        lastUsed: new Date(),
        native: context,
      };

      this.instances.set(id, { context: result, page, instance });

      return {
        success: true,
        data: instance,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create Camoufox instance: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  async navigate(backendPage: BackendPage, url: string, options: BackendNavigateOptions = {}): Promise<BackendResult<void>> {
    try {
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;

      // Camoufox has built-in humanize, so standard click is already "human-like"
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
      const page = backendPage.native as AnyPage;
      const locator = page.locator(selector);
      await locator.waitFor({ timeout: options.timeout });

      if (options.clear) {
        await locator.clear();
      }

      // pressSequentially is more human-like
      await locator.pressSequentially(text, { delay: options.delay || 50 });
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;

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
      const page = backendPage.native as AnyPage;
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
        const ctx = stored.context;
        if ('close' in ctx) {
          await ctx.close();
        }
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

  async getCookies(backendPage: BackendPage): Promise<BackendResult<any[]>> {
    try {
      const page = backendPage.native as AnyPage;
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
      const page = backendPage.native as AnyPage;
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
