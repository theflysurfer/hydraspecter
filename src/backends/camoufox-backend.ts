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

// Dynamic import to avoid ESM issues - camoufox is loaded only when needed
// The camoufox package has CJS dependencies that fail with ESM dynamic import
// We use createRequire() to load it in CJS mode
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

// Create a require function for CJS module loading
const require = createRequire(import.meta.url);

// Lazy-loaded camoufox module
let CamoufoxClass: any = null;

async function loadCamoufox(): Promise<any> {
  if (!CamoufoxClass) {
    try {
      // Use createRequire to load camoufox in CJS mode
      // This avoids the "Dynamic require of events is not supported" error
      const camoufox = require('camoufox');
      CamoufoxClass = camoufox.Camoufox;
    } catch (error: unknown) {
      // If CJS require fails, try ESM import as fallback
      try {
        const module = await import('camoufox');
        CamoufoxClass = module.Camoufox;
      } catch {
        throw error; // Re-throw the original error
      }
    }
  }
  return CamoufoxClass;
}

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
      const Camoufox = await loadCamoufox();
      return typeof Camoufox === 'function';
    } catch {
      return false;
    }
  }

  async create(options: BackendCreateOptions = {}): Promise<BackendResult<BackendInstance>> {
    try {
      const id = uuidv4();

      // Profile directory for persistence
      // NOTE: data_dir causes launchPersistentContext to crash on Windows
      // See: browserType.launchPersistentContext: Target page, context or browser has been closed
      // For now, we disable persistence until the bug is fixed in camoufox
      const profileDir = options.profileDir || path.join(
        os.homedir(),
        '.hydraspecter',
        'camoufox-profile'
      );

      // Ensure profile directory exists (for future use when persistence is fixed)
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Camoufox launch options - MINIMAL config that works on Windows
      // Many options cause crashes or conflicts with rebrowser-playwright
      const launchOptions: any = {
        // Anti-detection: headless is risky for stealth
        headless: options.headless ?? false,

        // GeoIP disabled - requires external API call that may fail
        geoip: false,

        // DISABLED options that cause issues on Windows:
        // - data_dir: causes launchPersistentContext crash
        // - humanize: can conflict with page scripts
        // - os: type validation issues
        // - window: causes window.screenY type error
        // - block_webrtc/block_webgl: not needed

        // Proxy support (only if explicitly provided)
        ...(options.proxy ? { proxy: options.proxy } : {}),
      };

      // Launch Camoufox - returns Browser or BrowserContext
      const Camoufox = await loadCamoufox();
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
      // Use longer timeout and don't fail the whole creation if navigation times out
      if (options.url) {
        try {
          await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (navError) {
          console.error(`[CamoufoxBackend] Navigation to ${options.url} failed: ${navError}. Browser created, user can navigate manually.`);
          // Don't fail - browser is still usable
        }
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
