import { BrowserContext, Page } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { v4 as uuidv4 } from 'uuid';
import { getProfilePool, ProfilePool, ProfileStatus } from './profile-pool.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

// Enable stealth mode but disable navigator.webdriver evasion
// (it adds --disable-blink-features=AutomationControlled which causes Chrome warning)
// We'll use JavaScript injection instead (see addInitScript below)
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('navigator.webdriver');
chromiumExtra.use(stealthPlugin);

// Critical domains that need session data (cookies + localStorage + IndexedDB)
const CRITICAL_DOMAINS = [
  'google', 'notion', 'amazon', 'temu', 'github', 'gitlab',
  'spotify', 'netflix', 'dropbox', 'slack', 'discord', 'linkedin'
];

/**
 * Copy a directory recursively
 */
function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        // Skip locked files
      }
    }
  }
}

/**
 * Try to sync cookies using Windows Volume Shadow Copy (VSS).
 * This is the only reliable way to copy locked files on Windows.
 * Requires running the sync-cookies-vss.ps1 script with admin privileges.
 * Returns true if VSS sync was successful.
 */
function trySyncViaVSS(targetProfileDir: string): boolean {
  try {
    const { execSync } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'sync-cookies-vss.ps1');

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.log('[SessionSync] VSS script not found, skipping');
      return false;
    }

    // Try to run the VSS script (requires admin)
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -TargetDir "${path.dirname(targetProfileDir)}"`,
      { stdio: 'pipe', timeout: 30000 }
    );

    console.log('[SessionSync] ✓ VSS sync succeeded');
    return true;
  } catch (error: any) {
    // VSS requires admin privileges - this is expected to fail in normal mode
    if (error.status === 1 || error.message?.includes('Administrator')) {
      console.log('[SessionSync] VSS requires admin privileges - run sync-cookies-vss.ps1 as admin once');
    } else {
      console.log(`[SessionSync] VSS sync failed: ${error.message}`);
    }
    return false;
  }
}

/**
 * Copy cookies using SQLite read-only mode.
 * This works even when Chrome is running and has the file locked.
 * Uses better-sqlite3 with readonly mode to bypass Chrome's lock.
 */
function syncCookiesViaSqlite(chromeCookiesPath: string, targetCookiesPath: string): boolean {
  try {
    // Open Chrome's cookies database in read-only mode
    // This bypasses the file lock that Chrome holds
    const sourceDb = new Database(chromeCookiesPath, {
      readonly: true,
      fileMustExist: true
    });

    // Read all cookies from Chrome
    const cookies = sourceDb.prepare('SELECT * FROM cookies').all();
    sourceDb.close();

    if (cookies.length === 0) {
      console.log('[SessionSync] No cookies found in Chrome');
      return false;
    }

    // Ensure target directory exists
    const targetDir = path.dirname(targetCookiesPath);
    fs.mkdirSync(targetDir, { recursive: true });

    // Delete existing target database if it exists (to avoid conflicts)
    if (fs.existsSync(targetCookiesPath)) {
      fs.unlinkSync(targetCookiesPath);
    }
    const journalPath = targetCookiesPath + '-journal';
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }

    // Create new target database with same schema
    const targetDb = new Database(targetCookiesPath);

    // Get the schema from source and create in target
    const sourceDbForSchema = new Database(chromeCookiesPath, { readonly: true, fileMustExist: true });
    const tableInfo = sourceDbForSchema.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cookies'").get() as { sql: string } | undefined;
    sourceDbForSchema.close();

    if (!tableInfo?.sql) {
      console.log('[SessionSync] Could not read cookies table schema');
      targetDb.close();
      return false;
    }

    // Create the cookies table
    targetDb.exec(tableInfo.sql);

    // Get column names for the insert
    const columns = Object.keys(cookies[0] as object);
    const placeholders = columns.map(() => '?').join(', ');
    const insertStmt = targetDb.prepare(
      `INSERT OR REPLACE INTO cookies (${columns.join(', ')}) VALUES (${placeholders})`
    );

    // Insert all cookies in a transaction for speed
    const insertMany = targetDb.transaction((cookiesList: any[]) => {
      for (const cookie of cookiesList) {
        insertStmt.run(...columns.map(col => (cookie as any)[col]));
      }
    });

    insertMany(cookies);
    targetDb.close();

    console.log(`[SessionSync] ✓ Cookies synced via SQLite (${cookies.length} cookies)`);
    return true;
  } catch (error: any) {
    // If even SQLite read-only fails, Chrome might have an exclusive lock
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
      console.log('[SessionSync] ⊘ SQLite database is busy/locked');
    } else {
      console.log(`[SessionSync] ⊘ SQLite sync failed: ${error.message}`);
    }
    return false;
  }
}

/**
 * Sync session data from real Chrome profile to HydraSpecter profile.
 * Syncs: Cookies, Local Storage, and IndexedDB for critical domains.
 * This ensures sessions (Google, Notion, Amazon, Temu, etc.) stay fresh.
 */
async function syncSessionDataFromChrome(targetProfileDir: string): Promise<boolean> {
  try {
    // Chrome default profile path (Windows)
    const chromeProfileDir = path.join(
      process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'),
      'Google', 'Chrome', 'User Data', 'Default'
    );

    const chromeCookies = path.join(chromeProfileDir, 'Network', 'Cookies');
    const targetCookies = path.join(targetProfileDir, 'Network', 'Cookies');

    // Check if Chrome cookies exist
    if (!fs.existsSync(chromeCookies)) {
      console.log('[SessionSync] Chrome profile not found, skipping sync');
      return false;
    }

    // Check modification time
    const chromeStats = fs.statSync(chromeCookies);
    const targetStats = fs.existsSync(targetCookies) ? fs.statSync(targetCookies) : null;

    // Only sync if Chrome cookies are newer (at least 1 hour difference)
    const hourInMs = 60 * 60 * 1000;
    if (targetStats && (chromeStats.mtime.getTime() - targetStats.mtime.getTime()) < hourInMs) {
      console.log('[SessionSync] Target session data is recent, skipping sync');
      return false;
    }

    console.log('[SessionSync] Chrome data is newer, syncing sessions...');

    // 1. Sync Cookies (all sites)
    const targetNetworkDir = path.join(targetProfileDir, 'Network');
    fs.mkdirSync(targetNetworkDir, { recursive: true });

    let cookiesSynced = false;
    try {
      // Try direct file copy first (fastest when Chrome is closed)
      fs.copyFileSync(chromeCookies, targetCookies);
      const chromeJournal = chromeCookies + '-journal';
      if (fs.existsSync(chromeJournal)) {
        fs.copyFileSync(chromeJournal, targetCookies + '-journal');
      }
      console.log('[SessionSync] ✓ Cookies synced (direct copy)');
      cookiesSynced = true;
    } catch (e: any) {
      if (e.code === 'EBUSY' || e.code === 'EACCES') {
        // Chrome is running, try SQLite read-only mode
        console.log('[SessionSync] Chrome running, trying SQLite read-only mode...');
        cookiesSynced = syncCookiesViaSqlite(chromeCookies, targetCookies);

        // If SQLite also fails, try VSS as last resort (requires admin)
        if (!cookiesSynced && process.platform === 'win32') {
          console.log('[SessionSync] SQLite failed, trying VSS...');
          cookiesSynced = trySyncViaVSS(targetProfileDir);
        }
      } else {
        throw e;
      }
    }

    // 2. Sync Local Storage (all - it's a LevelDB, can't filter easily)
    const chromeLS = path.join(chromeProfileDir, 'Local Storage', 'leveldb');
    const targetLS = path.join(targetProfileDir, 'Local Storage', 'leveldb');

    if (fs.existsSync(chromeLS)) {
      try {
        copyDirSync(chromeLS, targetLS);
        console.log('[SessionSync] ✓ Local Storage synced');
      } catch (e: any) {
        console.log('[SessionSync] ⊘ Local Storage locked');
      }
    }

    // 3. Sync IndexedDB for critical domains only
    const chromeIDB = path.join(chromeProfileDir, 'IndexedDB');
    const targetIDB = path.join(targetProfileDir, 'IndexedDB');

    if (fs.existsSync(chromeIDB)) {
      fs.mkdirSync(targetIDB, { recursive: true });
      const idbDirs = fs.readdirSync(chromeIDB);
      let syncedCount = 0;

      for (const dir of idbDirs) {
        // Check if this IndexedDB belongs to a critical domain
        const isCritical = CRITICAL_DOMAINS.some(domain =>
          dir.toLowerCase().includes(domain)
        );

        if (isCritical) {
          try {
            copyDirSync(
              path.join(chromeIDB, dir),
              path.join(targetIDB, dir)
            );
            syncedCount++;
          } catch (e) {
            // Skip locked files
          }
        }
      }

      if (syncedCount > 0) {
        console.log(`[SessionSync] ✓ IndexedDB synced (${syncedCount} critical domains)`);
      }
    }

    console.log('[SessionSync] Session sync complete');
    return cookiesSynced; // Return true only if cookies were synced
  } catch (error: any) {
    if (error.code === 'EBUSY' || error.code === 'EACCES') {
      console.log('[SessionSync] Chrome is running, partial sync only');
    } else {
      console.log(`[SessionSync] Error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Sync Chrome sessions to ALL pools at startup.
 * This ensures all pools have auth sessions available.
 */
export async function syncAllProfilesFromChrome(): Promise<{ synced: number; failed: number }> {
  const baseDir = path.join(os.homedir(), '.hydraspecter', 'profiles');
  let synced = 0;
  let failed = 0;

  // Get all pool directories
  if (!fs.existsSync(baseDir)) {
    console.log('[SyncAll] No profiles directory found');
    return { synced: 0, failed: 0 };
  }

  const pools = fs.readdirSync(baseDir).filter(d => d.startsWith('pool-'));
  console.log(`[SyncAll] Syncing Chrome sessions to ${pools.length} pools...`);

  for (const pool of pools) {
    const poolPath = path.join(baseDir, pool);
    const result = await syncSessionDataFromChrome(poolPath);
    if (result) {
      synced++;
    } else {
      failed++;
    }
  }

  console.log(`[SyncAll] Done: ${synced} synced, ${failed} skipped/failed`);
  return { synced, failed };
}

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
  private preferredProfileId?: string;

  constructor(options?: {
    headless?: boolean;
    channel?: 'chrome' | 'msedge';
    poolSize?: number;
    preferredProfileId?: string;
  }) {
    this.headless = options?.headless ?? false; // Default: visible for anti-detection
    // For persistent/incognito modes, default to real Chrome for sessions & anti-detection
    // Chromium is used for isolated mode (handled in BrowserManager)
    this.channel = options?.channel ?? 'chrome';
    this.profilePool = getProfilePool({ poolSize: options?.poolSize });
    this.preferredProfileId = options?.preferredProfileId;
  }

  /**
   * Get or create the global browser context
   * @throws AllProfilesInUseError if all profiles in the pool are locked
   */
  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    // Acquire a profile from the pool (use preferred if specified)
    const acquired = await this.profilePool.acquireProfile(this.preferredProfileId);
    if (!acquired) {
      // All profiles are in use
      const profiles = this.profilePool.listProfiles();
      throw new AllProfilesInUseError(profiles.filter(p => !p.available));
    }

    this.profileId = acquired.profileId;
    this.profileDir = acquired.profilePath;

    console.log(`[GlobalProfile] Acquired profile: ${this.profileId}`);

    // Auto-sync session data from Chrome if available and newer
    // Syncs: Cookies (all) + Local Storage (all) + IndexedDB (critical domains)
    await syncSessionDataFromChrome(this.profileDir);

    console.log(`[GlobalProfile] Launching persistent context from: ${this.profileDir}`);

    const launchOptions: any = {
      headless: this.headless,
      // Enable sandbox to avoid Chrome warning banner
      chromiumSandbox: true,
      // Anti-detection flags (recommended by Gemini 2025-2026)
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        // Modern anti-fingerprinting flags (Gemini 2025-2026)
        '--disable-features=IsOledReady,ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,AcceptCHFrame,OptimizationHints',
        '--enable-features=NetworkService,NetworkServiceInProcess',
      ],
      // Realistic viewport for anti-detection (Gemini recommendation)
      viewport: { width: 1440, height: 900 },
      // Modern User-Agent (Gemini recommendation)
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    };

    // Use real Chrome if specified
    if (this.channel) {
      launchOptions.channel = this.channel;
      console.log(`[GlobalProfile] Using browser channel: ${this.channel}`);
    }

    this.context = await chromiumExtra.launchPersistentContext(this.profileDir, launchOptions);

    // Hide navigator.webdriver via JavaScript injection (replaces the Chrome flag that caused warning)
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true
      });
    });

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
   * Reuses existing about:blank page if available to avoid empty tabs
   */
  async createPage(url?: string): Promise<{ pageId: string; page: Page }> {
    const context = await this.getContext();

    // Try to reuse existing about:blank page instead of creating new one
    const existingPages = context.pages();
    let page: Page;
    let reused = false;

    const blankPage = existingPages.find(p => {
      const pageUrl = p.url();
      return pageUrl === 'about:blank' || pageUrl === '';
    });

    if (blankPage) {
      page = blankPage;
      reused = true;
      console.log('[GlobalProfile] Reusing existing about:blank page');
    } else {
      page = await context.newPage();
    }

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

    console.log(`${reused ? 'Reused' : 'Created'} page ${pageId}${url ? ` at ${url}` : ''}`);
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
   * Also closes the browser context to unlock files (cookies, etc.)
   */
  async forceReleaseProfile(profileId: string): Promise<{ released: boolean; contextClosed: boolean }> {
    let contextClosed = false;

    // If this is our active profile, close the context first
    if (this.context && this.profileId === profileId) {
      try {
        await this.context.close();
        this.context = null;
        this.pages.clear();
        contextClosed = true;
        console.log(`[GlobalProfile] Closed context for profile: ${profileId}`);
      } catch (error) {
        console.error(`[GlobalProfile] Error closing context: ${error}`);
      }
      this.profileId = null;
      this.profileDir = null;
    }

    // Release the profile in the pool
    const released = this.profilePool.forceReleaseProfile(profileId);

    return { released, contextClosed };
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

/**
 * Switch to pool-0 (the auth profile with synced Chrome sessions).
 * Closes current context and reacquires pool-0 specifically.
 * Use this when navigating to auth-required domains (Notion, Gmail, etc.)
 */
export async function switchToAuthProfile(): Promise<{
  success: boolean;
  previousProfile: string | null;
  newProfile: string | null;
  error?: string;
}> {
  const previousProfile = globalProfileInstance?.getProfileId() || null;

  // If already using pool-0, just return success
  if (previousProfile === 'pool-0') {
    return { success: true, previousProfile, newProfile: 'pool-0' };
  }

  // Close current profile if exists
  if (globalProfileInstance) {
    await globalProfileInstance.close();
    globalProfileInstance = null;
  }

  // Create new instance with pool-0 as preferred profile
  globalProfileInstance = new GlobalProfile({ preferredProfileId: 'pool-0' });

  try {
    await globalProfileInstance.getContext();
    const newProfile = globalProfileInstance.getProfileId();

    if (newProfile === 'pool-0') {
      return { success: true, previousProfile, newProfile };
    } else {
      return {
        success: false,
        previousProfile,
        newProfile,
        error: `Could not acquire pool-0 (got ${newProfile}). pool-0 may be locked by another process.`
      };
    }
  } catch (error) {
    return {
      success: false,
      previousProfile,
      newProfile: null,
      error: `Failed to switch profile: ${error instanceof Error ? error.message : error}`
    };
  }
}

// Re-export types from profile-pool
export { ProfileStatus } from './profile-pool.js';
