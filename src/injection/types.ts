/**
 * CSS/JS Injection System Types
 *
 * Workflow:
 * 1. Dev: Test CSS/JS in HydraSpecter browser (live preview)
 * 2. Prod: Publish rules to personal Chrome via extension
 */

export type RuleStatus = 'dev' | 'prod';
export type RunAt = 'document_start' | 'document_end' | 'document_idle';

/**
 * A single injection rule
 */
export interface InjectionRule {
  /** Unique identifier (auto-generated if not provided) */
  id: string;

  /** Human-readable name */
  name: string;

  /** URL pattern to match (glob style: *://example.com/*) */
  urlPattern: string;

  /** URL patterns to exclude (glob style, e.g., "*://maps.google.com/*") */
  excludePatterns?: string[];

  /** Whether the rule is enabled */
  enabled: boolean;

  /** Rule status: 'dev' (HydraSpecter only) or 'prod' (synced to extension) */
  status: RuleStatus;

  /** CSS to inject (inline) */
  css?: string;

  /** Path to CSS file (alternative to inline css) */
  cssFile?: string;

  /** JavaScript to inject (inline) */
  js?: string;

  /** Path to JS file (alternative to inline js) */
  jsFile?: string;

  /** When to run JS: document_start, document_end, document_idle */
  runAt?: RunAt;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Configuration file structure (~/.hydraspecter/injection-rules.json)
 */
export interface InjectionRulesConfig {
  /** List of injection rules */
  rules: InjectionRule[];

  /** Config version for migrations */
  version: number;

  /** Whether to auto-apply matching rules on navigation (default: true) */
  autoApply?: boolean;
}

/**
 * Input for creating a new rule (id and timestamps are auto-generated)
 */
export interface CreateRuleInput {
  name: string;
  urlPattern: string;
  excludePatterns?: string[];
  css?: string;
  cssFile?: string;
  js?: string;
  jsFile?: string;
  runAt?: RunAt;
  enabled?: boolean;
  status?: RuleStatus;
}

/**
 * Result of CSS/JS injection
 */
export interface InjectionResult {
  success: boolean;
  source: 'inline' | 'file';
  type: 'css' | 'js';
  error?: string;
  /** Return value for JS injection */
  result?: unknown;
}

/**
 * Result of applying matching rules to a page
 */
export interface ApplyRulesResult {
  appliedRules: string[];
  skippedRules: string[];
  errors: Array<{ ruleId: string; error: string }>;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: InjectionRulesConfig = {
  rules: [],
  version: 1,
  autoApply: true,
};
