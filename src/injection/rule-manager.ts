/**
 * Injection Rule Manager
 *
 * Handles CRUD operations for injection rules stored in
 * ~/.hydraspecter/injection-rules.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  InjectionRule,
  InjectionRulesConfig,
  CreateRuleInput,
  DEFAULT_CONFIG,
  RuleStatus,
} from './types.js';

/**
 * Convert glob pattern to regex
 * Supports: * (any chars), ? (single char)
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\*/g, '.*') // * -> .*
    .replace(/\?/g, '.'); // ? -> .
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Generate a unique ID for a rule
 */
function generateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${slug}-${suffix}`;
}

export class InjectionRuleManager {
  private configPath: string;
  private config: InjectionRulesConfig;

  constructor(configDir?: string) {
    const baseDir = configDir || path.join(os.homedir(), '.hydraspecter');
    this.configPath = path.join(baseDir, 'injection-rules.json');
    this.config = DEFAULT_CONFIG;
    this.load();
  }

  /**
   * Load configuration from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(content);
        console.error(`[InjectionRuleManager] Loaded ${this.config.rules.length} rules`);
      } else {
        // Create default config
        this.save();
        console.error('[InjectionRuleManager] Created default config');
      }
    } catch (error) {
      console.error('[InjectionRuleManager] Error loading config:', error);
      this.config = DEFAULT_CONFIG;
    }
  }

  /**
   * Save configuration to disk
   */
  save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.error(`[InjectionRuleManager] Saved ${this.config.rules.length} rules`);
    } catch (error) {
      console.error('[InjectionRuleManager] Error saving config:', error);
      throw error;
    }
  }

  /**
   * Get all rules
   */
  getAllRules(): InjectionRule[] {
    return [...this.config.rules];
  }

  /**
   * Get rules by status
   */
  getRulesByStatus(status: RuleStatus): InjectionRule[] {
    return this.config.rules.filter((r) => r.status === status);
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): InjectionRule | undefined {
    return this.config.rules.find((r) => r.id === id);
  }

  /**
   * Get rules matching a URL
   */
  getMatchingRules(url: string, status?: RuleStatus): InjectionRule[] {
    return this.config.rules.filter((rule) => {
      if (!rule.enabled) return false;
      if (status && rule.status !== status) return false;

      try {
        // Check include pattern
        const regex = globToRegex(rule.urlPattern);
        if (!regex.test(url)) return false;

        // Check exclude patterns
        if (rule.excludePatterns && rule.excludePatterns.length > 0) {
          for (const excludePattern of rule.excludePatterns) {
            const excludeRegex = globToRegex(excludePattern);
            if (excludeRegex.test(url)) {
              console.error(`[InjectionRuleManager] Rule ${rule.id} excluded by pattern: ${excludePattern}`);
              return false;
            }
          }
        }

        return true;
      } catch {
        console.error(`[InjectionRuleManager] Invalid pattern for rule ${rule.id}: ${rule.urlPattern}`);
        return false;
      }
    });
  }

  /**
   * Add a new rule
   */
  addRule(input: CreateRuleInput): InjectionRule {
    const now = new Date().toISOString();

    const rule: InjectionRule = {
      id: generateId(input.name),
      name: input.name,
      urlPattern: input.urlPattern,
      excludePatterns: input.excludePatterns,
      enabled: input.enabled ?? true,
      status: input.status ?? 'dev',
      css: input.css,
      cssFile: input.cssFile,
      js: input.js,
      jsFile: input.jsFile,
      runAt: input.runAt ?? 'document_end',
      createdAt: now,
      updatedAt: now,
    };

    this.config.rules.push(rule);
    this.save();

    console.error(`[InjectionRuleManager] Added rule: ${rule.id} (${rule.name})`);
    return rule;
  }

  /**
   * Update an existing rule
   */
  updateRule(id: string, updates: Partial<CreateRuleInput>): InjectionRule | null {
    const index = this.config.rules.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const existingRule = this.config.rules[index];
    if (!existingRule) return null;

    // Only apply defined updates, preserving existing values
    const updated: InjectionRule = {
      id: existingRule.id,
      name: updates.name ?? existingRule.name,
      urlPattern: updates.urlPattern ?? existingRule.urlPattern,
      excludePatterns: updates.excludePatterns !== undefined ? updates.excludePatterns : existingRule.excludePatterns,
      enabled: updates.enabled ?? existingRule.enabled,
      status: updates.status ?? existingRule.status,
      css: updates.css !== undefined ? updates.css : existingRule.css,
      cssFile: updates.cssFile !== undefined ? updates.cssFile : existingRule.cssFile,
      js: updates.js !== undefined ? updates.js : existingRule.js,
      jsFile: updates.jsFile !== undefined ? updates.jsFile : existingRule.jsFile,
      runAt: updates.runAt ?? existingRule.runAt,
      createdAt: existingRule.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.config.rules[index] = updated;
    this.save();

    console.error(`[InjectionRuleManager] Updated rule: ${id}`);
    return updated;
  }

  /**
   * Remove a rule
   */
  removeRule(id: string): boolean {
    const index = this.config.rules.findIndex((r) => r.id === id);
    if (index === -1) return false;

    this.config.rules.splice(index, 1);
    this.save();

    console.error(`[InjectionRuleManager] Removed rule: ${id}`);
    return true;
  }

  /**
   * Toggle rule enabled state
   */
  toggleRule(id: string, enabled: boolean): InjectionRule | null {
    return this.updateRule(id, { enabled });
  }

  /**
   * Publish a rule (change status from 'dev' to 'prod')
   */
  publishRule(id: string): InjectionRule | null {
    const rule = this.getRule(id);
    if (!rule) return null;

    return this.updateRule(id, { status: 'prod' });
  }

  /**
   * Unpublish a rule (change status from 'prod' to 'dev')
   */
  unpublishRule(id: string): InjectionRule | null {
    const rule = this.getRule(id);
    if (!rule) return null;

    return this.updateRule(id, { status: 'dev' });
  }

  /**
   * Get whether auto-apply is enabled
   */
  isAutoApplyEnabled(): boolean {
    return this.config.autoApply ?? true;
  }

  /**
   * Set auto-apply setting
   */
  setAutoApply(enabled: boolean): void {
    this.config.autoApply = enabled;
    this.save();
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

// Singleton instance
let instance: InjectionRuleManager | null = null;

/**
 * Get the global InjectionRuleManager instance
 */
export function getInjectionRuleManager(): InjectionRuleManager {
  if (!instance) {
    instance = new InjectionRuleManager();
  }
  return instance;
}
