/**
 * Unified Backend Manager for HydraSpecter
 *
 * High-level manager that:
 * - Auto-selects backends based on domain rules
 * - Handles fallback between backends on failure
 * - Provides unified API for MCP actions
 * - Manages instance lifecycle
 */

import { v4 as uuidv4 } from 'uuid';
import {
  BackendType,
  BackendPage,
  BackendInstance,
  BackendCreateOptions,
  BackendResult,
  BackendNavigateOptions,
  BackendClickOptions,
  BackendTypeOptions,
  BackendScreenshotOptions,
  BackendSnapshotResult,
} from './types.js';
import { BackendFactory } from './backend-factory.js';
import { getBackendSelector } from '../detection/backend-selector.js';
import { detectFromPage } from '../detection/cloudflare-detector.js';

/** Unified instance that tracks backend and instance together */
export interface UnifiedInstance {
  id: string;
  backend: BackendType;
  instance: BackendInstance;
  page: BackendPage;
  createdAt: Date;
  lastUsed: Date;
  url?: string;
  retryCount: number;
}

/** Fallback configuration */
export interface FallbackConfig {
  /** Enable automatic fallback */
  enabled: boolean;
  /** Maximum retries per backend */
  maxRetries: number;
  /** Delay between retries in ms */
  retryDelay: number;
  /** Backends to try in order (after auto-selected fails) */
  fallbackOrder: BackendType[];
}

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  maxRetries: 2,
  retryDelay: 5000,
  fallbackOrder: ['camoufox', 'seleniumbase', 'playwright'],
};

/**
 * Unified Backend Manager
 *
 * Main entry point for backend operations.
 */
export class UnifiedBackendManager {
  private instances: Map<string, UnifiedInstance> = new Map();
  private fallbackConfig: FallbackConfig;
  private selector = getBackendSelector();

  constructor(fallbackConfig?: Partial<FallbackConfig>) {
    this.fallbackConfig = { ...DEFAULT_FALLBACK_CONFIG, ...fallbackConfig };
  }

  /**
   * Create a new browser instance with auto-backend selection
   * @param options Creation options
   * @returns Unified instance
   */
  async create(options: BackendCreateOptions & { backend?: BackendType | 'auto' } = {}): Promise<BackendResult<UnifiedInstance>> {
    let selectedBackend: BackendType;

    // Determine backend
    if (options.backend && options.backend !== 'auto') {
      selectedBackend = options.backend;
    } else if (options.url) {
      selectedBackend = this.selector.selectBackend(options.url);
    } else {
      selectedBackend = 'playwright';
    }

    console.error(`[UnifiedBackend] Creating instance with ${selectedBackend} backend`);

    // Try to create with selected backend
    const result = await this.tryCreate(selectedBackend, options);

    if (result.success && result.data) {
      // Check for Cloudflare if we have a URL
      if (options.url && this.fallbackConfig.enabled) {
        const detection = await detectFromPage(result.data.page);
        if (detection.detected) {
          console.error(`[UnifiedBackend] Cloudflare detected (${detection.type}), trying fallback...`);

          // Close current instance
          await this.close(result.data.id);

          // Try fallback
          return this.createWithFallback(options, selectedBackend);
        }
      }

      return result;
    }

    // Primary creation failed, try fallback if enabled
    if (this.fallbackConfig.enabled) {
      console.error(`[UnifiedBackend] Primary backend (${selectedBackend}) failed: ${result.error}`);
      return this.createWithFallback(options, selectedBackend);
    }

    return result;
  }

  /**
   * Try to create with a specific backend
   */
  private async tryCreate(backendType: BackendType, options: BackendCreateOptions): Promise<BackendResult<UnifiedInstance>> {
    try {
      const backend = await BackendFactory.getAsync(backendType);

      // Check if backend is available
      const available = await backend.isAvailable();
      if (!available) {
        return {
          success: false,
          error: `Backend ${backendType} is not available`,
        };
      }

      const result = await backend.create(options);

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || 'Failed to create instance',
        };
      }

      // Create unified instance
      const id = `${backendType.slice(0, 2)}-${uuidv4().slice(0, 8)}`;
      const unified: UnifiedInstance = {
        id,
        backend: backendType,
        instance: result.data,
        page: result.data.page,
        createdAt: new Date(),
        lastUsed: new Date(),
        url: options.url,
        retryCount: 0,
      };

      this.instances.set(id, unified);

      return {
        success: true,
        data: unified,
      };
    } catch (error) {
      return {
        success: false,
        error: `Create failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Create with fallback logic
   */
  private async createWithFallback(options: BackendCreateOptions, failedBackend: BackendType): Promise<BackendResult<UnifiedInstance>> {
    const fallbackOrder = this.fallbackConfig.fallbackOrder.filter(b => b !== failedBackend);

    for (const backend of fallbackOrder) {
      console.error(`[UnifiedBackend] Trying fallback backend: ${backend}`);

      // Wait before retry
      await this.delay(this.fallbackConfig.retryDelay);

      const result = await this.tryCreate(backend, options);

      if (result.success && result.data) {
        // Learn from this success
        if (options.url) {
          this.selector.learnFromFailure(options.url, failedBackend, backend);
        }

        // Check for Cloudflare on this attempt too
        const detection = await detectFromPage(result.data.page);
        if (!detection.detected) {
          return result;
        }

        console.error(`[UnifiedBackend] Cloudflare still detected with ${backend}, continuing fallback...`);
        await this.close(result.data.id);
      }
    }

    return {
      success: false,
      error: `All backends failed for ${options.url || 'unknown URL'}`,
    };
  }

  /**
   * Navigate to URL (with retry on Cloudflare detection)
   */
  async navigate(id: string, url: string, options?: BackendNavigateOptions): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    const result = await backend.navigate(unified.page, url, options);

    if (result.success) {
      unified.lastUsed = new Date();
      unified.url = url;

      // Check for Cloudflare
      if (this.fallbackConfig.enabled) {
        const detection = await detectFromPage(unified.page);
        if (detection.detected) {
          console.error(`[UnifiedBackend] Cloudflare detected after navigation to ${url}`);
          return {
            success: false,
            error: `Cloudflare ${detection.type} detected. Suggestion: ${detection.suggestion}`,
          };
        }
      }
    }

    return result;
  }

  /**
   * Click element
   */
  async click(id: string, selector: string, options?: BackendClickOptions): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.click(unified.page, selector, options);
  }

  /**
   * Type text
   */
  async type(id: string, selector: string, text: string, options?: BackendTypeOptions): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.typeText(unified.page, selector, text, options);
  }

  /**
   * Fill field
   */
  async fill(id: string, selector: string, value: string, options?: BackendTypeOptions): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.fill(unified.page, selector, value, options);
  }

  /**
   * Take screenshot
   */
  async screenshot(id: string, options?: BackendScreenshotOptions): Promise<BackendResult<string>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.screenshot(unified.page, options);
  }

  /**
   * Get page snapshot
   */
  async snapshot(id: string, options?: { format?: 'aria' | 'html' | 'text' }): Promise<BackendResult<BackendSnapshotResult>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.snapshot(unified.page, options);
  }

  /**
   * Evaluate JavaScript
   */
  async evaluate<T = any>(id: string, script: string, ...args: any[]): Promise<BackendResult<T>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.evaluate(unified.page, script, ...args);
  }

  /**
   * Wait for element
   */
  async waitForElement(id: string, selector: string, options?: { timeout?: number; state?: 'attached' | 'visible' }): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.waitForElement(unified.page, selector, options);
  }

  /**
   * Scroll
   */
  async scroll(id: string, options: { direction: 'up' | 'down'; amount?: number } | { selector: string }): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    const backend = BackendFactory.get(unified.backend);
    unified.lastUsed = new Date();
    return backend.scroll(unified.page, options);
  }

  /**
   * Get current URL
   */
  async getUrl(id: string): Promise<BackendResult<string>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    try {
      const url = await unified.page.url();
      return { success: true, data: url };
    } catch (error) {
      return {
        success: false,
        error: `Get URL failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Get instance info
   */
  getInstance(id: string): UnifiedInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * List all instances
   */
  listInstances(): UnifiedInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get backend type for instance
   */
  getBackend(id: string): BackendType | undefined {
    return this.instances.get(id)?.backend;
  }

  /**
   * Switch backend for an instance (closes and recreates)
   */
  async switchBackend(id: string, newBackend: BackendType): Promise<BackendResult<UnifiedInstance>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    // Get current URL
    const url = await unified.page.url();

    // Close current instance
    await this.close(id);

    // Create new instance with specified backend
    return this.create({
      url,
      backend: newBackend,
    });
  }

  /**
   * Close instance
   */
  async close(id: string): Promise<BackendResult<void>> {
    const unified = this.instances.get(id);
    if (!unified) {
      return { success: false, error: `Instance ${id} not found` };
    }

    try {
      const backend = BackendFactory.get(unified.backend);
      await backend.close(unified.instance);
      this.instances.delete(id);
      return { success: true };
    } catch (error) {
      // Still remove from map
      this.instances.delete(id);
      return {
        success: false,
        error: `Close failed: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Close all instances
   */
  async closeAll(): Promise<BackendResult<{ closed: number }>> {
    const ids = Array.from(this.instances.keys());
    let closed = 0;

    for (const id of ids) {
      const result = await this.close(id);
      if (result.success) {
        closed++;
      }
    }

    return {
      success: true,
      data: { closed },
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let managerInstance: UnifiedBackendManager | null = null;

/**
 * Get the singleton UnifiedBackendManager instance
 */
export function getUnifiedBackendManager(config?: Partial<FallbackConfig>): UnifiedBackendManager {
  if (!managerInstance) {
    managerInstance = new UnifiedBackendManager(config);
  }
  return managerInstance;
}
