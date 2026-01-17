import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Protection level for a domain */
export type ProtectionLevel = 0 | 1 | 2 | 3;

/** Domain profile stored in intelligence file */
export interface DomainProfile {
  level: ProtectionLevel;
  lastSuccess?: string;
  lastDetection?: string;
  detectionCount?: number;
}

/** Protection settings for each level */
export interface ProtectionSettings {
  humanizeMouse: boolean;
  humanizeTyping: boolean;
  humanizeScroll: boolean;
  headless: boolean;
  delays: {
    beforeClick: [number, number];
    beforeType: [number, number];
    afterNavigate: [number, number];
  };
}

/** Default storage path */
const DEFAULT_INTELLIGENCE_PATH = path.join(os.homedir(), '.hydraspecter', 'domain-intelligence.json');

/**
 * Known difficult domains that require high protection by default
 */
const HIGH_PROTECTION_DOMAINS = new Set([
  'tidal.com',
  'spotify.com',
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'amazon.com',
  'primevideo.com',
]);

/**
 * Domains that ALWAYS require authenticated session (pool-0)
 * These are PRIVATE services where unauthenticated access is useless.
 *
 * NOT included (can be scraped without login):
 * - github.com, gitlab.com (public repos)
 * - amazon.com (product pages)
 * - google.com (search, YouTube)
 * - notion.site (public Notion pages)
 * - discord.com (public servers)
 * - figma.com (public designs)
 */
const AUTH_REQUIRED_DOMAINS = new Set([
  // Google PRIVATE services (not google.com which has public search/YouTube)
  'gmail.com',
  'mail.google.com',
  'calendar.google.com',
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'meet.google.com',
  // Notion workspace (NOT notion.site which is public pages)
  'notion.so',
  // Private messaging
  'slack.com',
  'outlook.com',
  'outlook.live.com',
  'teams.microsoft.com',
]);

/**
 * Protection settings per level
 */
const PROTECTION_LEVELS: Record<ProtectionLevel, ProtectionSettings> = {
  0: {
    humanizeMouse: false,
    humanizeTyping: false,
    humanizeScroll: false,
    headless: true,
    delays: {
      beforeClick: [0, 0],
      beforeType: [0, 0],
      afterNavigate: [0, 0],
    },
  },
  1: {
    humanizeMouse: true,
    humanizeTyping: true,
    humanizeScroll: true,
    headless: true,
    delays: {
      beforeClick: [100, 300],
      beforeType: [50, 150],
      afterNavigate: [500, 1000],
    },
  },
  2: {
    humanizeMouse: true,
    humanizeTyping: true,
    humanizeScroll: true,
    headless: false, // Visible browser
    delays: {
      beforeClick: [300, 800],
      beforeType: [100, 400],
      afterNavigate: [1000, 2500],
    },
  },
  3: {
    humanizeMouse: true,
    humanizeTyping: true,
    humanizeScroll: true,
    headless: false,
    delays: {
      beforeClick: [500, 1500],
      beforeType: [200, 600],
      afterNavigate: [2000, 4000],
    },
  },
};

/**
 * Manages domain-specific protection levels with automatic learning
 */
export class DomainIntelligence {
  private profiles: Map<string, DomainProfile> = new Map();
  private storagePath: string;
  private dirty: boolean = false;
  private saveTimer?: NodeJS.Timeout;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || DEFAULT_INTELLIGENCE_PATH;
    this.load();
  }

  /**
   * Extract root domain from URL using simple heuristics
   * Examples:
   *   accounts.google.com -> google.com
   *   www.hellofresh.fr -> hellofresh.fr
   *   api.sub.example.co.uk -> example.co.uk
   */
  getRootDomain(urlOrHostname: string): string {
    let hostname: string;

    try {
      // Try to parse as URL first
      const url = new URL(urlOrHostname.includes('://') ? urlOrHostname : `https://${urlOrHostname}`);
      hostname = url.hostname;
    } catch {
      hostname = urlOrHostname;
    }

    // Remove www prefix
    hostname = hostname.replace(/^www\./, '');

    // Common two-part TLDs
    const twoPartTlds = [
      'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
      'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tw',
      'org.uk', 'net.au', 'gov.uk', 'ac.uk',
    ];

    const parts = hostname.split('.');

    // Check for two-part TLD
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTlds.includes(lastTwo)) {
        // Return last 3 parts (domain + two-part TLD)
        return parts.slice(-3).join('.');
      }
    }

    // Standard case: return last 2 parts
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }

    return hostname;
  }

  /**
   * Get protection level for a URL/domain
   */
  getLevel(url: string): ProtectionLevel {
    const domain = this.getRootDomain(url);
    const profile = this.profiles.get(domain);

    // If no profile exists and it's a known difficult domain, start with level 2
    if (!profile && HIGH_PROTECTION_DOMAINS.has(domain)) {
      console.error(`[DomainIntelligence] ${domain} is a known difficult domain, using protection level 2`);
      return 2;
    }

    return profile?.level ?? 0;
  }

  /**
   * Get protection settings for a URL/domain
   */
  getSettings(url: string): ProtectionSettings {
    const level = this.getLevel(url);
    return PROTECTION_LEVELS[level];
  }

  /**
   * Check if a URL/domain requires authenticated session (pool-0)
   * Returns true for productivity tools like Notion, Google, etc.
   */
  requiresAuth(url: string): boolean {
    const domain = this.getRootDomain(url);
    const hostname = url.includes('://') ? new URL(url).hostname : url;

    // Check exact match first (for subdomains like calendar.google.com)
    if (AUTH_REQUIRED_DOMAINS.has(hostname.replace(/^www\./, ''))) {
      return true;
    }

    // Check root domain
    if (AUTH_REQUIRED_DOMAINS.has(domain)) {
      return true;
    }

    return false;
  }

  /**
   * Report a detection event (blocked, CAPTCHA, etc.)
   * Increments protection level for the domain
   */
  reportDetection(url: string): ProtectionLevel {
    const domain = this.getRootDomain(url);
    const profile = this.profiles.get(domain) || { level: 0 as ProtectionLevel };

    // Increment level (max 3)
    const newLevel = Math.min(profile.level + 1, 3) as ProtectionLevel;

    this.profiles.set(domain, {
      ...profile,
      level: newLevel,
      lastDetection: new Date().toISOString(),
      detectionCount: (profile.detectionCount || 0) + 1,
    });

    console.error(`[DomainIntelligence] ${domain}: Detection reported, level ${profile.level} -> ${newLevel}`);
    this.scheduleSave();

    return newLevel;
  }

  /**
   * Report a successful action
   * Records timestamp but doesn't decrease level (conservative approach)
   */
  reportSuccess(url: string): void {
    const domain = this.getRootDomain(url);
    const profile = this.profiles.get(domain);

    if (profile) {
      profile.lastSuccess = new Date().toISOString();
      this.scheduleSave();
    }
  }

  /**
   * Manually set protection level for a domain
   */
  setLevel(url: string, level: ProtectionLevel): void {
    const domain = this.getRootDomain(url);
    const profile = this.profiles.get(domain) || { level: 0 as ProtectionLevel };

    this.profiles.set(domain, {
      ...profile,
      level,
    });

    console.error(`[DomainIntelligence] ${domain}: Level set to ${level}`);
    this.scheduleSave();
  }

  /**
   * Reset protection level for a domain
   */
  resetLevel(url: string): void {
    const domain = this.getRootDomain(url);
    this.profiles.delete(domain);
    console.error(`[DomainIntelligence] ${domain}: Level reset`);
    this.scheduleSave();
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): Array<{ domain: string; profile: DomainProfile }> {
    return Array.from(this.profiles.entries()).map(([domain, profile]) => ({
      domain,
      profile,
    }));
  }

  /**
   * Get random delay from range
   */
  getDelay(range: [number, number]): number {
    const [min, max] = range;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Load profiles from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf-8');
        const data = JSON.parse(content) as Record<string, DomainProfile>;

        this.profiles.clear();
        for (const [domain, profile] of Object.entries(data)) {
          this.profiles.set(domain, profile);
        }

        console.error(`[DomainIntelligence] Loaded ${this.profiles.size} domain profiles`);
      }
    } catch (error) {
      console.warn(`[DomainIntelligence] Failed to load: ${error}`);
    }
  }

  /**
   * Save profiles to disk
   */
  private save(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: Record<string, DomainProfile> = {};
      for (const [domain, profile] of this.profiles) {
        data[domain] = profile;
      }

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
      this.dirty = false;
      console.error(`[DomainIntelligence] Saved ${this.profiles.size} domain profiles`);
    } catch (error) {
      console.error(`[DomainIntelligence] Failed to save: ${error}`);
    }
  }

  /**
   * Schedule a save (debounced)
   */
  private scheduleSave(): void {
    this.dirty = true;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      if (this.dirty) {
        this.save();
      }
    }, 1000); // Save after 1 second of inactivity
  }

  /**
   * Force save now
   */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.dirty) {
      this.save();
    }
  }
}

/** Singleton instance */
let intelligenceInstance: DomainIntelligence | null = null;

/**
 * Get the domain intelligence singleton
 */
export function getDomainIntelligence(storagePath?: string): DomainIntelligence {
  if (!intelligenceInstance) {
    intelligenceInstance = new DomainIntelligence(storagePath);
  }
  return intelligenceInstance;
}

/**
 * Get protection settings for a URL
 */
export function getProtectionSettings(url: string): ProtectionSettings {
  return getDomainIntelligence().getSettings(url);
}

/**
 * Check if a URL requires authenticated session (pool-0)
 * Use this to decide whether to force the synced Chrome profile
 */
export function requiresAuth(url: string): boolean {
  return getDomainIntelligence().requiresAuth(url);
}

/**
 * Get list of auth-required domains (for documentation/LLM context)
 */
export function getAuthRequiredDomains(): string[] {
  return Array.from(AUTH_REQUIRED_DOMAINS);
}
