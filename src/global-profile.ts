import { BrowserContext, Page } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

// Enable stealth mode
chromiumExtra.use(StealthPlugin());

/** Default profile directory */
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.hydraspecter', 'profile');

/** Page metadata */
export interface PageInfo {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
  lastUsed: Date;
}

/**
 * Manages a single global persistent browser context
 * All pages share the same profile (cookies, localStorage, etc.)
 */
export class GlobalProfile {
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private profileDir: string;
  private headless: boolean;
  private channel?: 'chrome' | 'msedge';

  constructor(options?: {
    profileDir?: string;
    headless?: boolean;
    channel?: 'chrome' | 'msedge';
  }) {
    this.profileDir = options?.profileDir || DEFAULT_PROFILE_DIR;
    this.headless = options?.headless ?? false; // Default: visible for anti-detection
    this.channel = options?.channel;
    this.ensureProfileDir();
  }

  /**
   * Ensure profile directory exists
   */
  private ensureProfileDir(): void {
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
      console.log(`Created global profile directory: ${this.profileDir}`);
    }
  }

  /**
   * Get or create the global browser context
   */
  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    console.log(`Launching persistent context from: ${this.profileDir}`);

    const launchOptions: any = {
      headless: this.headless,
      // Anti-detection flags
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      // Natural viewport (anti-detection)
      viewport: null,
    };

    // Use real Chrome if specified
    if (this.channel) {
      launchOptions.channel = this.channel;
      console.log(`Using browser channel: ${this.channel}`);
    }

    this.context = await chromiumExtra.launchPersistentContext(this.profileDir, launchOptions);

    // Handle context close
    this.context.on('close', () => {
      console.log('Global context closed');
      this.context = null;
      this.pages.clear();
    });

    console.log(`Global context ready (headless: ${this.headless})`);
    return this.context;
  }

  /**
   * Create a new page in the global context
   */
  async createPage(url?: string): Promise<{ pageId: string; page: Page }> {
    const context = await this.getContext();
    const page = await context.newPage();
    const pageId = uuidv4();

    this.pages.set(pageId, page);

    // Handle page close
    page.on('close', () => {
      this.pages.delete(pageId);
    });

    // Navigate if URL provided
    if (url) {
      await page.goto(url, { waitUntil: 'load' });
    }

    console.log(`Created page ${pageId}${url ? ` at ${url}` : ''}`);
    return { pageId, page };
  }

  /**
   * Get a page by ID
   */
  getPage(pageId: string): Page | undefined {
    return this.pages.get(pageId);
  }

  /**
   * Close a page by ID
   */
  async closePage(pageId: string): Promise<boolean> {
    const page = this.pages.get(pageId);
    if (!page) return false;

    await page.close();
    this.pages.delete(pageId);
    console.log(`Closed page ${pageId}`);
    return true;
  }

  /**
   * List all pages
   */
  async listPages(): Promise<PageInfo[]> {
    const pageInfos: PageInfo[] = [];

    for (const [id, page] of this.pages) {
      try {
        pageInfos.push({
          id,
          url: page.url(),
          title: await page.title(),
          createdAt: new Date(), // Would need to track this
          lastUsed: new Date(),
        });
      } catch {
        // Page may have been closed
        this.pages.delete(id);
      }
    }

    return pageInfos;
  }

  /**
   * Close all pages
   */
  async closeAllPages(): Promise<number> {
    const count = this.pages.size;
    for (const page of this.pages.values()) {
      try {
        await page.close();
      } catch {
        // Ignore errors
      }
    }
    this.pages.clear();
    return count;
  }

  /**
   * Close the context (and all pages)
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.pages.clear();
      console.log('Global profile closed');
    }
  }

  /**
   * Check if context is active
   */
  isActive(): boolean {
    return this.context !== null;
  }

  /**
   * Get profile directory path
   */
  getProfileDir(): string {
    return this.profileDir;
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.pages.size;
  }
}

/** Singleton instance */
let globalProfileInstance: GlobalProfile | null = null;

/**
 * Get the global profile singleton
 */
export function getGlobalProfile(options?: {
  profileDir?: string;
  headless?: boolean;
  channel?: 'chrome' | 'msedge';
}): GlobalProfile {
  if (!globalProfileInstance) {
    globalProfileInstance = new GlobalProfile(options);
  }
  return globalProfileInstance;
}

/**
 * Reset the global profile (for testing)
 */
export async function resetGlobalProfile(): Promise<void> {
  if (globalProfileInstance) {
    await globalProfileInstance.close();
    globalProfileInstance = null;
  }
}
