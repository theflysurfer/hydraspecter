import { BrowserContext, Page } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { v4 as uuidv4 } from 'uuid';
import { getProfilePool, ProfilePool, ProfileStatus } from './profile-pool.js';

// Enable stealth mode
chromiumExtra.use(StealthPlugin());

/** Page metadata */
export interface PageInfo {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
  lastUsed: Date;
}

/** Error thrown when all profiles are in use */
export class AllProfilesInUseError extends Error {
  public lockedProfiles: ProfileStatus[];

  constructor(lockedProfiles: ProfileStatus[]) {
    super('All profiles are in use');
    this.name = 'AllProfilesInUseError';
    this.lockedProfiles = lockedProfiles;
  }
}

/**
 * Manages a global persistent browser context using profile pool.
 * All pages share the same profile (cookies, localStorage, etc.)
 * Supports multi-process via profile pool.
 */
export class GlobalProfile {
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private profileDir: string | null = null;
  private profileId: string | null = null;
  private profilePool: ProfilePool;
  private headless: boolean;
  private channel?: 'chrome' | 'msedge';

  constructor(options?: {
    headless?: boolean;
    channel?: 'chrome' | 'msedge';
    poolSize?: number;
  }) {
    this.headless = options?.headless ?? false; // Default: visible for anti-detection
    this.channel = options?.channel;
    this.profilePool = getProfilePool({ poolSize: options?.poolSize });
  }

  /**
   * Get or create the global browser context
   * @throws AllProfilesInUseError if all profiles in the pool are locked
   */
  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    // Acquire a profile from the pool
    const acquired = await this.profilePool.acquireProfile();
    if (!acquired) {
      // All profiles are in use
      const profiles = this.profilePool.listProfiles();
      throw new AllProfilesInUseError(profiles.filter(p => !p.available));
    }

    this.profileId = acquired.profileId;
    this.profileDir = acquired.profilePath;

    console.log(`[GlobalProfile] Acquired profile: ${this.profileId}`);
    console.log(`[GlobalProfile] Launching persistent context from: ${this.profileDir}`);

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
      console.log(`[GlobalProfile] Using browser channel: ${this.channel}`);
    }

    this.context = await chromiumExtra.launchPersistentContext(this.profileDir, launchOptions);

    // Handle context close
    this.context.on('close', () => {
      console.log('[GlobalProfile] Context closed');
      this.context = null;
      this.pages.clear();
      // Release profile back to pool
      if (this.profileId) {
        this.profilePool.releaseProfile(this.profileId);
        this.profileId = null;
        this.profileDir = null;
      }
    });

    console.log(`[GlobalProfile] Context ready (headless: ${this.headless}, profile: ${this.profileId})`);
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

      // Release profile back to pool
      if (this.profileId) {
        this.profilePool.releaseProfile(this.profileId);
        console.log(`[GlobalProfile] Released profile: ${this.profileId}`);
        this.profileId = null;
        this.profileDir = null;
      }

      console.log('[GlobalProfile] Profile closed');
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
  getProfileDir(): string | null {
    return this.profileDir;
  }

  /**
   * Get acquired profile ID
   */
  getProfileId(): string | null {
    return this.profileId;
  }

  /**
   * Get page count
   */
  getPageCount(): number {
    return this.pages.size;
  }

  /**
   * List all profiles in the pool
   */
  listProfiles(): ProfileStatus[] {
    return this.profilePool.listProfiles();
  }

  /**
   * Force release a profile (for manual cleanup)
   */
  forceReleaseProfile(profileId: string): boolean {
    return this.profilePool.forceReleaseProfile(profileId);
  }
}

/** Singleton instance */
let globalProfileInstance: GlobalProfile | null = null;

/**
 * Get the global profile singleton
 */
export function getGlobalProfile(options?: {
  headless?: boolean;
  channel?: 'chrome' | 'msedge';
  poolSize?: number;
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

// Re-export types from profile-pool
export { ProfileStatus } from './profile-pool.js';
