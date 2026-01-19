/**
 * Backend Selector for HydraSpecter
 *
 * Auto-selects the optimal browser backend based on domain rules.
 * Manages fallback logic when a backend fails.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackendType } from '../backends/types.js';

/** Domain rule for backend selection */
export interface DomainRule {
  /** Domain pattern (e.g., "chatgpt.com", "*.openai.com") */
  domain: string;
  /** Preferred backend for this domain */
  backend: BackendType;
  /** Fallback backend if preferred fails */
  fallback?: BackendType;
  /** Reason for this rule */
  reason?: string;
  /** Whether this rule was learned dynamically */
  learned?: boolean;
  /** Last time this rule was used/updated */
  lastUsed?: string;
}

/** Backend rules configuration */
export interface BackendRulesConfig {
  /** Version for migrations */
  version: number;
  /** Default backend for unknown domains */
  defaultBackend: BackendType;
  /** Domain-specific rules */
  rules: DomainRule[];
}

/** Default rules for known Cloudflare-protected sites */
const DEFAULT_RULES: DomainRule[] = [
  // ChatGPT - heavy Cloudflare protection
  {
    domain: 'chatgpt.com',
    backend: 'camoufox',
    fallback: 'seleniumbase',
    reason: 'Cloudflare Turnstile protection',
  },
  {
    domain: 'chat.openai.com',
    backend: 'camoufox',
    fallback: 'seleniumbase',
    reason: 'Cloudflare Turnstile protection',
  },
  // Claude - Cloudflare protected
  {
    domain: 'claude.ai',
    backend: 'camoufox',
    fallback: 'seleniumbase',
    reason: 'Cloudflare protection',
  },
  // Perplexity - Cloudflare protected
  {
    domain: 'perplexity.ai',
    backend: 'camoufox',
    fallback: 'seleniumbase',
    reason: 'Cloudflare protection',
  },
  // Discord - Cloudflare protected
  {
    domain: 'discord.com',
    backend: 'camoufox',
    fallback: 'seleniumbase',
    reason: 'Cloudflare protection',
  },
  // Notion - no Cloudflare but benefits from stealth
  {
    domain: 'notion.so',
    backend: 'playwright',
    reason: 'No heavy protection, Playwright works well',
  },
  // Google services - Playwright works fine
  {
    domain: '*.google.com',
    backend: 'playwright',
    reason: 'No Cloudflare, standard protection',
  },
  // Gmail
  {
    domain: 'mail.google.com',
    backend: 'playwright',
    reason: 'Session persistence needed, Playwright handles well',
  },
  // YouTube
  {
    domain: 'youtube.com',
    backend: 'playwright',
    reason: 'No heavy protection',
  },
  {
    domain: '*.youtube.com',
    backend: 'playwright',
    reason: 'No heavy protection',
  },
];

/**
 * Backend Selector
 *
 * Manages domain-to-backend mappings and dynamic learning.
 */
export class BackendSelector {
  private config: BackendRulesConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.hydraspecter', 'backend-rules.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from disk or create defaults
   */
  private loadConfig(): BackendRulesConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[BackendSelector] Failed to load config:', error);
    }

    // Return default config
    return {
      version: 1,
      defaultBackend: 'playwright',
      rules: [...DEFAULT_RULES],
    };
  }

  /**
   * Save configuration to disk
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[BackendSelector] Failed to save config:', error);
    }
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  /**
   * Check if a domain matches a pattern (supports wildcards)
   */
  private matchesDomain(domain: string, pattern: string): boolean {
    // Exact match
    if (domain === pattern) {
      return true;
    }

    // Wildcard match (*.example.com matches sub.example.com)
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // .example.com
      return domain.endsWith(suffix) || domain === pattern.slice(2);
    }

    return false;
  }

  /**
   * Select the best backend for a URL
   * @param url Target URL
   * @returns Selected backend type
   */
  selectBackend(url: string): BackendType {
    const domain = this.extractDomain(url);

    // Find matching rule
    for (const rule of this.config.rules) {
      if (this.matchesDomain(domain, rule.domain)) {
        console.error(`[BackendSelector] Selected ${rule.backend} for ${domain} (${rule.reason || 'rule match'})`);
        return rule.backend;
      }
    }

    // No rule found, use default
    console.error(`[BackendSelector] No rule for ${domain}, using default: ${this.config.defaultBackend}`);
    return this.config.defaultBackend;
  }

  /**
   * Get fallback backend for a URL
   * @param url Target URL
   * @returns Fallback backend type or undefined
   */
  getFallback(url: string): BackendType | undefined {
    const domain = this.extractDomain(url);

    for (const rule of this.config.rules) {
      if (this.matchesDomain(domain, rule.domain)) {
        return rule.fallback;
      }
    }

    // Default fallback chain
    const currentBackend = this.selectBackend(url);
    if (currentBackend === 'playwright') {
      return 'camoufox';
    } else if (currentBackend === 'camoufox') {
      return 'seleniumbase';
    } else if (currentBackend === 'seleniumbase') {
      return 'camoufox';
    }

    return undefined;
  }

  /**
   * Add or update a domain rule
   * @param rule Domain rule to add/update
   */
  addRule(rule: DomainRule): void {
    // Remove existing rule for this domain
    this.config.rules = this.config.rules.filter(r => r.domain !== rule.domain);

    // Add new rule at the beginning (higher priority)
    this.config.rules.unshift(rule);

    this.saveConfig();
    console.error(`[BackendSelector] Added rule: ${rule.domain} → ${rule.backend}`);
  }

  /**
   * Learn from a failed backend attempt
   * @param url URL that failed
   * @param failedBackend Backend that failed
   * @param successBackend Backend that succeeded (if any)
   */
  learnFromFailure(url: string, failedBackend: BackendType, successBackend?: BackendType): void {
    const domain = this.extractDomain(url);

    // Check if we already have a learned rule
    const existing = this.config.rules.find(r => r.domain === domain && r.learned);

    if (existing) {
      // Update existing learned rule
      if (successBackend) {
        existing.backend = successBackend;
        existing.fallback = failedBackend;
      }
      existing.lastUsed = new Date().toISOString();
    } else {
      // Create new learned rule
      const newRule: DomainRule = {
        domain,
        backend: successBackend || this.getFallback(url) || 'camoufox',
        fallback: failedBackend,
        reason: `Learned: ${failedBackend} failed`,
        learned: true,
        lastUsed: new Date().toISOString(),
      };

      this.addRule(newRule);
    }

    this.saveConfig();
  }

  /**
   * Get all rules
   */
  getRules(): DomainRule[] {
    return [...this.config.rules];
  }

  /**
   * Get rule for a specific domain
   */
  getRule(url: string): DomainRule | undefined {
    const domain = this.extractDomain(url);
    return this.config.rules.find(r => this.matchesDomain(domain, r.domain));
  }

  /**
   * Remove a rule
   */
  removeRule(domain: string): boolean {
    const before = this.config.rules.length;
    this.config.rules = this.config.rules.filter(r => r.domain !== domain);
    const removed = this.config.rules.length < before;
    if (removed) {
      this.saveConfig();
    }
    return removed;
  }

  /**
   * Reset to default rules
   */
  resetToDefaults(): void {
    this.config = {
      version: 1,
      defaultBackend: 'playwright',
      rules: [...DEFAULT_RULES],
    };
    this.saveConfig();
  }

  /**
   * Set default backend
   */
  setDefaultBackend(backend: BackendType): void {
    this.config.defaultBackend = backend;
    this.saveConfig();
  }
}

// Singleton instance
let selectorInstance: BackendSelector | null = null;

/**
 * Get the singleton BackendSelector instance
 */
export function getBackendSelector(): BackendSelector {
  if (!selectorInstance) {
    selectorInstance = new BackendSelector();
  }
  return selectorInstance;
}
