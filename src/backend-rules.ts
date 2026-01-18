/**
 * Backend Rules Configuration
 *
 * Allows users to define which sites should use SeleniumBase vs Playwright
 * via a JSON configuration file at ~/.hydraspecter/backend-rules.json
 *
 * Format:
 * {
 *   "seleniumbase": ["chatgpt.com", "claude.ai", "perplexity.ai"],
 *   "playwright": ["*"]
 * }
 *
 * The wildcard "*" matches all domains not explicitly listed.
 * SeleniumBase rules are checked first (higher priority).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/** Default storage path for backend rules */
const DEFAULT_RULES_PATH = path.join(os.homedir(), '.hydraspecter', 'backend-rules.json');

/** Backend rules configuration structure */
export interface BackendRulesConfig {
  /** Domains that should use SeleniumBase backend */
  seleniumbase: string[];
  /** Domains that should use Playwright backend (use "*" for all others) */
  playwright: string[];
}

/** Default backend rules (built-in) */
const DEFAULT_RULES: BackendRulesConfig = {
  seleniumbase: [
    'chatgpt.com',
    'claude.ai',
    'perplexity.ai',
    'openai.com',
  ],
  playwright: ['*'],
};

/**
 * Manages backend selection rules with file-based configuration
 */
export class BackendRules {
  private config: BackendRulesConfig;
  private configPath: string;
  private configLoaded: boolean = false;

  constructor(configPath?: string) {
    this.configPath = configPath || DEFAULT_RULES_PATH;
    this.config = { ...DEFAULT_RULES };
    this.load();
  }

  /**
   * Extract root domain from URL or hostname
   * Examples:
   *   accounts.google.com -> google.com
   *   www.chatgpt.com -> chatgpt.com
   *   api.sub.example.co.uk -> example.co.uk
   */
  private getRootDomain(urlOrHostname: string): string {
    let hostname: string;

    try {
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
   * Check if a domain matches a pattern
   * Supports exact match and wildcard (*)
   */
  private matchesDomain(domain: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }
    // Exact match (case-insensitive)
    return domain.toLowerCase() === pattern.toLowerCase();
  }

  /**
   * Determine which backend to use for a given URL
   *
   * Priority:
   * 1. SeleniumBase rules (checked first)
   * 2. Playwright rules
   * 3. Default to Playwright if no match
   *
   * @param url The URL to check
   * @returns The backend type to use ('playwright' or 'seleniumbase')
   */
  getBackendForUrl(url: string): 'playwright' | 'seleniumbase' {
    const domain = this.getRootDomain(url);

    // Check SeleniumBase rules first (higher priority)
    for (const pattern of this.config.seleniumbase) {
      if (this.matchesDomain(domain, pattern)) {
        console.error(`[BackendRules] ${domain} matches SeleniumBase rule: ${pattern}`);
        return 'seleniumbase';
      }
    }

    // Check Playwright rules
    for (const pattern of this.config.playwright) {
      if (this.matchesDomain(domain, pattern)) {
        console.error(`[BackendRules] ${domain} matches Playwright rule: ${pattern}`);
        return 'playwright';
      }
    }

    // Default to Playwright
    console.error(`[BackendRules] ${domain} no matching rule, defaulting to Playwright`);
    return 'playwright';
  }

  /**
   * Check if a URL should use SeleniumBase
   */
  shouldUseSeleniumBase(url: string): boolean {
    return this.getBackendForUrl(url) === 'seleniumbase';
  }

  /**
   * Get current configuration
   */
  getConfig(): BackendRulesConfig {
    return { ...this.config };
  }

  /**
   * Check if custom config was loaded from file
   */
  hasCustomConfig(): boolean {
    return this.configLoaded;
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Load configuration from file
   */
  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const data = JSON.parse(content) as Partial<BackendRulesConfig>;

        // Merge with defaults (user config takes precedence)
        if (data.seleniumbase && Array.isArray(data.seleniumbase)) {
          this.config.seleniumbase = data.seleniumbase;
        }
        if (data.playwright && Array.isArray(data.playwright)) {
          this.config.playwright = data.playwright;
        }

        this.configLoaded = true;
        console.error(`[BackendRules] Loaded config from ${this.configPath}`);
        console.error(`[BackendRules] SeleniumBase domains: ${this.config.seleniumbase.join(', ')}`);
        console.error(`[BackendRules] Playwright domains: ${this.config.playwright.join(', ')}`);
      } else {
        console.error(`[BackendRules] No config file found at ${this.configPath}, using defaults`);
        console.error(`[BackendRules] Default SeleniumBase domains: ${this.config.seleniumbase.join(', ')}`);
      }
    } catch (error) {
      console.error(`[BackendRules] Failed to load config: ${error}`);
      console.error(`[BackendRules] Using default rules`);
    }
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    this.config = { ...DEFAULT_RULES };
    this.configLoaded = false;
    this.load();
  }

  /**
   * Create a sample config file if it doesn't exist
   */
  createSampleConfig(): boolean {
    try {
      if (fs.existsSync(this.configPath)) {
        console.error(`[BackendRules] Config file already exists at ${this.configPath}`);
        return false;
      }

      // Ensure directory exists
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const sampleConfig: BackendRulesConfig = {
        seleniumbase: [
          'chatgpt.com',
          'claude.ai',
          'perplexity.ai',
          'openai.com',
        ],
        playwright: ['*'],
      };

      fs.writeFileSync(this.configPath, JSON.stringify(sampleConfig, null, 2));
      console.error(`[BackendRules] Created sample config at ${this.configPath}`);
      return true;
    } catch (error) {
      console.error(`[BackendRules] Failed to create sample config: ${error}`);
      return false;
    }
  }
}

/** Singleton instance */
let rulesInstance: BackendRules | null = null;

/**
 * Get the backend rules singleton
 */
export function getBackendRules(configPath?: string): BackendRules {
  if (!rulesInstance) {
    rulesInstance = new BackendRules(configPath);
  }
  return rulesInstance;
}

/**
 * Determine backend for a URL using the global rules
 */
export function getBackendForUrl(url: string): 'playwright' | 'seleniumbase' {
  return getBackendRules().getBackendForUrl(url);
}

/**
 * Check if a URL should use SeleniumBase
 */
export function shouldUseSeleniumBase(url: string): boolean {
  return getBackendRules().shouldUseSeleniumBase(url);
}

/**
 * Get the default rules (for reference/documentation)
 */
export function getDefaultRules(): BackendRulesConfig {
  return { ...DEFAULT_RULES };
}
